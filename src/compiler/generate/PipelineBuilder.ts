// compiler/generate/PipelineBuilder.ts

import type { RenderPipeline, CompiledRenderer } from '../types.js';
import type { RenderPlan, PlannedUniform, PlannedPicture } from '../plan/types.js';
import { pictureBuffer, bufferRef } from '../plan/pictures.js';
import type { PlannedTexture } from './features/types.js';
import type { UniformBinding } from '../types.js';

/** A pass's engine id, from its planned role. */
function passId(role: string): string {
    return `${role}-pass`;
}

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
            id: passId(pass.role),
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

/** The view recipe (the contract's `ldrRecipe`): the display pass re-run on demand — into
 *  'ldr' for a PNG, or onto the screen to redraw — shipped as DATA so the engine stays blind.
 *  Every picture input is re-aimed at its AFTER-frame buffer (pictureBuffer), so what it draws
 *  matches exactly what that picture's export reads. */
export function buildLdrRecipe(pictures: PlannedPicture[]): NonNullable<CompiledRenderer['ldrRecipe']> {
    return {
        passId: passId('display'),
        inputs: Object.fromEntries(pictures.map((p) => [p.display, bufferRef(pictureBuffer(p, 'previous'))])),
        output: 'ldr',
    };
}

/** One float export per picture, named by the picture and read where its newest value is
 *  after the frame (pictureBuffer explains why that is `_previous`); then the LDR output,
 *  rendered on demand into the 'ldr' buffer (Engine.renderView) just before readExport('ldr'). */
export function buildExportTargets(pictures: PlannedPicture[]): CompiledRenderer['exportTargets'] {
    const targets: NonNullable<CompiledRenderer['exportTargets']> = {};
    for (const p of pictures) {
        const { bufferId, attachment } = pictureBuffer(p, 'previous');
        targets[p.name] = { bufferId, format: 'float', ...(attachment > 0 ? { attachment } : {}), picture: { view: p.view, formats: p.formats } };
    }
    targets.ldr = { bufferId: 'ldr', format: 'byte' };
    return targets;
}
