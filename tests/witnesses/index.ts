// witnesses/index.ts — the GPU witness registry: the executable form of
// docs/fable-validation-scenes.md.
//
// This is the durable test system, NOT the demo gallery. Everything here — scenes,
// strategies, checks, camera poses — is owned by the witness system: fixtures live in
// ./scenes/, and nothing in demos/ (the replaceable demo layer) may be
// referenced from here. The demo gallery MERGES this registry into its own for
// display, so every witness stays viewable/orbitable in the lab; the dependency
// direction is demos → witnesses, never the reverse.
//
// `npm run witness` (tools/witness.mjs) iterates exactly this registry. Entries
// without a `witness` block are fixture partners (a twin's other half) — they must
// live here so a twin check's scene-id reference can never dangle when demos churn.
// See ./README.md for the gate policy (χ² vs rmse) and how to add a witness.

import type { SceneSuiteEntry } from './types.js';
import type { RenderStrategy, Vec3 } from '../../src/compiler/types.js';
import { withPose } from '../../src/authoring/strategy.js';

import { twoLightScene, twoLightPowerStrategy, twoLightUniformStrategy } from './scenes/twoLightScene.js';
import { furnaceBox, furnaceStrategy, furnaceVarianceStrategy } from './scenes/furnaceBox.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from './scenes/minimalScene.js';
import { analyticMinimal, analyticStrategy } from './scenes/analyticMinimal.js';
import { etaScene, etaStrategy, cornellGlass, analyticGlass, glassStrategy } from './scenes/dielectricWitness.js';
import {
    slabScene, slabStrategy,
    furnaceScatterScene, furnaceScatterStrategy,
    hazeScene, hazeNeeStrategy, hazeEquiangularStrategy, hazePtStrategy,
} from './scenes/mediaWitness.js';
import {
    cornellArea, cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy,
    cornellAreaGlass,
    fogArea, fogAreaNeeStrategy, fogAreaMisStrategy, fogAreaPtStrategy,
    fogPanel,
    orbScene, orbNeeStrategy, orbPtStrategy,
} from './scenes/areaLightScenes.js';
import {
    skyScene, skyPtStrategy, skyNeeStrategy, skyMisStrategy,
    furnaceSkyScene, furnaceSkyNeeStrategy, furnaceSkyMisStrategy, furnaceSkyPtStrategy,
    skyLampScene, skyLampNeeStrategy, skyLampMisStrategy, skyLampPtStrategy,
    procSkyScene, procSkyNeeStrategy, procSkyMisStrategy, procSkyPtStrategy,
    skyMisOctStrategy, procSkyMisCompStrategy,
} from './scenes/envScenes.js';
import { veachMis, veachMisStrategy, veachNeeStrategy, veachPtStrategy } from './scenes/ggxScenes.js';
import { mirrorScene, mirrorNeeStrategy, mirrorPtStrategy } from './scenes/mirrorWitness.js';
import {
    cornellDisk, cornellDiskNeeStrategy, cornellDiskMisStrategy, cornellDiskPtStrategy,
    diskBake, diskBakeRef, diskBakeStrategy,
} from './scenes/diskWitness.js';
import { spotScene, spotNeeStrategy } from './scenes/spotWitness.js';
import { cornellBox as camCornell, camPinholeStrategy, camThinlensZeroStrategy } from './scenes/cameraWitness.js';
import {
    transformBake, transformBakeRef, transformNeeStrategy, flattenTree,
    conjugationScene, conjugationBase, CONJ_CAMERA_BASE, CONJ_CAMERA_G,
    regionsTransformed, regionsTransformedRef, regionsNeeStrategy,
} from './scenes/transformWitness.js';
import { drivenScene, drivenBakedTheta, drivenBakedTheta2, drivenNeeStrategy, THETA2 } from './scenes/drivenWitness.js';
import {
    hetConstScene, hetConstRef, hetNeeStrategy, hetPtStrategy, hetRefNeeStrategy, hetRefPtStrategy,
    hetSlabScene, hetSlabStrategy,
    clampScene, clampRef, clampStrategy, clampRefStrategy,
    hetDrivenScene, hetDrivenBaked, hetDrivenBaked2, HET_THETA2,
} from './scenes/heterogeneousWitness.js';
import {
    emitScene, emitSwapScene, emitStrategy, emitSwapStrategy,
    emitSatScene, emitSatStrategy,
    emitScatterScene, emitScatterNeeStrategy, emitScatterPtStrategy,
} from './scenes/emissionWitness.js';

/** Camera pose is MEASUREMENT data: strategy literals are shared across scenes, so
 *  each entry stamps its pose onto its strategies here (no more pose-as-loose-
 *  initialParameters — (scene, strategy) alone determines the converged image). */
const posed = (position: Vec3, target: Vec3, ...strategies: RenderStrategy[]) =>
    strategies.map((s) => withPose(s, position, target));

export const witnessSuite: Record<string, SceneSuiteEntry> = {
    'thinlens-zero': {
        scene: camCornell,
        strategies: posed([0, 1, 4], [0, 1, 0], camPinholeStrategy, camThinlensZeroStrategy),
        exercises:
            'thin-lens correctness anchor: aperture = 0 (key 2) must reproduce the pinhole image (key 1) exactly — the lens disk collapses to a point. Both cameras draw xiLens, so the arms share the RNG stream.',
        expected: 'key 1 (pinhole) and key 2 (thin-lens, aperture 0) are the same image; any visible difference is a frame/focus-math bug',
        witness: {
            spp: 64,
            // Identical-stream arms (only thin-lens\'s normalize(dir·k) round-trip differs
            // in the last fp bits) → the display-space RMSE gate, not χ².
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'thin-lens aperture-0 ≡ pinhole' }],
        },
    },
    'two-light': {
        scene: twoLightScene,
        strategies: posed([0, 1.2, 4], [0, 0.5, 0], twoLightPowerStrategy, twoLightUniformStrategy),
        exercises:
            'multi-light CDF dispatcher (lights.length>1); lightSelection power (key 1) vs uniform (key 2)',
        expected: 'power (key 1) and uniform (key 2) converge to the SAME image; power is lower-variance',
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'power ≡ uniform' }],
        },
    },
    furnace: {
        scene: furnaceBox,
        strategies: posed([0, 0, 0], [0, 0, -1], furnaceStrategy, furnaceVarianceStrategy),
        exercises:
            'emission + energy conservation (F-BOX); expect linear-HDR mean = 0.4 everywhere. Key 2 = the VARIANCE accumulation occupant (Welford MRT): same walk, same mean, plus the second-moment buffer',
        expected: 'every pixel = EXACTLY 0.4 in linear HDR (F-BOX: Le/(1−ρ) = 0.2/0.5); key 2 identical (the variance occupant must not touch the mean)',
        witness: {
            spp: 48,
            checks: [
                { kind: 'mean', value: 0.4, tol: 0.008, label: 'F-BOX 0.4' },
                { kind: 'mean', value: 0.4, tol: 0.008, strategy: 1, label: 'F-BOX 0.4 (variance occupant)' },
                // Same RNG stream + same mix() update ⇒ the two means should agree to
                // fp32 noise, not just statistically — hence the near-zero gates.
                { kind: 'equality', strategies: [0, 1], meanTol: 0.001, rmse: 0.002, label: 'variance occupant mean untouched' },
            ],
        },
    },
    // Fixture partner: the SDF half of the analytic-minimal twin (and the direct-only
    // strategy demo rides along on key 2).
    minimal: {
        scene: minimalScene,
        strategies: posed([0, 1, 5], [0, 0, 0], minimalStrategy, directOnlyStrategy),
        exercises: 'constant environment; pathtracer vs direct-only strategy from one scene; twin partner of analytic-minimal',
    },
    'analytic-minimal': {
        scene: analyticMinimal,
        strategies: posed([0, 1, 5], [0, 0, 0], analyticStrategy),
        exercises: 'analytic backend (closed-form sphere+plane); cross-method twin of `minimal` — same image',
        expected: 'converges to the same image as `minimal` (strategy 1)',
        witness: {
            spp: 192,
            // Backend twins use the display-space gate, NOT χ²: marching vs closed-form
            // differ DETERMINISTICALLY at silhouette pixels (and the constant-env
            // background has zero variance), so the same-integrand premise of χ² fails
            // even though the converged IMAGES agree. Measured 3.5% at this budget.
            checks: [{ kind: 'twin', other: { scene: 'minimal' }, meanTol: 0.02, rmse: 0.08, label: 'analytic ≡ SDF backend' }],
        },
    },
    eta: {
        scene: etaScene,
        strategies: posed([0, 1, 0.05], [0, -1, 0], etaStrategy),
        exercises:
            'F-ETA η² witness (validation §3): center pixel = 0.5540 ± 1% linear HDR; omitting η² renders 0.980',
        expected: 'converged CENTER pixel = 0.5540 ± 1% in the linear HDR export (0.98 ⇒ η² factor missing)',
        witness: {
            spp: 128,
            checks: [{
                kind: 'mean', value: 0.554, tol: 0.01,
                region: { x: 0.47, y: 0.47, w: 0.06, h: 0.06 },
                label: 'F-ETA η² 0.5540',
            }],
        },
    },
    // Fixture partner: the SDF half of the analytic-glass twin (and the dielectric
    // eyeball scene — Fresnel rim, TIR, inverted image; dark shadow is correct v1).
    'cornell-glass': {
        scene: cornellGlass,
        strategies: posed([0, 1, 4], [0, 1, 0], glassStrategy),
        exercises:
            'dielectric eyeball scene: Fresnel rim, TIR, inverted image; RR-on exercises etaScale; NEE guard skips shadow rays at glass. Dark shadow under the sphere is CORRECT v1 (§6.3 shadow-opaque + delta light — caustics need area lights); twin partner of analytic-glass',
        expected: 'Fresnel rim + inverted Cornell through the sphere; DARK shadow under it is correct v1; converges to the same image as analytic-glass',
    },
    'analytic-glass': {
        scene: analyticGlass,
        strategies: posed([0, 1, 4], [0, 1, 0], glassStrategy),
        exercises:
            'cross-backend twin of cornell-glass (analytic glass sphere, interior far-root) — must converge to the same image',
        expected: 'converged image identical to cornell-glass',
        witness: {
            spp: 256,
            // rmse, not χ², for the same backend-twin reason as analytic-minimal
            // (glass noise happens to mask the deterministic edge differences today,
            // but the gate shouldn't depend on that). Measured 0.97% at this budget.
            checks: [{ kind: 'twin', other: { scene: 'cornell-glass' }, meanTol: 0.03, rmse: 0.08, label: 'glass analytic ≡ SDF backend' }],
        },
    },
    slab: {
        scene: slabScene,
        strategies: posed([0, 0, 2], [0, 0, -2], slabStrategy),
        exercises:
            'F-SLAB Beer–Lambert witness (validation §2): null interfaces (model none), spectral σ_a, current_medium across two null crossings',
        expected:
            'converged CENTER pixel = (0.36788, 0.13534, 0.01832) ± 1%/channel in linear HDR (the SQUARE of those ⇒ double-attenuation; a Fresnel shift ⇒ null-BSDF leak)',
        witness: {
            spp: 48,
            checks: [{
                kind: 'mean', value: [0.36788, 0.13534, 0.01832], tol: [0.004, 0.0015, 0.0005],
                region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                label: 'F-SLAB Beer–Lambert e^{-σt}',
            }],
        },
    },
    'furnace-scatter': {
        scene: furnaceScatterScene,
        strategies: posed([0, 0, 0], [0, 0, -1], furnaceScatterStrategy),
        exercises:
            'F-BOX-M chromatic scattering furnace (validation §1b): channel-MIS medium sampling, HG normalization, medium-event weights, §7.2 bounce accounting',
        expected:
            'per-channel mean = EXACTLY 0.4 ± 0.004 in linear HDR at high spp — channels splitting ⇒ chromatic weight bug; mean below 0.4 ⇒ bounce starvation (raise maxBounces)',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.006, label: 'F-BOX-M 0.4/channel' }],
        },
    },
    haze: {
        scene: hazeScene,
        strategies: posed([0, 1.2, 5], [0, 1.2, -1], hazeNeeStrategy, hazeEquiangularStrategy, hazePtStrategy),
        exercises:
            'HG-sign witness + medium NEE + spectral shadow_media (light shafts); {param}-driven haze.g; the EQUIANGULAR placement pair (impl-plan-equiangular): key 1 (pt-nee, vertex placement) vs key 2 (pt-nee-eq, per-segment ∝1/d²-to-light) — the first new technique through the §7 door; key 3 (pt) sees only the emissive panel',
        expected:
            'keys 1 and 2 converge to the SAME image (§11.2 — divergence implicates the equiangular pdf algebra or the σ_s·T factors); key 2\'s lamp-halo CORE is measurably less noisy at equal samples (~19% display-space at 4spp headless — the 1/d² term is de-spiked; the win grows as single scattering dominates: thinner haze, brighter/closer lights, and this scene is albedo-0.95 multiple-scatter-heavy); drag haze.g: POSITIVE g brightens the glow toward the light (inverted ⇒ the +2gc HG sign bug); keys 1,2 ≥ key 3 everywhere by exactly the point-light term',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'vertex ≡ equiangular placement' },
                // The equiangular win, as a number: σ at equal spp in the lamp-halo core
                // (lamp at (0.8,2.2,-1) from the default pose). Report-only — the win is
                // region-dependent (grows as single scattering dominates).
                {
                    kind: 'noise', strategies: [1, 0],
                    region: { x: 0.52, y: 0.58, w: 0.16, h: 0.16 },
                    label: 'halo-core σ: equiangular vs vertex',
                },
            ],
        },
    },
    'cornell-area': {
        scene: cornellArea,
        strategies: posed([0, 1, 4], [0, 1, 0], cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy),
        exercises:
            'X-CORNELL (validation §4): explicit quad light desugared to an emissive region; quad solid-angle pdf; §6.2 emission w-bookkeeping; the reference-§8 MIS diff (key 2)',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) ALL converge to the same image (§11.2: pairwise RMSE < 1.5% at 4096 spp) — nee/pt divergence implicates the w-bookkeeping or quad pdf; mis joining implicates lighting_pdf or the power heuristic; the panel is VISIBLE; shadows soft',
        witness: {
            spp: 192,
            // nee↔mis share event coverage → the parameter-free χ² gate. The pt arm
            // finds the panel by chance hits, so its per-pixel variance UNDERESTIMATES
            // at unseen-event pixels — it gets a display-RMSE tripwire calibrated to the
            // measured noise floor (~26% at this budget); converged pt equality is the
            // owner's GPU check (suite card).
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'X-CORNELL nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.4, label: 'X-CORNELL pt tripwire' },
            ],
        },
    },
    'cornell-area-glass': {
        scene: cornellAreaGlass,
        strategies: posed([0, 1, 4], [0, 1, 0], cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy),
        exercises:
            'X-GLASS (validation §4): delta bookkeeping under a samplable emitter — prev_was_delta through specular chains, NEE skipped at glass, full-weight emission after delta, MIS emitter weight = 1 there',
        expected:
            'all three keys converge to the same image; the NOISIEST trio (double spp before suspecting bias); the panel appears in the glass sphere at full brightness',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.03, label: 'X-GLASS nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.4, label: 'X-GLASS pt tripwire' },
            ],
        },
    },
    'fog-area': {
        scene: fogArea,
        strategies: posed([0, 1, 4], [0, 1, 0], fogAreaNeeStrategy, fogAreaMisStrategy, fogAreaPtStrategy),
        exercises:
            'X-FOG proper (validation §4) — the resurrected haze equality pair: medium-NEE toward a hittable quad through haze; hg_eval/hg_sample consistency; the medium-side MIS weight (hg_pdf); spectral shadow_media segments',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image, light shafts included — pt vs pt-nee divergence is the HG sign/eval-desync regression; pt-mis divergence implicates hg_pdf or lighting_pdf',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'X-FOG nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: 'X-FOG pt tripwire' },
            ],
        },
    },
    'fog-panel': {
        scene: fogPanel,
        strategies: posed([0, 1, 4], [0, 1, 0], fogAreaNeeStrategy, fogAreaPtStrategy),
        exercises:
            'audit-H2 witness: back-face hits on a zero-thickness DIFFUSE quad (nonzero albedo) in ambient fog — the scene_region_thin entering-side probe vs the fabricated region_from that poisoned current_medium for one segment',
        expected:
            'keys 1 (pt-nee) and 2 (pt) converge to the same image with CONTINUOUS fog behind the panel — a dry rim behind the panel or pt/pt-nee divergence is the region_from fabrication regressing',
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.65, label: 'audit-H2 nee ≡ pt tripwire' }],
        },
    },
    sky: {
        scene: skyScene,
        strategies: posed([0, 1.4, 5], [0, 0.9, 0], skyNeeStrategy, skyMisStrategy, skyPtStrategy, skyMisOctStrategy),
        exercises:
            'X-ENV (T3): the tabulated env as a samplable light — CDF inversion (env_sampler_cdf), pdf-from-CDF-differences, the sinθ Jacobian, miss-branch w-bookkeeping, env-only selection (probability 1). Plus T2: extern chain, rotation-sign chart fix, scene-driven HDR load',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image — divergence implicates the CDF build, the Jacobian, or the miss-weight bookkeeping. Key 4 (pt-mis-oct) is X-CHART (T5): the OCTAHEDRAL sampler on the bit-identical integrand — divergence from key 2 implicates the chart mapping or its constant Jacobian, nothing else. env.rotation pans everything consistently',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'X-ENV nee ≡ mis' },
                // meanTol 3%: the pt arm finds the sun by chance hits, so its FRAME MEAN
                // converges slowly — 2% flagged pure noise at this budget (measured 2.0%).
                { kind: 'equality', strategies: [1, 2], meanTol: 0.03, rmse: 0.75, label: 'X-ENV pt tripwire' },
                { kind: 'equality', strategies: [1, 3], meanTol: 0.015, label: 'X-CHART equirect ≡ octahedral' },
            ],
        },
    },
    'furnace-sky': {
        scene: furnaceSkyScene,
        strategies: posed([0, 0, 3.5], [0, 0, 0], furnaceSkyNeeStrategy, furnaceSkyMisStrategy, furnaceSkyPtStrategy),
        exercises:
            'W1/W2 (T3): the OPEN furnace — constant SAMPLABLE env (uniform-sphere sampler, pdf 1/4π), miss-branch bookkeeping in its purest form (no textures anywhere). RR off; display tonemap NONE for on-screen radiance checks',
        expected:
            'sphere/sky pixel ratio = ρ = 0.4 EXACTLY (convex body: exit radiance ρ·L, single bounce — the closed-furnace L/(1−ρ) does NOT apply), sky pixels = L, on ALL THREE keys — any key diverging implicates the env miss-weight or the uniform-sphere pdf',
        witness: {
            spp: 96,
            checks: [0, 1, 2].flatMap(strategy => [
                {
                    kind: 'mean' as const, value: 0.4, tol: 0.008, strategy,
                    region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                    label: `W1 sphere ρ·L = 0.4 (key ${strategy + 1})`,
                },
                {
                    kind: 'mean' as const, value: 1.0, tol: 0.005, strategy,
                    region: { x: 0.02, y: 0.88, w: 0.1, h: 0.1 },
                    label: `W2 sky = L = 1.0 (key ${strategy + 1})`,
                },
            ]),
        },
    },
    'sky-lamp': {
        scene: skyLampScene,
        strategies: posed([0, 1.4, 5], [0, 0.9, 0], skyLampNeeStrategy, skyLampMisStrategy, skyLampPtStrategy),
        exercises:
            'TWO-STAGE selection (T3, plan D3): image env AND a quad light — u_envSelectProb stage 0, the wrapped lighting_sample_finite CDF, the (1−P) factor in lighting_pdf, and the P factor in the miss-MIS weight. The full §6.1 pdf symmetry across techniques',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image (warm lamp pool + cool sky fill); sweeping env.selectProb changes NOISE ONLY, never brightness — brightness drift under the sweep is a selection-pdf asymmetry. KNOWN estimator boundary: sun-through-glass is BSDF-only in ALL keys (delta lobes skip NEE, §6.3 blocks shadow rays at glass) — equal noise there across keys is expected, not a bug',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'two-stage nee ≡ mis' },
                { kind: 'equality', strategies: [1, 2], meanTol: 0.02, rmse: 0.7, label: 'two-stage pt tripwire' },
            ],
        },
    },
    'proc-sky': {
        scene: procSkyScene,
        strategies: posed([0, 1.4, 5], [0, 0.9, 0], procSkyNeeStrategy, procSkyMisStrategy, procSkyPtStrategy, procSkyMisCompStrategy),
        exercises:
            'T4 procedural environment: the one-shot GPU bake (fixed-size framebuffer + readExport, app-orchestrated), formula direct-eval at lookup (sharp sun), CDF from the baked table, the sampler-radiance unification (ls.radiance ≡ environment_radiance)',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image; pt-nee resolves the ~2° sun\'s illumination orders of magnitude faster than pt (that asymmetry IS the CDF working); sun disk edges stay SHARP at any zoom (direct-eval, not table-resolution). Key 4 (pt-mis-comp, W9): SAME converged image with a compensated table — the win is lower noise at equal time on the sky-dominated regions',
        witness: {
            spp: 192,
            checks: [
                // pt (key 3) is excluded: the ~2° sun through a pinhole pt walk needs
                // astronomically more samples than a headless budget — nee ≡ mis is the gate.
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'proc-sky nee ≡ mis' },
                { kind: 'equality', strategies: [1, 3], meanTol: 0.02, label: 'W9 plain ≡ compensated table' },
            ],
        },
    },
    orb: {
        scene: orbScene,
        strategies: posed([0, 1.3, 3.4], [0, 0.7, 0], orbNeeStrategy, orbPtStrategy),
        exercises:
            'sphere light via the sampleAsLight route (emissive analytic sphere, default-true registry entry); visible-cone sampling; delta bookkeeping (glass keeps full-weight emission after specular chains)',
        expected:
            'keys 1 (pt-nee) and 2 (pt) converge to the same image; the orb is visible directly AND in the glass reflections; soft shadow from the box',
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.6, label: 'sampleAsLight nee ≡ pt tripwire' }],
        },
    },
    // Fixture partner: the hand-folded arm of the transform-bake twin.
    'transform-bake-ref': {
        scene: transformBakeRef,
        strategies: posed([0, 1.0, 4.2], [0, -0.2, 0], transformNeeStrategy),
        exercises: 'hand-folded reference arm of the transform-bake twin (fable-transforms §8) — placement baked into primitive parameters, no transform fields',
    },
    'transform-bake': {
        scene: transformBake,
        strategies: posed([0, 1.0, 4.2], [0, -0.2, 0], transformNeeStrategy),
        exercises:
            'twin-bake (fable-transforms §8): every object placed via `transform` — SDF scale tier (s·d), SDF translation tier, analytic translate fold, and the analytic ROTATION fold on a sampleAsLight quad (folded params feed the desugar, power CDF, and sampler) — vs the same world geometry hand-folded into parameters',
        expected: 'converges to the same image as transform-bake-ref; divergence implicates the similarity fold or a wrapper tier; a dark/misplaced lamp implicates the fold→desugar ordering or the one-sided normal under rotation',
        witness: {
            spp: 96,
            // Same world geometry through different codegen paths (wrapper vs baked
            // params): folds are fp-exact here, so the arms share streams in practice —
            // near-zero gates like thinlens-zero (measured 0.00%/0.00% at this budget).
            checks: [{ kind: 'twin', other: { scene: 'transform-bake-ref' }, meanTol: 0.002, rmse: 0.01, label: 'transform ≡ hand-fold' }],
        },
    },
    'flatten-tree': {
        scene: flattenTree,
        strategies: posed([0, 1.0, 4.2], [0, -0.2, 0], transformNeeStrategy),
        exercises:
            'light-under-flatten (fable-transforms §4/§8): the transform-bake scene authored as a TREE and composed by the authoring layer’s flattenGroups at fixture-definition time — group∘leaf composition (T∘S, nested T∘T, [T·R]∘id), the sampleAsLight LAMP inside a transformed group (composition → desugar → power CDF → sampler/pdf), depth-0 pass-through leaves',
        expected: 'converges to the same image as transform-bake-ref; divergence implicates flattenGroups composition or the TRS re-expression, not the stage-2 machinery (transform-bake already gates that)',
        witness: {
            spp: 96,
            // Composition happens in fp64 and lands sub-fp32-ulp from the directly-
            // authored transforms → near-bit-exact gates like transform-bake.
            checks: [{ kind: 'twin', other: { scene: 'transform-bake-ref' }, meanTol: 0.002, rmse: 0.01, label: 'flattened tree ≡ hand-fold' }],
        },
    },
    // Fixture partner: the untransformed arm of the conjugation witness.
    'conjugation-base': {
        scene: conjugationBase,
        strategies: posed(CONJ_CAMERA_BASE.position, CONJ_CAMERA_BASE.target, transformNeeStrategy),
        exercises: 'untransformed arm of the conjugation witness (fable-transforms §8)',
    },
    conjugation: {
        scene: conjugationScene,
        strategies: posed(CONJ_CAMERA_G.position, CONJ_CAMERA_G.target, transformNeeStrategy),
        exercises:
            'the global-similarity witness (fable-transforms §8): ONE g = T·Ry(0.7)·(s=1.6) on every object AND the camera — path tracing g·scene from g·camera is the same integral. Exercises arbitrary-angle mat3 wrapper tiers, plane s·d, analytic folds, and the radiance-invariant emissive quad through the CDF/sampler chain, all in one number',
        expected: 'converges to the same image as conjugation-base; divergence anywhere in the chain (fold, wrapper, desugar, power CDF, quad pdf) breaks the equality',
        witness: {
            spp: 192,
            // Arms differ in every float op (rotated frames) → decorrelated streams;
            // same-integrand display-space gate, like the backend twins. Measured
            // 0.04%/0.91% at this budget → ~1.5× calibration.
            checks: [{ kind: 'twin', other: { scene: 'conjugation-base' }, meanTol: 0.01, rmse: 0.02, label: 'g·scene ≡ scene (conjugation)' }],
        },
    },
    // Fixture partner: the hand-folded arm of the regions-under-transform twin.
    'regions-transformed-ref': {
        scene: regionsTransformedRef,
        strategies: posed([0, 0.8, 4], [0.3, -0.3, 0], regionsNeeStrategy),
        exercises: 'hand-folded reference arm of the regions-under-transform twin',
    },
    'regions-transformed': {
        scene: regionsTransformed,
        strategies: posed([0, 0.8, 4], [0.3, -0.3, 0], regionsNeeStrategy),
        exercises:
            'nesting under a similarity (fable-transforms §8): glass sphere (analytic, folded) strictly inside an absorbing water box (SDF, mat3+s·d wrapper), both under Ry(90°)·1.25 + translate — innermost-wins classification, scaled signed distances, interface epsilons, and current_medium tracking through transformed boundaries',
        expected: 'converges to the same image as regions-transformed-ref (tinted water, refracted sphere); divergence implicates scaled-field classification (scene_region_at over s·d) or the analytic signed distance after folding',
        witness: {
            spp: 256,
            // Measured 0.24%/1.13% at this budget → ~1.5–2× calibration.
            checks: [{ kind: 'twin', other: { scene: 'regions-transformed-ref' }, meanTol: 0.01, rmse: 0.025, label: 'regions transform ≡ hand-fold' }],
        },
    },
    // Fixture partners: the baked (constant-transform) references of the driven witness.
    'driven-baked-theta': {
        scene: drivenBakedTheta,
        strategies: posed([0, 1.1, 4.2], [0, -0.2, 0], drivenNeeStrategy),
        exercises: 'baked reference arm of the driven witness at parameter point θ (stage-2 constant lowering)',
    },
    'driven-baked-theta2': {
        scene: drivenBakedTheta2,
        strategies: posed([0, 1.1, 4.2], [0, -0.2, 0], drivenNeeStrategy),
        exercises: 'baked reference arm of the driven witness at parameter point θ′',
    },
    driven: {
        scene: drivenScene,
        strategies: posed([0, 1.1, 4.2], [0, -0.2, 0], drivenNeeStrategy),
        exercises:
            'driven-equals-baked at θ (fable-transforms §6/§8): {param}-driven placements rendered from the ValueParam DEFAULTS — the driven SDF box (rigid-frame wrapper: position+angle+scale) and driven analytic sphere (conjugation arm, live s·center/s·radius) must reproduce the constant-authored twin; the box is a live occluder under NEE (shadow via the same uniforms). Drag the rig.* sliders in the lab — accumulation resets and the object moves without recompiling',
        expected: 'converges to the same image as driven-baked-theta; divergence implicates the fp64 compute closures, the vec4 ABI upload, or a rigid-frame arm',
        witness: {
            spp: 96,
            // Different codegen (uniform rigid-frame vs folded constants), same values →
            // near-identical fp32 streams (measured 0.00%/0.00% at this budget).
            checks: [{ kind: 'twin', other: { scene: 'driven-baked-theta' }, meanTol: 0.002, rmse: 0.01, label: 'driven ≡ baked @θ' }],
        },
    },
    'driven-theta2': {
        scene: drivenScene,
        strategies: posed([0, 1.1, 4.2], [0, -0.2, 0], drivenNeeStrategy),
        exercises:
            'driven-equals-baked at θ′: the SAME driven scene with every rig.* param SET through the ParameterStore after initialization (the slider/graph-runtime path) — covers recompute-on-change + re-upload, not just defaults',
        expected: 'converges to the same image as driven-baked-theta2 (a visibly different pose than `driven`); divergence implicates the multi-path binding recompute',
        witness: {
            spp: 96,
            // Measured 0.00%/0.01% at this budget.
            checks: [{ kind: 'twin', other: { scene: 'driven-baked-theta2' }, meanTol: 0.002, rmse: 0.01, label: 'driven ≡ baked @θ′ (post-set)' }],
        },
        initialParameters: {
            ...THETA2,
        },
    },
    'cornell-disk': {
        scene: cornellDisk,
        strategies: posed([0, 1, 4], [0, 1, 0], cornellDiskNeeStrategy, cornellDiskMisStrategy, cornellDiskPtStrategy),
        exercises:
            'the disk light kind (explicit route → backing disk region): concentric area sampling, the d²/(πr²·cosθ) solid-angle pdf + its adjacent MIS mirror, π²r²·Le power in the CDF, and the thin/one-sided machinery\'s SECOND tenant (previously quad-only)',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) ALL converge to the same image (§11.2) — nee/pt divergence implicates the disk pdf or the concentric map; mis joining implicates disk_light_pdf; the disk is VISIBLE and round; shadows soft',
        witness: {
            spp: 192,
            // Same gate shape as cornell-area: nee↔mis share event coverage → χ²;
            // the chance-hit pt arm gets the calibrated display-RMSE tripwire.
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'cornell-disk nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.4, label: 'cornell-disk pt tripwire' },
            ],
        },
    },
    // Fixture partner: the hand-folded arm of the disk-bake twin.
    'disk-bake-ref': {
        scene: diskBakeRef,
        strategies: posed([0, 1.2, 4], [0, 0.8, 0], diskBakeStrategy),
        exercises: 'hand-folded reference arm of the disk-bake twin — the rotated normal authored directly',
    },
    'disk-bake': {
        scene: diskBake,
        strategies: posed([0, 1.2, 4], [0, 0.8, 0], diskBakeStrategy),
        exercises:
            'the direction-kind fold witness: an emissive disk OBJECT (sampleAsLight route) tilted via transform.rotation — the first witness through the KIND-DERIVED direction fold (plane\'s is a coupled override), flowing fold → desugar → power CDF → sampler/pdf; canonicalize (unit normal) rides the same path',
        expected:
            'converges to the same image as disk-bake-ref (tilted glowing disk, off-center light pool); divergence implicates the derived direction fold, canonicalize ordering, or the folded-params desugar',
        witness: {
            spp: 96,
            // fp64 fold vs hand-computed values → near-bit-exact arms (transform-bake's gates).
            checks: [{ kind: 'twin', other: { scene: 'disk-bake-ref' }, meanTol: 0.002, rmse: 0.01, label: 'disk transform ≡ hand-fold' }],
        },
    },
    spot: {
        scene: spotScene,
        strategies: posed([0, 1.4, 2.2], [0, 0, 0], spotNeeStrategy),
        exercises:
            'F-SPOT: the spot kind (delta + smoothstep cone, pbrt-v4 falloff; cos rows are the new similarity-INVARIANT `angle` param kind). Also the isotropy pin\'s CONTRAST case: spot declares no deltaQuery fact, so equiangular rejects it (the Validator message names the kind)',
        expected:
            'hotspot center = ρ/π·I/d² = 1.2/π ≈ 0.3820 in linear HDR; a smooth ring fades from falloffStart (r≈0.89) to the cone edge (r≈1.15); OUTSIDE the cone the floor is exactly black (no env, delta light invisible to chance hits)',
        witness: {
            spp: 48,
            checks: [
                {
                    kind: 'mean', value: 0.38197, tol: 0.006,
                    region: { x: 0.47, y: 0.47, w: 0.06, h: 0.06 },
                    label: 'F-SPOT hotspot ρ/π·I/d² = 1.2/π',
                },
                {
                    kind: 'mean', value: 0.0, tol: 0.002,
                    region: { x: 0.02, y: 0.02, w: 0.08, h: 0.08 },
                    label: 'F-SPOT outside-cone = 0 exactly',
                },
            ],
        },
    },
    mirror: {
        scene: mirrorScene,
        strategies: posed([0, 0, 3.5], [0, 0, 0], mirrorNeeStrategy, mirrorPtStrategy),
        exercises:
            'F-MIRROR: the smooth-conductor delta occupant (Schlick f0, weight = F exactly — the §2.1 delta cancellation) + the f0 row SHARED with ggx (§3.4 union dedupe). pt-nee (key 1) vs pt (key 2) is the NEE-guard check: the mirror is pure delta, NEE contributes nothing, miss emission stays full-weight after the delta bounce',
        expected:
            'sphere CENTER = f0·L = 0.5 exactly in linear HDR (convex: one bounce, F(cosθ≈1) = f0); rim rolls toward 1 (Schlick grazing) and blends into the sky; keys 1 and 2 converge to the same image',
        witness: {
            spp: 48,
            checks: [
                {
                    kind: 'mean', value: 0.5, tol: 0.008,
                    region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                    label: 'F-MIRROR center f0·L = 0.5',
                },
                {
                    kind: 'mean', value: 0.5, tol: 0.008, strategy: 1,
                    region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                    label: 'F-MIRROR center f0·L = 0.5 (pt)',
                },
                // Near-deterministic arms (pixel jitter is the only live randomness once
                // NEE is guarded off at the delta surface) → the display-space gate.
                { kind: 'equality', strategies: [0, 1], meanTol: 0.005, rmse: 0.02, label: 'NEE guard: nee ≡ pt on pure delta' },
            ],
        },
    },
    // Fixture partner: the plain-number (analytic-arm) half of the F-HET-CONST twin.
    'het-const-ref': {
        scene: hetConstRef,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], hetRefNeeStrategy, hetRefPtStrategy),
        exercises: 'analytic-arm reference of the F-HET-CONST estimator-swap twin — the same fog authored as a plain constant',
    },
    'het-const': {
        scene: hetConstScene,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], hetNeeStrategy, hetPtStrategy),
        exercises:
            'F-HET-CONST (heterogeneous-media §5.1): σ_s authored as the CONSTANT EXPRESSION glsl(\'0.5\') — routing is by authored type, so this runs the transcribed Kutz spectral tracker (delta arm) plus ratio-tracked shadow segments against the SAME integrand the ref solves in closed form. The single sharpest gate of the heterogeneous build',
        expected:
            'converges to the same image as het-const-ref on BOTH keys (nee and pt) — divergence implicates the transcribed lottery weights, the history-aware probabilities, or the ratio shadow arm; the majorant (0.6 > σ_t = 0.52) never clamps, so the integrands are identical by construction',
        witness: {
            spp: 192,
            // Different estimators (tracking vs closed-form) → decorrelated streams:
            // same-integrand display-space gates, like the backend twins. The pt pair
            // is noisier (panel by chance hits) → looser tripwire.
            checks: [
                { kind: 'twin', other: { scene: 'het-const-ref' }, meanTol: 0.015, rmse: 0.08, label: 'F-HET-CONST delta ≡ analytic (nee)' },
                { kind: 'twin', other: { scene: 'het-const-ref', strategy: 1 }, strategy: 1, meanTol: 0.03, rmse: 0.3, label: 'F-HET-CONST delta ≡ analytic (pt tripwire)' },
            ],
        },
    },
    'het-slab': {
        scene: hetSlabScene,
        strategies: posed([0, 0, 2], [0, 0, -2], hetSlabStrategy),
        exercises:
            'F-HET-SLAB (heterogeneous-media §5.2): chromatic LINEAR σ_a(z) through the F-SLAB geometry — the ratio-tracked pass-through arm (absorbing-only heterogeneous, amended D2) against pencil-and-paper truth; optical depth (0.5,1,2)·2 derived in the fixture comment',
        expected:
            'converged CENTER pixel = (0.36788, 0.13534, 0.01832) ± ~1%/channel in linear HDR — the F-SLAB triple through a truly varying field; per-channel drift implicates the ratio update (σ̄−σ)/σ̄ or the Spectrum() expression splice',
        witness: {
            spp: 96,
            checks: [{
                kind: 'mean', value: [0.36788, 0.13534, 0.01832], tol: [0.005, 0.004, 0.003],
                region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                label: 'F-HET-SLAB linear-σ Beer–Lambert',
            }],
        },
    },
    // Fixture partner: the authored-constant-1.0 half of the F-CLAMP twin.
    'clamp-ref': {
        scene: clampRef,
        strategies: posed([0, 0, 2], [0, 0, -2], clampRefStrategy),
        exercises: 'authored-constant reference of the F-CLAMP twin (analytic Beer–Lambert arm)',
    },
    clamp: {
        scene: clampScene,
        strategies: posed([0, 0, 2], [0, 0, -2], clampStrategy),
        exercises:
            'F-CLAMP (heterogeneous-media §5.3, D1 as an equality): the formula says 2.0 everywhere, the ceiling says 1.0 — the rendered medium must BE the constant-1.0 slab (proportional clamp inside scene_medium_properties, so every consumer sees only the effective field)',
        expected:
            'converges to the same image as clamp-ref; center pixel = e⁻¹ = 0.36788 per channel — a darker slab (toward e⁻²) means the clamp is not applied; divergence from the ref means it is applied somewhere but not in the lookup',
        witness: {
            spp: 96,
            checks: [
                {
                    kind: 'mean', value: 0.36788, tol: 0.005,
                    region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                    label: 'F-CLAMP e⁻¹ (clamped field)',
                },
                { kind: 'twin', other: { scene: 'clamp-ref' }, meanTol: 0.01, rmse: 0.08, label: 'F-CLAMP clamped ≡ authored-1.0' },
            ],
        },
    },
    // Fixture partners: the baked constant twins of the HET-DRIVEN witness.
    'het-driven-baked': {
        scene: hetDrivenBaked,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], hetRefNeeStrategy),
        exercises: 'baked reference arm of the HET-DRIVEN witness at gain 1 (σ_s = 0.4, analytic arm)',
    },
    'het-driven-baked2': {
        scene: hetDrivenBaked2,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], hetRefNeeStrategy),
        exercises: 'baked reference arm of the HET-DRIVEN witness at gain 2 (σ_s = 0.8, analytic arm)',
    },
    'het-driven': {
        scene: hetDrivenScene,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], hetNeeStrategy),
        exercises:
            'HET-DRIVEN (heterogeneous-media §5.4): the slider INSIDE the formula (GlslExpression.params → u_het_gain uniform + live slider) at its DEFAULT point — covers minting, upload, and the delta arm reading a driven field. Drag het.gain in the lab: fog thickens live with zero recompiles; past gain ≈ 2.45 the ceiling saturates it (D1) instead of misrendering',
        expected: 'converges to the same image as het-driven-baked (σ_s = 0.4); divergence implicates the params minting or the uniform splice in the expression',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'het-driven-baked' }, meanTol: 0.015, rmse: 0.08, label: 'HET-DRIVEN ≡ baked @gain 1' }],
        },
    },
    'het-driven-theta2': {
        scene: hetDrivenScene,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], hetNeeStrategy),
        exercises:
            'HET-DRIVEN at the θ′ point: het.gain SET to 2.0 through the ParameterStore after initialization (the slider path) — covers recompute + re-upload of an expression param, not just its default',
        expected: 'converges to the same image as het-driven-baked2 (σ_s = 0.8 — visibly thicker fog than het-driven); divergence implicates the store→uniform update path',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'het-driven-baked2' }, meanTol: 0.015, rmse: 0.08, label: 'HET-DRIVEN ≡ baked @gain 2 (post-set)' }],
        },
        initialParameters: {
            ...HET_THETA2,
        },
    },
    emit: {
        scene: emitScene,
        strategies: posed([0, 0, 2], [0, 0, -2], emitStrategy),
        exercises:
            'F-EMIT (impl-plan-medium-emission E2): constant glowing absorbing slab through the ANALYTIC closed-form arm — ε is the volume emission coefficient (P1), L = ε/σ_a·(1−e^{−σ_a}) + e^{−σ_a}·L_back; the green channel is the equilibrium case (ε = σ_a·L_back ⇒ identically 1)',
        expected:
            'converged CENTER pixel = (0.68394, 1.00000, 1.63212) ± ~1%/channel in linear HDR — green ≠ 1 breaks the equilibrium (emission or attenuation off); r/b drifting with g exact implicates the ε/σ_a factor',
        witness: {
            spp: 48,
            checks: [{
                kind: 'mean', value: [0.68394, 1.0, 1.63212], tol: [0.007, 0.01, 0.016],
                region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                label: 'F-EMIT closed-form glow',
            }],
        },
    },
    'emit-swap': {
        scene: emitSwapScene,
        strategies: posed([0, 0, 2], [0, 0, -2], emitSwapStrategy),
        exercises:
            'EMIT-SWAP: the F-EMIT slab authored as EXPRESSIONS (+majorant) — the ratio pass-through arm with P3 per-collision collection vs the analytic closed form: the estimator-swap gate for emission (gates the plan\'s track-length derivations)',
        expected:
            'converges to the same image as `emit`, same exact center numbers — divergence implicates the per-collision collection weight (w·ε/σ̄) or its pre-update-T placement',
        witness: {
            spp: 96,
            checks: [
                { kind: 'twin', other: { scene: 'emit' }, meanTol: 0.01, rmse: 0.08, label: 'EMIT-SWAP tracking ≡ analytic' },
                {
                    kind: 'mean', value: [0.68394, 1.0, 1.63212], tol: [0.007, 0.01, 0.016],
                    region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                    label: 'EMIT-SWAP absolute numbers',
                },
            ],
        },
    },
    'emit-sat': {
        scene: emitSatScene,
        strategies: posed([30, 1, 0], [31, 1, 0], emitSatStrategy),
        exercises:
            'F-EMIT-SAT: camera deep inside a uniform glowing SCATTERING medium — equilibrium radiance ε/σ_a exactly, every pixel. Gates the DELTA arm\'s per-collision collection with an absolute number AND the auto-derived majorant (constant-ε scattering medium, σ̄ = σ_t = 3 derived, P5)',
        expected:
            'EVERY pixel = (0.5, 1.0, 2.0) in linear HDR — low ⇒ bounce starvation or a lost emission weight; high ⇒ double collection; channels splitting ⇒ the ε splice or the scattering equilibrium',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: [0.5, 1.0, 2.0], tol: [0.005, 0.01, 0.02], label: 'F-EMIT-SAT ε/σ_a saturation' }],
        },
    },
    'emit-scatter': {
        scene: emitScatterScene,
        strategies: posed([0, 1.2, 4.2], [0, 1, 0], emitScatterNeeStrategy, emitScatterPtStrategy),
        exercises:
            'emission × scattering × NEE composition: glowing fog under a ceiling quad (second auto-derived majorant, σ̄ = 0.7) — glow is PATH-FOUND on both arms (P4: volumes are never light-sampled), so nee and pt estimate the same integral',
        expected:
            'keys 1 (pt-nee) and 2 (pt) converge to the same image — warm glow inside the fog + quad light pool; divergence implicates emission interacting with the NEE partition (it must not — glow rides the kernel arm only)',
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.4, label: 'emission nee ≡ pt tripwire' }],
        },
    },
    'veach-mis': {
        scene: veachMis,
        strategies: posed([0, 1.3, 5.5], [0, 0.55, 0], veachMisStrategy, veachNeeStrategy, veachPtStrategy),
        exercises:
            'GGX (first glossy BSDF: VNDF sampling, Smith G, Schlick F) under the classic Veach MIS geometry — four roughness steps × three light sizes at ~equal power; the power heuristic at both scoring sites with a peaked non-delta pdf',
        expected:
            'keys 1 (pt-mis), 2 (pt-nee), 3 (pt) converge to the SAME image (§11.2); pt-mis is visibly lowest-variance on EVERY plate — pt-nee fireflies on smooth-plate × big-light, pt fireflies on rough-plate × small-light; divergence implicates ggx_pdf/ggx_sample agreement (§11.3) or the MIS weights',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.03, label: 'veach GGX mis ≡ nee' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 1.2, label: 'veach GGX pt tripwire' },
                // The MIS claim as a number: pt-mis must measure lowest whole-frame σ
                // at equal spp (it is visibly lowest-variance on every plate).
                { kind: 'noise', strategies: [0, 1, 2], assertFirstLowest: true, label: 'σ at equal spp: mis lowest' },
            ],
        },
    },
};
