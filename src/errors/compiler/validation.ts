// errors/compiler/validation.ts
// Validates CompiledRenderer structures before Engine execution

import { DiagnosticBag } from '../core/DiagnosticBag.js';
import type { CompiledRenderer, RenderPass, FramebufferConfig } from '../../compiler/types.js';

/**
 * Validate a CompiledRenderer for structural correctness
 *
 * Checks that all internal references are valid:
 * - Shader IDs in passes exist in shaders Map
 * - Framebuffer IDs in passes/exports exist in pipeline
 * - MRT outputs reference same base framebuffer
 * - Swap instructions reference valid buffers
 */
export function validateCompiledRenderer(
    renderer: CompiledRenderer,
    bag?: DiagnosticBag
): DiagnosticBag {
    const diagnostics = bag ?? new DiagnosticBag('compiler');

    // Build lookup for valid framebuffer IDs
    const framebufferIds = new Set(
        renderer.pipeline.framebuffers.map(fb => fb.id)
    );

    // Build lookup for framebuffer configs
    const framebufferConfigs = new Map(
        renderer.pipeline.framebuffers.map(fb => [fb.id, fb])
    );

    // Validate basic structure
    validateStructure(renderer, diagnostics);

    // Validate each pass
    for (const pass of renderer.pipeline.passes) {
        validatePass(pass, renderer, framebufferIds, diagnostics);
    }

    // Validate swap instructions
    if (renderer.pipeline.postFrame?.swaps) {
        validateSwaps(
            renderer.pipeline.postFrame.swaps,
            framebufferIds,
            framebufferConfigs,
            diagnostics
        );
    }

    // Validate export targets
    if (renderer.exportTargets) {
        validateExports(renderer.exportTargets, framebufferIds, diagnostics);
    }

    // Validate uniforms
    validateUniforms(renderer, diagnostics);

    return diagnostics;
}

/**
 * Validate basic renderer structure
 */
function validateStructure(
    renderer: CompiledRenderer,
    bag: DiagnosticBag
): void {
    if (!renderer.id || renderer.id.trim() === '') {
        bag.error('renderer-no-id', 'CompiledRenderer must have a non-empty id').add();
    }

    if (renderer.shaders.size === 0) {
        bag.error('renderer-no-shaders', 'CompiledRenderer must have at least one shader').add();
    }

    if (renderer.pipeline.passes.length === 0) {
        bag.error('renderer-no-passes', 'CompiledRenderer must have at least one render pass').add();
    }

    // §9 rule 1: exactly one 'screen' framebuffer. Zero would surface as a mid-frame
    // "Resource not found: screen" in the ResourceManager; two is ambiguous output.
    const screenCount = renderer.pipeline.framebuffers.filter(fb => fb.type === 'screen').length;
    if (screenCount !== 1) {
        bag.error('pipeline-screen-count',
            `Pipeline declares ${screenCount} framebuffers of type 'screen' — §9 requires exactly one`)
            .add();
    }
}

/**
 * Validate a single render pass
 */
function validatePass(
    pass: RenderPass,
    renderer: CompiledRenderer,
    framebufferIds: Set<string>,
    bag: DiagnosticBag
): void {
    // Check shader exists
    if (!renderer.shaders.has(pass.shader)) {
        bag.error('pass-invalid-shader',
            `Pass '${pass.id}' references unknown shader '${pass.shader}'`)
            .suggest(`Available shaders: ${[...renderer.shaders.keys()].join(', ')}`)
            .add();
    }

    // Validate output framebuffer(s)
    const outputs = Array.isArray(pass.output) ? pass.output : [pass.output];
    const baseBuffers = new Set<string>();

    for (const output of outputs) {
        const { bufferId, attachment } = parseBufferRef(output);

        if (!framebufferIds.has(bufferId)) {
            bag.error('pass-invalid-output',
                `Pass '${pass.id}' outputs to unknown framebuffer '${bufferId}'`)
                .suggest(`Available framebuffers: ${[...framebufferIds].join(', ')}`)
                .add();
        }

        baseBuffers.add(bufferId);

        // Check attachment index is reasonable (0-7 for MRT)
        if (attachment !== undefined && (attachment < 0 || attachment > 7)) {
            bag.warning('pass-invalid-attachment',
                `Pass '${pass.id}' uses attachment ${attachment}, but valid range is 0-7`)
                .add();
        }
    }

    // MRT outputs must all reference same base framebuffer
    if (outputs.length > 1 && baseBuffers.size > 1) {
        bag.error('pass-mrt-multiple-buffers',
            `Pass '${pass.id}' has MRT outputs spanning multiple framebuffers: ${[...baseBuffers].join(', ')}`)
            .suggest('All MRT outputs must reference the same base framebuffer')
            .add();
    }

    // Validate texture inputs
    if (pass.inputs?.textures) {
        for (const [uniformName, bufferRef] of Object.entries(pass.inputs.textures)) {
            const { bufferId } = parseBufferRef(bufferRef);

            if (!framebufferIds.has(bufferId)) {
                bag.error('pass-invalid-texture',
                    `Pass '${pass.id}' binds texture '${uniformName}' from unknown buffer '${bufferId}'`)
                    .suggest(`Available framebuffers: ${[...framebufferIds].join(', ')}`)
                    .add();
            }
        }
    }
}

/**
 * Validate swap instructions
 */
function validateSwaps(
    swaps: Array<{ type: string; buffers: string[] }>,
    framebufferIds: Set<string>,
    framebufferConfigs: Map<string, FramebufferConfig>,
    bag: DiagnosticBag
): void {
    for (const swap of swaps) {
        // 'rotate' is a locked contract type (§2/§12) the engine does not implement — the
        // ResourceManager throws MID-FRAME on the first renderFrame(). Reject at load instead.
        if (swap.type === 'rotate') {
            bag.error('swap-rotate-unsupported',
                "SwapInstruction type 'rotate' is not implemented by the engine yet — temporal history queues are deferred")
                .add();
            continue;
        }

        // §9 rule 4: 'swap' requires exactly one buffer of type 'double_buffer'. A misdeclared
        // swap silently no-ops at runtime (executeSwap skips wrong types) — the accumulation
        // never advances and the image renders frame 1 forever, so this is an ERROR, not a warning.
        if (swap.type === 'swap' && swap.buffers.length !== 1) {
            bag.error('swap-not-double-buffer',
                `Swap instruction lists ${swap.buffers.length} buffers — §9 requires exactly one double_buffer per swap`)
                .add();
        }

        for (const bufferId of swap.buffers) {
            if (!framebufferIds.has(bufferId)) {
                bag.error('swap-invalid-buffer',
                    `Swap instruction references unknown buffer '${bufferId}'`)
                    .add();
            }

            const config = framebufferConfigs.get(bufferId);
            if (config && swap.type === 'swap' && config.type !== 'double_buffer') {
                bag.error('swap-not-double-buffer',
                    `Swap on '${bufferId}' but it's type '${config.type}', not 'double_buffer' — the swap would silently no-op and accumulation would never advance`)
                    .add();
            }
        }
    }
}

/**
 * Validate export targets
 */
function validateExports(
    exports: Record<string, { bufferId: string; attachment?: number }>,
    framebufferIds: Set<string>,
    bag: DiagnosticBag
): void {
    for (const [exportName, target] of Object.entries(exports)) {
        // Parse buffer reference to extract base buffer ID
        // Export targets may use _current/_previous qualifiers (e.g., 'accumulation_current')
        const { bufferId: baseBufferId } = parseBufferRef(target.bufferId);

        if (!framebufferIds.has(baseBufferId)) {
            bag.error('export-invalid-buffer',
                `Export '${exportName}' references unknown buffer '${target.bufferId}'`)
                .suggest(`Available framebuffers: ${[...framebufferIds].join(', ')}`)
                .add();
        }
    }
}

/**
 * Validate uniform bindings
 */
function validateUniforms(
    renderer: CompiledRenderer,
    bag: DiagnosticBag
): void {
    const seenUniforms = new Map<string, string>(); // uniform name → first binding's parameter

    for (const binding of renderer.uniforms) {
        const existing = seenUniforms.get(binding.uniform);
        const paramName = binding.parameters?.[0] ?? 'computed';

        if (existing) {
            bag.warning('uniform-duplicate',
                `Uniform '${binding.uniform}' is bound multiple times`)
                .suggest(`First bound by '${existing}', also bound by '${paramName}'`)
                .add();
        } else {
            seenUniforms.set(binding.uniform, paramName);
        }
    }
}

/**
 * Parse buffer reference with optional qualifiers and attachment suffix
 *
 * Handles:
 * - Base name: 'accumulation' → bufferId: 'accumulation'
 * - With attachment: 'accumulation:1' → bufferId: 'accumulation', attachment: 1
 * - With qualifier: 'accumulation_current' → bufferId: 'accumulation'
 * - Combined: 'accumulation_current:1' → bufferId: 'accumulation', attachment: 1
 *
 * Qualifiers (_current, _previous) are used for double_buffer framebuffers
 * and should resolve to the base buffer ID for validation purposes.
 */
export function parseBufferRef(ref: string): { bufferId: string; attachment?: number } {
    // Step 1: Parse attachment suffix first (e.g., ':2')
    let rest = ref;
    let attachment: number | undefined;

    const colonIndex = ref.lastIndexOf(':');
    if (colonIndex !== -1) {
        const possibleAttachment = ref.slice(colonIndex + 1);
        const attachmentNum = parseInt(possibleAttachment, 10);
        if (!isNaN(attachmentNum)) {
            attachment = attachmentNum;
            rest = ref.slice(0, colonIndex);
        }
    }

    // Step 2: Parse _current/_previous qualifier suffix
    const parts = rest.split('_');
    const lastPart = parts[parts.length - 1];

    if (lastPart === 'current' || lastPart === 'previous') {
        // Strip qualifier to get base buffer ID
        const baseId = parts.slice(0, -1).join('_');
        return { bufferId: baseId, attachment };
    }

    // No qualifier, use rest as buffer ID
    return { bufferId: rest, attachment };
}
