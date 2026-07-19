// compiler/generate/PipelineBuilder.ts

import type { RenderPipeline, CompiledRenderer } from '../types.js';
import type { RenderPlan, PlannedUniform } from '../plan/types.js';
import type { PlannedTexture } from './features/types.js';
import type { UniformBinding } from '../types.js';

export function buildPipeline(rendererId: string, plan: RenderPlan, externTextures: PlannedTexture[] = []): RenderPipeline {
    const planned = plan.pipeline;

    // Map pass roles to shader IDs
    const roleToShader: Record<string, string> = {
        'pathtracer': `${rendererId}-main`,
        'display': `${rendererId}-display`,
    };

    // Feature-declared external textures (§2.10) join the PATHTRACER pass inputs as
    // `extern:<name>` refs — the engine executor resolves them from the registry and
    // binds them to sequential units exactly like framebuffer refs.
    const externInputs = Object.fromEntries(externTextures.map(t => [t.name, t.source]));

    return {
        framebuffers: planned.framebuffers.map(fb => ({
            id: fb.id,
            type: fb.type,
            format: fb.format,
        })),
        passes: planned.passes.map(pass => ({
            id: `${pass.role}-pass`,
            shader: roleToShader[pass.role] ?? `${rendererId}-${pass.role}`,
            inputs: { textures: pass.role === 'pathtracer' ? { ...pass.inputs, ...externInputs } : pass.inputs },
            output: pass.output,
            execution: { type: 'once' as const },
        })),
        postFrame: {
            swaps: planned.swaps.map(s => ({
                type: 'swap' as const,
                buffers: s.buffers,
            })),
        },
    };
}

export function buildUniforms(uniforms: PlannedUniform[]): UniformBinding[] {
    const bindings: UniformBinding[] = [];

    for (const u of uniforms) {
        bindings.push({
            uniform: u.name,
            // Multi-path uniforms (driven placement: one vec4 ← several params) list
            // every path so ParameterManager re-computes on ANY of them changing.
            parameters: u.parameterPaths ?? [u.parameterPath],
            type: u.type as UniformBinding['type'],
            // A uniform may be a transform of its parameter(s) (e.g. u_tanFov = tan(fov/2)).
            compute: u.compute ?? ((params) => params[u.parameterPath] ?? u.default),
        });
    }

    return bindings;
}

/** The on-demand LDR recipe (E5): the display-pass re-run facts, shipped as DATA so the
 *  engine stays blind — this file owns the pass-id/buffer/input names, so it declares them. */
export function buildLdrRecipe(): NonNullable<CompiledRenderer['ldrRecipe']> {
    return {
        passId: 'display-pass',
        // Display's radiance input re-aimed at the POST-SWAP accumulation buffer, so the
        // LDR bytes match exactly what HDR export reads (impl-plan-display Stage 4).
        inputs: { u_radiance: 'accumulation_previous' },
        output: 'ldr',
    };
}

export function buildExportTargets(variance = false): CompiledRenderer['exportTargets'] {
    return {
        // 'previous', not 'current': exports run after renderFrame(), and the postFrame
        // swap has already flipped the ping-pong index — post-swap, the freshly written
        // frame lives in 'accumulation_previous'. Reading 'current' exports frame N-1.
        'hdr': { bufferId: 'accumulation_previous', format: 'float' },
        // LDR = the tonemapped + dithered display, rendered on demand into the 'ldr' buffer
        // (Engine.renderLdr) just before readExport('ldr'). See impl-plan-display Stage 4.
        'ldr': { bufferId: 'ldr', format: 'byte' },
        // The second-moment attachment (variance occupant): per-channel sample variance
        // v = M2/n; variance of the MEAN = v/n (readers divide). Same post-swap rule.
        ...(variance ? { 'variance': { bufferId: 'accumulation_previous', format: 'float' as const, attachment: 1 } } : {}),
    };
}
