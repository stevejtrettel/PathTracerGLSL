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
import { cornellBox as camCornell, camPinholeStrategy, camThinlensZeroStrategy } from './scenes/cameraWitness.js';

export const witnessSuite: Record<string, SceneSuiteEntry> = {
    'thinlens-zero': {
        scene: camCornell,
        strategies: [camPinholeStrategy, camThinlensZeroStrategy],
        exercises:
            'thin-lens correctness anchor: aperture = 0 (key 2) must reproduce the pinhole image (key 1) exactly — the lens disk collapses to a point. Both cameras draw xiLens, so the arms share the RNG stream.',
        expected: 'key 1 (pinhole) and key 2 (thin-lens, aperture 0) are the same image; any visible difference is a frame/focus-math bug',
        witness: {
            spp: 64,
            // Identical-stream arms (only thin-lens\'s normalize(dir·k) round-trip differs
            // in the last fp bits) → the display-space RMSE gate, not χ².
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'thin-lens aperture-0 ≡ pinhole' }],
        },
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'two-light': {
        scene: twoLightScene,
        strategies: [twoLightPowerStrategy, twoLightUniformStrategy],
        exercises:
            'multi-light CDF dispatcher (lights.length>1); lightSelection power (key 1) vs uniform (key 2)',
        expected: 'power (key 1) and uniform (key 2) converge to the SAME image; power is lower-variance',
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'power ≡ uniform' }],
        },
        initialParameters: {
            'camera.position': [0, 1.2, 4],
            'camera.target': [0, 0.5, 0],
        },
    },
    furnace: {
        scene: furnaceBox,
        strategies: [furnaceStrategy, furnaceVarianceStrategy],
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
        initialParameters: {
            'camera.position': [0, 0, 0],
            'camera.target': [0, 0, -1],
        },
    },
    // Fixture partner: the SDF half of the analytic-minimal twin (and the direct-only
    // strategy demo rides along on key 2).
    minimal: {
        scene: minimalScene,
        strategies: [minimalStrategy, directOnlyStrategy],
        exercises: 'constant environment; pathtracer vs direct-only strategy from one scene; twin partner of analytic-minimal',
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
        witness: {
            spp: 192,
            // Backend twins use the display-space gate, NOT χ²: marching vs closed-form
            // differ DETERMINISTICALLY at silhouette pixels (and the constant-env
            // background has zero variance), so the same-integrand premise of χ² fails
            // even though the converged IMAGES agree. Measured 3.5% at this budget.
            checks: [{ kind: 'twin', other: { scene: 'minimal' }, meanTol: 0.02, rmse: 0.08, label: 'analytic ≡ SDF backend' }],
        },
        initialParameters: {
            'camera.position': [0, 1, 5],
            'camera.target': [0, 0, 0],
        },
    },
    eta: {
        scene: etaScene,
        strategies: [etaStrategy],
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
        initialParameters: {
            'camera.position': [0, 1, 0.05],
            'camera.target': [0, -1, 0],
        },
    },
    // Fixture partner: the SDF half of the analytic-glass twin (and the dielectric
    // eyeball scene — Fresnel rim, TIR, inverted image; dark shadow is correct v1).
    'cornell-glass': {
        scene: cornellGlass,
        strategies: [glassStrategy],
        exercises:
            'dielectric eyeball scene: Fresnel rim, TIR, inverted image; RR-on exercises etaScale; NEE guard skips shadow rays at glass. Dark shadow under the sphere is CORRECT v1 (§6.3 shadow-opaque + delta light — caustics need area lights); twin partner of analytic-glass',
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
        witness: {
            spp: 256,
            // rmse, not χ², for the same backend-twin reason as analytic-minimal
            // (glass noise happens to mask the deterministic edge differences today,
            // but the gate shouldn't depend on that). Measured 0.97% at this budget.
            checks: [{ kind: 'twin', other: { scene: 'cornell-glass' }, meanTol: 0.03, rmse: 0.08, label: 'glass analytic ≡ SDF backend' }],
        },
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
        witness: {
            spp: 48,
            checks: [{
                kind: 'mean', value: [0.36788, 0.13534, 0.01832], tol: [0.004, 0.0015, 0.0005],
                region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
                label: 'F-SLAB Beer–Lambert e^{-σt}',
            }],
        },
        initialParameters: {
            'camera.position': [0, 0, 2],
            'camera.target': [0, 0, -2],
        },
    },
    'furnace-scatter': {
        scene: furnaceScatterScene,
        strategies: [furnaceScatterStrategy],
        exercises:
            'F-BOX-M chromatic scattering furnace (validation §1b): channel-MIS medium sampling, HG normalization, medium-event weights, §7.2 bounce accounting',
        expected:
            'per-channel mean = EXACTLY 0.4 ± 0.004 in linear HDR at high spp — channels splitting ⇒ chromatic weight bug; mean below 0.4 ⇒ bounce starvation (raise maxBounces)',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.006, label: 'F-BOX-M 0.4/channel' }],
        },
        initialParameters: {
            'camera.position': [0, 0, 0],
            'camera.target': [0, 0, -1],
        },
    },
    haze: {
        scene: hazeScene,
        strategies: [hazeNeeStrategy, hazeEquiangularStrategy, hazePtStrategy],
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
        initialParameters: {
            'camera.position': [0, 1.2, 5],
            'camera.target': [0, 1.2, -1],
        },
    },
    'cornell-area': {
        scene: cornellArea,
        strategies: [cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy],
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
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.03, label: 'X-GLASS nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.4, label: 'X-GLASS pt tripwire' },
            ],
        },
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
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'X-FOG nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: 'X-FOG pt tripwire' },
            ],
        },
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
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.65, label: 'audit-H2 nee ≡ pt tripwire' }],
        },
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
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'two-stage nee ≡ mis' },
                { kind: 'equality', strategies: [1, 2], meanTol: 0.02, rmse: 0.7, label: 'two-stage pt tripwire' },
            ],
        },
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
        witness: {
            spp: 192,
            checks: [
                // pt (key 3) is excluded: the ~2° sun through a pinhole pt walk needs
                // astronomically more samples than a headless budget — nee ≡ mis is the gate.
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'proc-sky nee ≡ mis' },
                { kind: 'equality', strategies: [1, 3], meanTol: 0.02, label: 'W9 plain ≡ compensated table' },
            ],
        },
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
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.6, label: 'sampleAsLight nee ≡ pt tripwire' }],
        },
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
        initialParameters: {
            'camera.position': [0, 1.3, 5.5],
            'camera.target': [0, 0.55, 0],
        },
    },
};
