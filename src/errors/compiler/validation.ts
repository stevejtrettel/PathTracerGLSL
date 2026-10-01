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
        validatePass(pass, renderer, framebufferConfigs, diagnostics);
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
        validateExports(renderer.exportTargets, framebufferConfigs, diagnostics);
    }

    // Validate the on-demand LDR recipe
    if (renderer.ldrRecipe) {
        validateLdrRecipe(renderer, framebufferConfigs, diagnostics);
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

    // §9 rule 1, refined for headless pipelines (T4): at most one 'screen' framebuffer; a
    // pass targeting 'screen' requires it to exist (else a mid-frame "Resource not found").
    // ZERO screens is legal iff no pass outputs to screen — bake/offline pipelines render
    // to fixed-size textures and are read back, never displayed.
    const screenCount = renderer.pipeline.framebuffers.filter(fb => fb.type === 'screen').length;
    const targetsScreen = renderer.pipeline.passes.some(p =>
        (Array.isArray(p.output) ? p.output : [p.output]).some(o => o === 'screen' || o.startsWith('screen:')));
    if (screenCount > 1 || (screenCount === 0 && targetsScreen)) {
        bag.error('pipeline-screen-count',
            `Pipeline declares ${screenCount} 'screen' framebuffers${targetsScreen ? ' but a pass outputs to screen' : ''} — §9 allows at most one, and exactly one when a pass targets it`)
            .add();
    }

    // Fixed-size framebuffers (T4 contract extension): size must be positive integers,
    // and 'screen' can't carry one (the canvas owns its size).
    for (const fb of renderer.pipeline.framebuffers) {
        if (fb.size === undefined) continue;
        const [w, h] = fb.size;
        if (fb.type === 'screen') {
            bag.error('invalid-pipeline', `Framebuffer '${fb.id}': 'screen' cannot have a fixed size`).add();
        }
        if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
            bag.error('invalid-pipeline',
                `Framebuffer '${fb.id}': size must be positive integers (got [${w}, ${h}])`)
                .add();
        }
    }
}

/**
 * Validate a single render pass
 */
/**
 * Check one buffer reference against the pipeline's framebuffers: the buffer exists, a
 * `_current`/`_previous` qualifier names a double_buffer (a single texture has no pair), and
 * the attachment index is one of the buffer's formats. `attachment` is given separately for
 * export targets, which carry it as a field instead of a `:N` suffix.
 */
function checkBufferRef(
    where: string,
    ref: string,
    attachmentField: number | undefined,
    configs: Map<string, FramebufferConfig>,
    unknownCode: 'pass-invalid-output' | 'pass-invalid-texture' | 'export-invalid-buffer' | 'recipe-invalid',
    bag: DiagnosticBag
): void {
    const { bufferId, attachment: suffix } = parseBufferRef(ref);
    const config = configs.get(bufferId);
    if (config === undefined) {
        bag.error(unknownCode, `${where} references unknown framebuffer '${ref}'`)
            .suggest(`Available framebuffers: ${[...configs.keys()].join(', ')}`)
            .add();
        return;
    }
    const bare = ref.replace(/:\d+$/, '');
    if ((bare.endsWith('_current') || bare.endsWith('_previous')) && config.type !== 'double_buffer') {
        bag.error('buffer-invalid-qualifier',
            `${where} uses '${ref}', but '${bufferId}' is a ${config.type}, not a double_buffer — it has no _current/_previous pair`)
            .add();
    }
    const attachment = attachmentField ?? suffix ?? 0;
    const count = Array.isArray(config.format) ? config.format.length : 1;
    if (!Number.isInteger(attachment) || attachment < 0 || attachment >= count) {
        bag.error('pass-invalid-attachment',
            `${where} uses attachment ${attachment} of '${bufferId}', which has ${count}`)
            .add();
    }
}

function validatePass(
    pass: RenderPass,
    renderer: CompiledRenderer,
    framebufferConfigs: Map<string, FramebufferConfig>,
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
        checkBufferRef(`Pass '${pass.id}' output`, output, undefined, framebufferConfigs, 'pass-invalid-output', bag);
        baseBuffers.add(parseBufferRef(output).bufferId);
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
            // 'extern:' is a RESERVED prefix (§2.10): the ref is resolved from the engine's
            // texture registry at bind time, not from a framebuffer. Loading is async, so
            // existence can't be validated here — a missing key at bind is a hard, named
            // engine error (never a silent unit-0 sample).
            if (bufferRef.startsWith('extern:')) {
                if (bufferRef.length <= 'extern:'.length) {
                    bag.error('pass-invalid-texture',
                        `Pass '${pass.id}' binds texture '${uniformName}' with an empty extern name`)
                        .add();
                }
                continue;
            }

            checkBufferRef(`Pass '${pass.id}' texture '${uniformName}'`, bufferRef, undefined, framebufferConfigs, 'pass-invalid-texture', bag);
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
    framebufferConfigs: Map<string, FramebufferConfig>,
    bag: DiagnosticBag
): void {
    for (const [exportName, target] of Object.entries(exports)) {
        checkBufferRef(`Export '${exportName}'`, target.bufferId, target.attachment, framebufferConfigs, 'export-invalid-buffer', bag);
    }
}

/**
 * Validate the on-demand LDR recipe: it re-runs a pass of this pipeline, into a buffer of it,
 * with its inputs re-aimed at buffers of it.
 */
function validateLdrRecipe(
    renderer: CompiledRenderer,
    framebufferConfigs: Map<string, FramebufferConfig>,
    bag: DiagnosticBag
): void {
    const recipe = renderer.ldrRecipe!;
    if (!renderer.pipeline.passes.some((p) => p.id === recipe.passId)) {
        bag.error('recipe-invalid', `The LDR recipe re-runs pass '${recipe.passId}', which the pipeline does not have`).add();
    }
    checkBufferRef('The LDR recipe output', recipe.output, undefined, framebufferConfigs, 'recipe-invalid', bag);
    for (const [uniformName, ref] of Object.entries(recipe.inputs)) {
        if (ref.startsWith('extern:')) continue;
        checkBufferRef(`The LDR recipe input '${uniformName}'`, ref, undefined, framebufferConfigs, 'recipe-invalid', bag);
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
