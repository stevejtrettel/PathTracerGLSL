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
        for (const bufferId of swap.buffers) {
            if (!framebufferIds.has(bufferId)) {
                bag.error('swap-invalid-buffer',
                    `Swap instruction references unknown buffer '${bufferId}'`)
                    .add();
            }

            // Warn if swapping non-double_buffer
            const config = framebufferConfigs.get(bufferId);
            if (config && swap.type === 'swap' && config.type !== 'double_buffer') {
                bag.warning('swap-not-double-buffer',
                    `Swap on '${bufferId}' but it's type '${config.type}', not 'double_buffer'`)
                    .suggest('Swap operations are typically used with double_buffer framebuffers')
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
        if (!framebufferIds.has(target.bufferId)) {
            bag.error('export-invalid-buffer',
                `Export '${exportName}' references unknown buffer '${target.bufferId}'`)
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
 * Parse buffer reference with optional attachment suffix
 *
 * Examples:
 * - 'accumulation' → { bufferId: 'accumulation', attachment: undefined }
 * - 'accumulation:1' → { bufferId: 'accumulation', attachment: 1 }
 */
function parseBufferRef(ref: string): { bufferId: string; attachment?: number } {
    const colonIndex = ref.lastIndexOf(':');

    if (colonIndex === -1) {
        return { bufferId: ref };
    }

    const possibleAttachment = ref.slice(colonIndex + 1);
    const attachmentNum = parseInt(possibleAttachment, 10);

    if (!isNaN(attachmentNum)) {
        return {
            bufferId: ref.slice(0, colonIndex),
            attachment: attachmentNum
        };
    }

    // Not a number after colon, treat whole thing as buffer ID
    return { bufferId: ref };
}
