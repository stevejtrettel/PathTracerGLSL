import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { CompiledRenderer, SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from '../../src/compiler/scenes/minimalScene.js';
import { cornellBox, cornellStrategy } from '../../src/compiler/scenes/cornellBox.js';
import { twoLightScene, twoLightPowerStrategy, twoLightUniformStrategy } from '../../src/compiler/scenes/twoLightScene.js';
import { furnaceBox, furnaceStrategy, furnaceVarianceStrategy } from '../../src/compiler/scenes/furnaceBox.js';
import { analyticMinimal, mixedScene, analyticStrategy } from '../../src/compiler/scenes/analyticScenes.js';
import { etaScene, etaStrategy, submergedScene, submergedStrategy, cornellGlass, analyticGlass, glassStrategy } from '../../src/compiler/scenes/dielectricScenes.js';
import { slabScene, slabStrategy, fogcubeScene, fogcubeStrategy, furnaceScatterScene, furnaceScatterStrategy, hazeScene, hazeNeeStrategy, hazePtStrategy } from '../../src/compiler/scenes/mediaScenes.js';
import { marbleScene, marbleStrategy, marbleNoScatterStrategy, mistScene, mistStrategy } from '../../src/compiler/scenes/demoScenes.js';
import { cornellArea, cornellAreaNeeStrategy, cornellAreaPtStrategy, cornellAreaMisStrategy, cornellAreaGlass, fogArea, fogAreaNeeStrategy, fogAreaMisStrategy, fogAreaPtStrategy, fogPanel, orbScene, orbNeeStrategy, orbPtStrategy } from '../../src/compiler/scenes/areaLightScenes.js';
import { skyScene, skyPtStrategy, skyNeeStrategy, skyMisOctStrategy, furnaceSkyScene, furnaceSkyNeeStrategy, furnaceSkyMisStrategy, skyLampScene, skyLampMisStrategy, procSkyScene, procSkyNeeStrategy, procSkyMisCompStrategy } from '../../src/compiler/scenes/envScenes.js';

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
    // Variance accumulation occupant (measurement bench): MRT header (fragMoment),
    // u_previousMoment sampler, the Welford main, dual-output pipeline + variance export.
    ['furnace + variance', furnaceBox, furnaceVarianceStrategy],
    // Analytic backend: all-analytic (cross-method twin of minimal) + mixed SDF/analytic dispatch.
    ['analytic-minimal', analyticMinimal, analyticStrategy],
    ['mixed backends', mixedScene, analyticStrategy],
    // Dielectric (impl-plan-dielectric): ior_of + dielectric dispatch + NEE guard + etaScale,
    // across the witnesses (η², innermost-wins) and both geometry backends.
    ['eta witness', etaScene, etaStrategy],
    ['submerged witness', submergedScene, submergedStrategy],
    ['cornell-glass', cornellGlass, glassStrategy],
    ['analytic-glass', analyticGlass, glassStrategy],
    // Media (impl-plan-media M1): null interfaces + absorbing media — HAS_MEDIA/
    // HAS_NULL_INTERFACES defines, media tables, medium_sample dispatch, emission gate.
    ['slab witness', slabScene, slabStrategy],
    ['fogcube witness', fogcubeScene, fogcubeStrategy],
    // Media (M2): scattering — HAS_SCATTERING, channel-MIS arms, phase_hg, ambientMedium
    // (material_of(-1)), medium events; haze additionally: medium NEE + shadow_media +
    // {param}-driven phase_g, and the pt variant (scattering without NEE).
    ['furnace-scatter witness', furnaceScatterScene, furnaceScatterStrategy],
    ['haze + pt-nee', hazeScene, hazeNeeStrategy],
    ['haze + pt', hazeScene, hazePtStrategy],
    // Demos: dielectric+medium in one material (marble; key 2 = volumeIntegrator 'none'
    // collapsing the scattering arms) and camera-inside-bounded-fog (mist; classification-init).
    ['marble demo', marbleScene, marbleStrategy],
    ['marble demo (no scatter)', marbleScene, marbleNoScatterStrategy],
    ['mist demo', mistScene, mistStrategy],
    // Area lights (impl-plan-area-lights phase A): quad desugar + light_of + w-bookkeeping
    // (cornell-area, both strategies — pt has NO light_of table); sphere light via the
    // sampleAsLight route (orb).
    ['cornell-area + pt-nee', cornellArea, cornellAreaNeeStrategy],
    ['cornell-area + pt', cornellArea, cornellAreaPtStrategy],
    ['orb + pt-nee', orbScene, orbNeeStrategy],
    // MIS (phase B): ENABLE_MIS + lighting_pdf + power_heuristic + prev_bsdf_pdf; the glass
    // variant exercises delta bookkeeping; fog-area is X-FOG (medium-side MIS + shadow_media).
    ['cornell-area + pt-mis', cornellArea, cornellAreaMisStrategy],
    ['cornell-area-glass + pt-mis', cornellAreaGlass, cornellAreaMisStrategy],
    ['fog-area + pt-mis', fogArea, fogAreaMisStrategy],
    // Audit H6.3: the previously-uncovered registry pairs (exactly the strategies the suite
    // gallery runs). fog-area+pt-nee is a genuinely distinct define combination — medium NEE
    // toward a quad WITHOUT ENABLE_MIS; the rest complete the glass/fog/orb strategy matrix.
    ['fog-area + pt-nee', fogArea, fogAreaNeeStrategy],
    ['fog-area + pt', fogArea, fogAreaPtStrategy],
    ['cornell-area-glass + pt-nee', cornellAreaGlass, cornellAreaNeeStrategy],
    ['cornell-area-glass + pt', cornellAreaGlass, cornellAreaPtStrategy],
    ['orb + pt', orbScene, orbPtStrategy],
    // Audit H2 witness: diffuse zero-thickness quad in fog → the scene_region_thin probe path.
    ['fog-panel + pt-nee', fogPanel, fogAreaNeeStrategy],
    ['fog-panel + pt', fogPanel, fogAreaPtStrategy],
    // env-as-light T2: image environment — env_equirect chart block, extern:env_map pass
    // input + sampler declaration, env.* uniforms.
    ['sky + pt', skyScene, skyPtStrategy],
    // env-as-light T3: samplable environments. sky+pt-nee = env-only tabulated selection;
    // furnace-sky = constant-samplable (uniform sphere, no textures) under NEE and MIS;
    // sky-lamp+pt-mis = the two-stage wrapper + scaled lighting_pdf + miss-MIS factor.
    ['sky + pt-nee', skyScene, skyNeeStrategy],
    ['furnace-sky + pt-nee', furnaceSkyScene, furnaceSkyNeeStrategy],
    ['furnace-sky + pt-mis', furnaceSkyScene, furnaceSkyMisStrategy],
    ['sky-lamp + pt-mis', skyLampScene, skyLampMisStrategy],
    // env-as-light T4: procedural env — formula direct-eval radiance body, CDF externs
    // WITHOUT u_envMap, the sampler-radiance unification.
    ['proc-sky + pt-nee', procSkyScene, procSkyNeeStrategy],
    // env-as-light T5: the strategy axis. Octahedral chart block + _oct extern names +
    // env.sizeOct; compensated tables reuse the chart but bind _comp extern names.
    ['sky + pt-mis-oct', skyScene, skyMisOctStrategy],
    ['proc-sky + pt-mis-comp', procSkyScene, procSkyMisCompStrategy],
];

describe('generated GLSL snapshot (§2.10 refactor safety net)', () => {
    for (const [name, scene, strategy] of cases) {
        it(name, () => {
            expect(surface(compiler.compile(scene, strategy))).toMatchSnapshot();
        });
    }
});
