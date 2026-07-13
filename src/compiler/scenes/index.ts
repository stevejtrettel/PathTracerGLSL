// compiler/scenes/index.ts
// The scene suite: a registry of small scenes, each pinpointing a compiler feature so we
// have something concrete to compile, snapshot, and look at as the migration proceeds.
//
// Each entry pairs a scene with one or more strategies (each strategy is a renderer, keys
// 1-9 in the dev app) plus a default camera pose. `examples/scene-lab.ts` reads a scene
// from here by id (?scene=<id>). Test coverage: sceneSuite.test.ts iterates EVERY
// (scene, strategy) pair (compile-smoke + ID convention); the golden snapshot test keeps
// its own explicit case list — keep it in sync when adding pairs here.

import type { SceneDescription, RenderStrategy } from '../types.js';

import { cornellBox, cornellStrategy } from './cornellBox.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from './minimalScene.js';
import {
    twoLightScene,
    twoLightPowerStrategy,
    twoLightUniformStrategy,
} from './twoLightScene.js';
import { furnaceBox, furnaceStrategy } from './furnaceBox.js';
import { veachMis, veachMisStrategy, veachNeeStrategy, veachPtStrategy } from './ggxScenes.js';
import { analyticMinimal, mixedScene, analyticStrategy } from './analyticScenes.js';
import {
    etaScene,
    etaStrategy,
    submergedScene,
    submergedStrategy,
    cornellGlass,
    analyticGlass,
    glassStrategy,
} from './dielectricScenes.js';
import {
    slabScene,
    slabStrategy,
    fogcubeScene,
    fogcubeStrategy,
    furnaceScatterScene,
    furnaceScatterStrategy,
    hazeScene,
    hazeNeeStrategy,
    hazePtStrategy,
} from './mediaScenes.js';
import {
    marbleScene,
    marbleStrategy,
    marbleNoScatterStrategy,
    mistScene,
    mistStrategy,
} from './demoScenes.js';
import {
    cornellArea,
    cornellAreaNeeStrategy,
    cornellAreaPtStrategy,
    cornellAreaMisStrategy,
    cornellAreaGlass,
    fogArea,
    fogAreaNeeStrategy,
    fogAreaMisStrategy,
    fogAreaPtStrategy,
    fogPanel,
    orbScene,

    orbNeeStrategy,
    orbPtStrategy,
} from './areaLightScenes.js';
import {
    skyScene, skyPtStrategy, skyNeeStrategy, skyMisStrategy,
    furnaceSkyScene, furnaceSkyNeeStrategy, furnaceSkyMisStrategy, furnaceSkyPtStrategy,
    skyLampScene, skyLampNeeStrategy, skyLampMisStrategy, skyLampPtStrategy,
    procSkyScene, procSkyNeeStrategy, procSkyMisStrategy, procSkyPtStrategy,
    skyMisOctStrategy, procSkyMisCompStrategy,
} from './envScenes.js';

export interface SceneSuiteEntry {
    scene: SceneDescription;
    /** One renderer per strategy; the dev app binds them to keys 1-9 in order. */
    strategies: RenderStrategy[];
    /** What this scene is for — which feature(s) it exercises. */
    exercises: string;
    /**
     * The pass criterion, when the scene has one — a derived number (validation-scenes doc)
     * or a checkable invariant. Displayed on the suite gallery; the future §11 harness
     * asserts the numeric ones automatically.
     */
    expected?: string;
    /** Default camera pose (and any other live params) for viewing. */
    initialParameters?: Record<string, unknown>;
}

export const sceneSuite: Record<string, SceneSuiteEntry> = {
    'two-light': {
        scene: twoLightScene,
        strategies: [twoLightPowerStrategy, twoLightUniformStrategy],
        exercises:
            'multi-light CDF dispatcher (lights.length>1); lightSelection power (key 1) vs uniform (key 2)',
        expected: 'power (key 1) and uniform (key 2) converge to the SAME image; power is lower-variance',
        initialParameters: {
            'camera.position': [0, 1.2, 4],
            'camera.target': [0, 0.5, 0],
        },
    },
    furnace: {
        scene: furnaceBox,
        strategies: [furnaceStrategy],
        exercises:
            'emission + energy conservation (F-BOX); expect linear-HDR mean = 0.4 everywhere',
        expected: 'every pixel = EXACTLY 0.4 in linear HDR (F-BOX: Le/(1−ρ) = 0.2/0.5)',
        initialParameters: {
            'camera.position': [0, 0, 0],
            'camera.target': [0, 0, -1],
        },
    },
    cornell: {
        scene: cornellBox,
        strategies: [cornellStrategy],
        exercises: 'region disambiguation (5 white walls → 1 material); {param} albedo; fov uniform',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    minimal: {
        scene: minimalScene,
        strategies: [minimalStrategy, directOnlyStrategy],
        exercises: 'constant environment; pathtracer vs direct-only strategy from one scene',
        initialParameters: {
            'camera.position': [0, 1, 5],
            'camera.target': [0, 0, 0],
        },
    },
    'analytic-minimal': {
        scene: analyticMinimal,
        strategies: [analyticStrategy],
        exercises: 'analytic backend (closed-form sphere+plane); cross-method twin of `minimal` — same image',
        expected: 'converges to the same image as `minimal` (strategy 1)',
        initialParameters: {
            'camera.position': [0, 1, 5],
            'camera.target': [0, 0, 0],
        },
    },
    mixed: {
        scene: mixedScene,
        strategies: [analyticStrategy],
        exercises: 'combined scene_intersect (SDF + analytic in one scene); cross-backend shadows',
        expected: 'both spheres cast shadows on the analytic floor; no backend-dependent artifacts',
        initialParameters: {
            'camera.position': [0, 1.5, 6],
            'camera.target': [0, 0, 0],
        },
    },
    eta: {
        scene: etaScene,
        strategies: [etaStrategy],
        exercises:
            'F-ETA η² witness (validation §3): center pixel = 0.5540 ± 1% linear HDR; omitting η² renders 0.980',
        expected: 'converged CENTER pixel = 0.5540 ± 1% in the linear HDR export (0.98 ⇒ η² factor missing)',
        initialParameters: {
            'camera.position': [0, 1, 0.05],
            'camera.target': [0, -1, 0],
        },
    },
    submerged: {
        scene: submergedScene,
        strategies: [submergedStrategy],
        exercises:
            'R-SUBMERGED innermost-wins witness (validation §5): sphere entry must classify region_from = water (η = 1.33/1.5); under deepest-wins the sphere is invisible',
        expected: 'the sphere VISIBLY distorts the checker with a Fresnel ring (invisible ⇒ classification bug); distortion is mild — relative η ≈ 1.13',
        initialParameters: {
            'camera.position': [0, 0, 2],
            'camera.target': [0, 0, 0],
        },
    },
    'cornell-glass': {
        scene: cornellGlass,
        strategies: [glassStrategy],
        exercises:
            'dielectric eyeball scene: Fresnel rim, TIR, inverted image; RR-on exercises etaScale; NEE guard skips shadow rays at glass. Dark shadow under the sphere is CORRECT v1 (§6.3 shadow-opaque + delta light — caustics need area lights)',
        expected: 'Fresnel rim + inverted Cornell through the sphere; DARK shadow under it is correct v1; converges to the same image as analytic-glass',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'analytic-glass': {
        scene: analyticGlass,
        strategies: [glassStrategy],
        exercises:
            'cross-backend twin of cornell-glass (analytic glass sphere, interior far-root) — must converge to the same image',
        expected: 'converged image identical to cornell-glass',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    slab: {
        scene: slabScene,
        strategies: [slabStrategy],
        exercises:
            'F-SLAB Beer–Lambert witness (validation §2): null interfaces (model none), spectral σ_a, current_medium across two null crossings',
        expected:
            'converged CENTER pixel = (0.36788, 0.13534, 0.01832) ± 1%/channel in linear HDR (the SQUARE of those ⇒ double-attenuation; a Fresnel shift ⇒ null-BSDF leak)',
        initialParameters: {
            'camera.position': [0, 0, 2],
            'camera.target': [0, 0, -2],
        },
    },
    fogcube: {
        scene: fogcubeScene,
        strategies: [fogcubeStrategy],
        exercises:
            'R-FOGCUBE null-interface rim witness (validation §5, absorbing variant): a bounded absorber over an emissive checker',
        expected:
            'the cube dims the checker behind it with NO bright rim at the silhouette (a Fresnel-like edge = the null interface leaked a BSDF); grazing edges fade smoothly',
        initialParameters: {
            'camera.position': [0, 1.6, 3],
            'camera.target': [0, 0.9, 0],
        },
    },
    'furnace-scatter': {
        scene: furnaceScatterScene,
        strategies: [furnaceScatterStrategy],
        exercises:
            'F-BOX-M chromatic scattering furnace (validation §1b): channel-MIS medium sampling, HG normalization, medium-event weights, §7.2 bounce accounting',
        expected:
            'per-channel mean = EXACTLY 0.4 ± 0.004 in linear HDR at high spp — channels splitting ⇒ chromatic weight bug; mean below 0.4 ⇒ bounce starvation (raise maxBounces)',
        initialParameters: {
            'camera.position': [0, 0, 0],
            'camera.target': [0, 0, -1],
        },
    },
    haze: {
        scene: hazeScene,
        strategies: [hazeNeeStrategy, hazePtStrategy],
        exercises:
            'HG-sign witness + medium NEE + spectral shadow_media (light shafts); {param}-driven haze.g; key 2 (pt) sees only the emissive panel — delta lights are invisible to phase paths (the equality pair is X-FOG, deferred to area lights)',
        expected:
            'drag haze.g: POSITIVE g brightens the glow around the light direction, negative dims it (inverted ⇒ the +2gc HG sign bug); key 1 ≥ key 2 everywhere by exactly the point-light term; spike-noise halos near the light are EXPECTED (equiangular placement is deferred)',
        initialParameters: {
            'camera.position': [0, 1.2, 5],
            'camera.target': [0, 1.2, -1],
        },
    },
    marble: {
        scene: marbleScene,
        strategies: [marbleStrategy, marbleNoScatterStrategy],
        exercises:
            'DEMO — dielectric surface + scattering interior composed in ONE material, lit by an emissive panel (point lights cannot NEE-light a glass shell, §6.3); {param} smoke color + g; key 2 = volumeIntegrator none (scattering off)',
        expected:
            'a glowing storm-cloud core inside the glass, Fresnel rim from the panel below, dark moody surround; key 2 collapses the interior to clear tinted glass — the difference IS the volume integrator',
        initialParameters: {
            'camera.position': [0.4, 1.15, 3.2],
            'camera.target': [0, 0.55, 0],
        },
    },
    mist: {
        scene: mistScene,
        strategies: [mistStrategy],
        exercises:
            'DEMO — bounded ground-fog layer (null interfaces at world scale), camera INSIDE the volume (classification-init, §4.4), medium NEE shafts from a warm sun, aerial perspective; {param} mist.density',
        expected:
            'warm crepuscular shadow-lanes between backlit stones, far monoliths fading into the haze, cool clear sky above the fog layer; expect halo spike-noise near the sun direction (equiangular is deferred)',
        initialParameters: {
            'camera.position': [0, 1.7, 6],
            'camera.target': [0, 1.6, -8],
        },
    },
    'cornell-area': {
        scene: cornellArea,
        strategies: [cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy],
        exercises:
            'X-CORNELL (validation §4): explicit quad light desugared to an emissive region; quad solid-angle pdf; §6.2 emission w-bookkeeping; the reference-§8 MIS diff (key 2)',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) ALL converge to the same image (§11.2: pairwise RMSE < 1.5% at 4096 spp) — nee/pt divergence implicates the w-bookkeeping or quad pdf; mis joining implicates lighting_pdf or the power heuristic; the panel is VISIBLE; shadows soft',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'cornell-area-glass': {
        scene: cornellAreaGlass,
        strategies: [cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy],
        exercises:
            'X-GLASS (validation §4): delta bookkeeping under a samplable emitter — prev_was_delta through specular chains, NEE skipped at glass, full-weight emission after delta, MIS emitter weight = 1 there',
        expected:
            'all three keys converge to the same image; the NOISIEST trio (double spp before suspecting bias); the panel appears in the glass sphere at full brightness',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'fog-area': {
        scene: fogArea,
        strategies: [fogAreaNeeStrategy, fogAreaMisStrategy, fogAreaPtStrategy],
        exercises:
            'X-FOG proper (validation §4) — the resurrected haze equality pair: medium-NEE toward a hittable quad through haze; hg_eval/hg_sample consistency; the medium-side MIS weight (hg_pdf); spectral shadow_media segments',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image, light shafts included — pt vs pt-nee divergence is the HG sign/eval-desync regression; pt-mis divergence implicates hg_pdf or lighting_pdf',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'fog-panel': {
        scene: fogPanel,
        strategies: [fogAreaNeeStrategy, fogAreaPtStrategy],
        exercises:
            'audit-H2 witness: back-face hits on a zero-thickness DIFFUSE quad (nonzero albedo) in ambient fog — the scene_region_thin entering-side probe vs the fabricated region_from that poisoned current_medium for one segment',
        expected:
            'keys 1 (pt-nee) and 2 (pt) converge to the same image with CONTINUOUS fog behind the panel — a dry rim behind the panel or pt/pt-nee divergence is the region_from fabrication regressing',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    sky: {
        scene: skyScene,
        strategies: [skyNeeStrategy, skyMisStrategy, skyPtStrategy, skyMisOctStrategy],
        exercises:
            'X-ENV (T3): the tabulated env as a samplable light — CDF inversion (env_sampler_cdf), pdf-from-CDF-differences, the sinθ Jacobian, miss-branch w-bookkeeping, env-only selection (probability 1). Plus T2: extern chain, rotation-sign chart fix, scene-driven HDR load',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image — divergence implicates the CDF build, the Jacobian, or the miss-weight bookkeeping. Key 4 (pt-mis-oct) is X-CHART (T5): the OCTAHEDRAL sampler on the bit-identical integrand — divergence from key 2 implicates the chart mapping or its constant Jacobian, nothing else. env.rotation pans everything consistently',
        initialParameters: {
            'camera.position': [0, 1.4, 5],
            'camera.target': [0, 0.9, 0],
        },
    },
    'furnace-sky': {
        scene: furnaceSkyScene,
        strategies: [furnaceSkyNeeStrategy, furnaceSkyMisStrategy, furnaceSkyPtStrategy],
        exercises:
            'W1/W2 (T3): the OPEN furnace — constant SAMPLABLE env (uniform-sphere sampler, pdf 1/4π), miss-branch bookkeeping in its purest form (no textures anywhere). RR off; display tonemap NONE for on-screen radiance checks',
        expected:
            'sphere/sky pixel ratio = ρ = 0.4 EXACTLY (convex body: exit radiance ρ·L, single bounce — the closed-furnace L/(1−ρ) does NOT apply), sky pixels = L, on ALL THREE keys — any key diverging implicates the env miss-weight or the uniform-sphere pdf',
        initialParameters: {
            'camera.position': [0, 0, 3.5],
            'camera.target': [0, 0, 0],
        },
    },
    'sky-lamp': {
        scene: skyLampScene,
        strategies: [skyLampNeeStrategy, skyLampMisStrategy, skyLampPtStrategy],
        exercises:
            'TWO-STAGE selection (T3, plan D3): image env AND a quad light — u_envSelectProb stage 0, the wrapped lighting_sample_finite CDF, the (1−P) factor in lighting_pdf, and the P factor in the miss-MIS weight. The full §6.1 pdf symmetry across techniques',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image (warm lamp pool + cool sky fill); sweeping env.selectProb changes NOISE ONLY, never brightness — brightness drift under the sweep is a selection-pdf asymmetry. KNOWN estimator boundary: sun-through-glass is BSDF-only in ALL keys (delta lobes skip NEE, §6.3 blocks shadow rays at glass) — equal noise there across keys is expected, not a bug',
        initialParameters: {
            'camera.position': [0, 1.4, 5],
            'camera.target': [0, 0.9, 0],
        },
    },
    'proc-sky': {
        scene: procSkyScene,
        strategies: [procSkyNeeStrategy, procSkyMisStrategy, procSkyPtStrategy, procSkyMisCompStrategy],
        exercises:
            'T4 procedural environment: the one-shot GPU bake (fixed-size framebuffer + readExport, app-orchestrated), formula direct-eval at lookup (sharp sun), CDF from the baked table, the sampler-radiance unification (ls.radiance ≡ environment_radiance)',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image; pt-nee resolves the ~2° sun\'s illumination orders of magnitude faster than pt (that asymmetry IS the CDF working); sun disk edges stay SHARP at any zoom (direct-eval, not table-resolution). Key 4 (pt-mis-comp, W9): SAME converged image with a compensated table — the win is lower noise at equal time on the sky-dominated regions',
        initialParameters: {
            'camera.position': [0, 1.4, 5],
            'camera.target': [0, 0.9, 0],
        },
    },
    orb: {
        scene: orbScene,
        strategies: [orbNeeStrategy, orbPtStrategy],
        exercises:
            'sphere light via the sampleAsLight route (emissive analytic sphere, default-true registry entry); visible-cone sampling; delta bookkeeping (glass keeps full-weight emission after specular chains)',
        expected:
            'keys 1 (pt-nee) and 2 (pt) converge to the same image; the orb is visible directly AND in the glass reflections; soft shadow from the box',
        initialParameters: {
            'camera.position': [0, 1.3, 3.4],
            'camera.target': [0, 0.7, 0],
        },
    },
    'veach-mis': {
        scene: veachMis,
        strategies: [veachMisStrategy, veachNeeStrategy, veachPtStrategy],
        exercises:
            'GGX (first glossy BSDF: VNDF sampling, Smith G, Schlick F) under the classic Veach MIS geometry — four roughness steps × three light sizes at ~equal power; the power heuristic at both scoring sites with a peaked non-delta pdf',
        expected:
            'keys 1 (pt-mis), 2 (pt-nee), 3 (pt) converge to the SAME image (§11.2); pt-mis is visibly lowest-variance on EVERY plate — pt-nee fireflies on smooth-plate × big-light, pt fireflies on rough-plate × small-light; divergence implicates ggx_pdf/ggx_sample agreement (§11.3) or the MIS weights',
        initialParameters: {
            'camera.position': [0, 1.3, 5.5],
            'camera.target': [0, 0.55, 0],
        },
    },
};

export const DEFAULT_SCENE = 'two-light';
