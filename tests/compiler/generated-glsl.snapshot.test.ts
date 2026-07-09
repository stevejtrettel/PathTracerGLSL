import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { CompiledRenderer, SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from '../../src/compiler/scenes/minimalScene.js';
import { cornellBox, cornellStrategy } from '../../src/compiler/scenes/cornellBox.js';
import { twoLightScene, twoLightPowerStrategy, twoLightUniformStrategy } from '../../src/compiler/scenes/twoLightScene.js';
import { furnaceBox, furnaceStrategy } from '../../src/compiler/scenes/furnaceBox.js';

/**
 * Golden snapshot of the compiler's entire output surface — the safety net for the
 * §2.10 resource-contributions refactor (see docs/impl-plan-2.10-contributions.md).
 *
 * The refactor moves *where* uniforms/defines/blocks/parameters are assembled, but must
 * change *nothing* in the generated GLSL or the flat CompiledRenderer. This snapshot is
 * the proof: a byte-identical match after the refactor means behavior is preserved
 * without ever touching a GPU. Any drift fails here, loudly, with a diff.
 *
 * Captured: both fragment shaders (the GLSL), the vertex shader, the uniform bindings
 * (name/type/paths, in order — `compute` fns omitted as they don't serialize), the
 * parameter metadata, the pipeline, the export targets, and the source-map block
 * provenance (origin + line ranges — error-mapping is live and depends on it).
 */
function surface(r: CompiledRenderer) {
    const shaders: Record<string, { vertex: string; fragment: string }> = {};
    for (const [id, s] of r.shaders) shaders[id] = { vertex: s.vertex, fragment: s.fragment };

    const sourceMaps: Record<string, Array<{ origin: string; startLine: number; endLine: number }>> = {};
    for (const [id, sm] of r.sourceMaps ?? []) {
        sourceMaps[id] = sm.blocks.map(b => ({ origin: b.origin, startLine: b.startLine, endLine: b.endLine }));
    }

    return {
        id: r.id,
        shaders,
        uniforms: r.uniforms.map(u => ({ uniform: u.uniform, type: u.type, parameters: u.parameters })),
        parameters: r.parameters,
        pipeline: r.pipeline,
        exportTargets: r.exportTargets,
        sourceMaps,
    };
}

const compiler = new Compiler();

const cases: Array<[string, SceneDescription, RenderStrategy]> = [
    ['cornell + pathtracer', cornellBox, cornellStrategy],
    ['minimal + pathtracer', minimalScene, minimalStrategy],
    ['minimal + direct', minimalScene, directOnlyStrategy],
    // Suite additions: the multi-light CDF branch + the lightSelection axis (item 3),
    // and the furnace emitter (energy conservation).
    ['two-light + power', twoLightScene, twoLightPowerStrategy],
    ['two-light + uniform', twoLightScene, twoLightUniformStrategy],
    ['furnace + no-direct', furnaceBox, furnaceStrategy],
];

describe('generated GLSL snapshot (§2.10 refactor safety net)', () => {
    for (const [name, scene, strategy] of cases) {
        it(name, () => {
            expect(surface(compiler.compile(scene, strategy))).toMatchSnapshot();
        });
    }
});
