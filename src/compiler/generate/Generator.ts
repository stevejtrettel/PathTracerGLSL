// compiler/generate/Generator.ts

import type { SceneDescription, RenderStrategy, CompiledRenderer, SourceMap } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { buildShaders } from './ShaderBuilder.js';
import { collectFeatures } from './features/index.js';
import { buildPipeline, buildUniforms, buildExportTargets, buildLdrRecipe } from './PipelineBuilder.js';

export function generate(
    plan: RenderPlan,
    scene: SceneDescription,
    strategy: RenderStrategy,
    bag: DiagnosticBag,
): CompiledRenderer {
    const rendererId = `${strategy.id}-${scene.id}`;

    // Merge every feature's contribution once (§2.10) — the single source of truth the
    // shaders, uniform bindings, and parameter metadata are all built from.
    const merged = collectFeatures(plan, bag);

    const pictures = plan.pipeline.pictures;
    const { shaders, sourceMaps: blockMaps } = buildShaders(merged, rendererId, plan.program.view.tonemap, pictures);

    // WebGL2 guarantees 4 draw buffers (MAX_DRAW_BUFFERS ≥ 4), and every picture is one of
    // them. Past the floor the engine would fail at load; reject it here with the roster.
    const DRAW_BUFFER_FLOOR = 4;
    if (pictures.length > DRAW_BUFFER_FLOOR) {
        bag.error('invalid-setting',
            `The render keeps ${pictures.length} pictures (${pictures.map((p) => p.name).join(', ')}) — over the guaranteed WebGL2 floor of ${DRAW_BUFFER_FLOOR} draw buffers (MAX_DRAW_BUFFERS)`)
            .add();
    }

    // The sampler BUDGET (fable-data-rail §5): count the REAL roster in each assembled
    // program against the WebGL2 spec floor of 16 fragment units — an over-budget program
    // is an itemized compile-time error, never a driver link mystery. Checked here (not
    // the Planner) because the assembled source is the one true roster (feature textures
    // + framebuffer inputs + loaders), so the check can never drift from what ships.
    // Rail v2 makes the count role-shaped (≤ ~13 worst case), so this is the tripwire
    // against future channel/texture creep, not a working constraint.
    const SAMPLER_FLOOR = 16;
    for (const [shaderId, shader] of shaders) {
        const samplers = samplerRoster(shader.fragment);
        if (samplers.length > SAMPLER_FLOOR) {
            bag.error('invalid-setting',
                `Program '${shaderId}' binds ${samplers.length} samplers — over the guaranteed WebGL2 floor of ${SAMPLER_FLOOR} fragment texture units (MAX_TEXTURE_IMAGE_UNITS). Roster: ${samplers.join(', ')}. Scenes must fit the portability floor (fable-data-rail §5).`)
                .add();
        }
    }
    const pipeline = buildPipeline(rendererId, plan, merged.textures);
    // The display pass's own resources ride here, not in a feature: the main program no
    // longer declares u_resolution (nothing in it reads the builtin — exact linkage), but
    // the display fragment ShaderBuilder emits does (gl_FragCoord → uv). ParameterManager
    // binds per-shader by location, so this binding is inert for the main program.
    const uniforms = buildUniforms([
        ...merged.uniforms,
        { name: 'u_resolution', type: 'vec2', parameterPath: 'engine.resolution' },
        // With more than one picture the display chooses one by index — the App's display state,
        // on the reserved no-reset channel; 0 is the main picture.
        ...(pictures.length > 1 ? [{ name: 'u_picture', type: 'int' as const, parameterPath: 'renderer.picture', default: 0 }] : []),
    ]);
    const parameters = merged.parameters;
    const exportTargets = buildExportTargets(pictures);

    // Convert BlockMapping[] to SourceMap objects, including assembled source
    const sourceMaps = new Map<string, SourceMap>();
    for (const [shaderId, blocks] of blockMaps) {
        const shader = shaders.get(shaderId);
        sourceMaps.set(shaderId, {
            shaderId,
            blocks: blocks.map(b => ({
                origin: b.origin,
                startLine: b.startLine,
                endLine: b.endLine,
            })),
            assembledSource: shader?.fragment,
        });
    }

    return {
        id: rendererId,
        shaders,
        pipeline,
        uniforms,
        parameters,
        exportTargets,
        ldrRecipe: buildLdrRecipe(pictures),   // the display re-run as data — the engine reads, never knows
        sourceMaps,
    };
}

/** The sampler uniforms a shader source declares, in order. Every sampler type the compiler
 *  declares takes one texture unit from the same pool: sampler2D, the integer usampler2D and the
 *  material image array's sampler2DArray. */
export function samplerRoster(source: string): string[] {
    return [...source.matchAll(/uniform\s+(?:highp\s+)?u?sampler2D(?:Array)?\s+(\w+)/g)].map((m) => m[1]);
}
