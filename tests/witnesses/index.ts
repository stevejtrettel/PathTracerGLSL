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

import { twoLightScene, twoLightPowerStrategy, twoLightUniformStrategy, twoLightBvhStrategy } from './scenes/twoLightScene.js';
import { hundredSpheres, hundredNeePowerStrategy, hundredNeeBvhStrategy, hundredMisPowerStrategy, hundredMisBvhStrategy } from './scenes/hundredSpheres.js';
import {
    instanceLightsTwin, instanceLightsSky, instanceLightsRef, instanceLightsNeeStrategy, instanceLightsMisStrategy, instanceLightsRefStrategy,
    glowShell, glowShellNeeStrategy, glowShellMisStrategy, glowShellPtStrategy,
} from './scenes/instanceLightsWitness.js';
import { furnaceBox, furnaceStrategy, furnaceVarianceStrategy } from './scenes/furnaceBox.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from './scenes/minimalScene.js';
import { analyticMinimal, analyticStrategy } from './scenes/analyticMinimal.js';
import { bazaarScene, bazaarTableStrategy, bazaarUnrolledStrategy } from './scenes/tableWitness.js';
import { meshFurnace, meshFurnaceStrategy, meshQuadTwin, meshQuadRef, meshTwinStrategy, meshTwinBruteStrategy, meshGlassPair, meshFogPair, meshSubmergedPair, containStrategy, meshLightTwin, meshLightSmooth, meshLightRef, meshLightStrategies, meshLightBvhStrategies } from './scenes/meshWitness.js';
import { instanceTwin, instanceTwinRef, instanceTwinStrategy, instanceTwinLinearStrategy, meshInstanceTwin, meshInstanceRef, meshInstanceStrategy, attrTwin, attrTwinRef, attrTwinStrategy, instanceParamsTwin, instanceParamsFrame, instanceParamsStrategy, instanceParamsCwbvhStrategy } from './scenes/instanceWitness.js';
import { perfCloud, perfCloudFrame, perfCloudStrategy, perfCloudCwbvhStrategy, PERF_CLOUD_COUNT } from './scenes/perfCloud.js';
import { regionOverlap, regionOverlapUnrolledStrategy, regionOverlapTableStrategy } from './scenes/regionOverlapWitness.js';
import {
    instanceGlass, instanceGlassRef, instanceGlassMesh, instanceGlassMeshRef,
    instanceFog, instanceFogRef, instanceGlassStrategy, instanceGlassLinearStrategy, instanceGlassLowRRStrategy,
    perfInstanceGlass, perfInstanceOpaque, perfInstanceStrategy, perfInstanceLadder,
} from './scenes/instanceGlassWitness.js';
import { accelTriple, accelTripleNeeStrategy, accelTripleMisStrategy, accelTriplePtStrategy } from './scenes/accelTriple.js';
import { solidsAnalytic, solidsSdf, solidsStrategy, cubeCloud, cubeCloudRef, cubeCloudStrategy } from './scenes/solidsWitness.js';
import { sdfTableTwin, sdfInstanceTwin, sdfInstanceTwinRef, sdfInstanceStrategy, sdfUnrolledStrategy, sdfTableStrategy, perfSdf0, perfSdf8, perfSdf32, perfSdf128, perfSdfCluster8, perfSdfCluster32, perfSdfCluster128, perfSdfBlob } from './scenes/sdfTableWitness.js';
import { fieldGlass, fieldGlassNeeStrategy, fieldGlassMisStrategy, fieldGlassPtStrategy } from './scenes/customFieldWitness.js';
import { etaScene, etaStrategy, cornellGlass, analyticGlass, glassStrategy } from './scenes/dielectricWitness.js';
import { exprConst, exprConstRef, exprTwinStrategy } from './scenes/exprMaterialWitness.js';
import { meshSlabAlbedoScene, meshScaleTwin, meshScaleTwinRef, meshScaleStrategy, MESH_TWIN_SCALE, MESH_TWIN_POSE } from './scenes/meshMarginWitness.js';
import { nullBudgetViewScene, nullViewStrategies, NULL_VIEW_POSE, NULL_VIEW_THROUGH, nullBudgetScene, nullBudgetStrategies, NULL_BUDGET_POSE, SLABS } from './scenes/nullBudgetWitness.js';
import { MAX_DIST } from './scenes/shaderConstants.js';
import { shadowAimMarch, shadowAimFar, shadowAimFog, shadowAimStrategies, AIM_OPEN, AIM_FOG, AIM_CAMERA_Y, AIM_FOG_CAMERA_Y, AIM_FAR_X } from './scenes/shadowAimWitness.js';
import { tinySphereScene, tinySphereStrategy, TINY_SIZE, TINY_SPHERE_MEAN, tinySphereLightScene, tinySphereLightStrategy, TINY_LIGHT_CAMERA, TINY_LIGHT_REGION, TINY_LIGHT_MEAN, sunHazeScene, sunHazeStrategy, SUN_HAZE_CAMERA, SUN_HAZE_CENTER } from './scenes/precisionWitness.js';
import { grinVacuum, grinVacuumRef, grinVacuumStrategy, grinFurnaceScene, grinFurnaceStrategy, grinGlass, grinGlassRef, grinGlassStrategy, grinFurnaceHardScene, grinFurnaceHardStrategy, grinEmit, grinEmitRef, grinEmitStrategy, grinFurnaceEmitScene, grinFurnaceEmitStrategy, grinScatter, grinScatterRef, grinScatterStrategy, grinFurnaceScatterScene, grinFurnaceScatterStrategy, grinLongScene, grinLongStrategy } from './scenes/grinWitness.js';
import {
    slabScene, slabStrategy,
    furnaceScatterScene, furnaceScatterStrategy,
    hazeScene, hazeNeeStrategy, hazeEquiangularStrategy, hazePtStrategy,
} from './scenes/mediaWitness.js';
import {
    sssFurnaceScene, sssFurnaceRrOffStrategy, sssFurnaceRrInteriorStrategy,
} from './scenes/sssFurnaceWitness.js';
import {
    slabAlbedoScene, slabAlbedoAnisoScene, slabAlbedoRefScene, slabAlbedoSparseScene,
    slabRrOffStrategy, slabRrInteriorStrategy, slabObliqueStrategy, slabGrazingStrategy, slabAnisoStrategy,
    SLAB_TARGET, SLAB_PLANE_ALBEDO, SLAB_PLANE_ALBEDO_ANISO, SLAB_ANISO_REF_TOL, SLAB_VIEWS,
} from './scenes/slabAlbedoWitness.js';
import {
    cornellArea, cornellAreaNeeStrategy, cornellAreaMisStrategy, cornellAreaPtStrategy,
    cornellAreaGlass,
    fogArea, fogAreaNeeStrategy, fogAreaMisStrategy, fogAreaPtStrategy, fogAreaIgnored, fogAreaIgnoredNeeStrategy, fogAreaIgnoredMisStrategy, fogAreaIgnoredPtStrategy,
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
import { bounceBudgetScene, bounceBudgetStrategies, procSkyRotatedScene, fogSkyScene, FOG_SKY_SIGMA, roughSheetScene } from './scenes/estimatorAgreementWitness.js';
import { veachMis, veachMisStrategy, veachNeeStrategy, veachPtStrategy } from './scenes/ggxScenes.js';
import {
    roughSmoothLimit, roughSmoothLimitStrategy,
    roughMis, roughMisNeeStrategy, roughMisMisStrategy, roughMisPtStrategy,
    glassInclusion, inclusionNeePowerStrategy, inclusionNeeBvhStrategy, inclusionMisBvhStrategy, inclusionPtStrategy,
    roughFurnace, roughFurnaceStrategy,
    roughGrin, roughGrinRef, roughGrinStrategy,
} from './scenes/roughDielectricWitness.js';
import { mirrorScene, mirrorNeeStrategy, mirrorPtStrategy } from './scenes/mirrorWitness.js';
import {
    cornellDisk, cornellDiskNeeStrategy, cornellDiskMisStrategy, cornellDiskPtStrategy,
    diskBake, diskBakeRef, diskBakeStrategy,
} from './scenes/diskWitness.js';
import { spotScene, spotNeeStrategy } from './scenes/spotWitness.js';
import {
    sunScene, sunNeeStrategy,
    beamWallScene, beamSlabScene, beamNeeStrategy,
    beamFogScene, beamFogNeeStrategy, beamFogMisStrategy,
} from './scenes/directionalBeamWitness.js';
import { softbeamWallScene, softbeamNeeStrategy, softbeamMisStrategy } from './scenes/softbeamWitness.js';
import { cornellBox as camCornell, camPinholeStrategy, camThinlensZeroStrategy } from './scenes/cameraWitness.js';
import {
    transformBake, transformBakeRef, transformNeeStrategy, flattenTree,
    conjugationScene, conjugationBase, CONJ_CAMERA_BASE, CONJ_CAMERA_G,
    regionsTransformed, regionsTransformedRef, regionsNeeStrategy,
} from './scenes/transformWitness.js';
import { drivenScene, drivenBakedTheta, drivenBakedTheta2, drivenNeeStrategy, THETA2 } from './scenes/drivenWitness.js';
import {
    drivenLightScene, drivenLightBaked, drivenLightBaked2, drivenLightOffBaked,
    drivenLightNeeStrategy, drivenLightMisStrategy, LIGHT_THETA2, LIGHT_OFF,
} from './scenes/drivenLightWitness.js';
import {
    hetConstScene, hetConstRef, hetNeeStrategy, hetPtStrategy, hetRefNeeStrategy, hetRefPtStrategy,
    hetSlabScene, hetSlabStrategy,
    clampScene, clampRef, clampStrategy, clampRefStrategy,
    hetDrivenScene, hetDrivenBaked, hetDrivenBaked2, HET_THETA2,
} from './scenes/heterogeneousWitness.js';
import {
    emitScene, emitSwapScene, emitStrategy, emitSwapStrategy,
    emitSatScene, emitSatStrategy, emitDrivenScene,
    emitSatBudgetScene, emitSatBudgetStrategy, emitSatBudgetValue, EMIT_SAT_BUDGETS,
    emitScatterScene, emitScatterNeeStrategy, emitScatterPtStrategy,
} from './scenes/emissionWitness.js';
import {
    shadowMediumScene, shadowMediumNeeStrategy, shadowMediumPtStrategy,
} from './scenes/shadowMediumWitness.js';

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
        strategies: posed([0, 1.2, 4], [0, 0.5, 0], twoLightPowerStrategy, twoLightUniformStrategy, twoLightBvhStrategy),
        exercises:
            'multi-light CDF dispatcher (lights.length>1); lightSelection power (key 1) vs uniform (key 2) vs the light tree (key 3 — table-resident delta lights, one-level descent)',
        expected: 'power (key 1), uniform (key 2), and bvh (key 3) converge to the SAME image; power/bvh are lower-variance',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'power ≡ uniform' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, label: 'power ≡ bvh (n = 2 delta lights)' },
            ],
        },
    },
    'hundred-spheres': {
        scene: hundredSpheres,
        strategies: posed([-7.5, 1.8, -7.5], [-4, 0.6, -4], hundredNeePowerStrategy, hundredNeeBvhStrategy, hundredMisPowerStrategy, hundredMisBvhStrategy),
        exercises:
            'the many-lights regime (fable-light-bvh): 100 sampleAsLight sphere emitters, table-resident '
            + 'lights + stochastic tree descent (keys 2/4) vs the position-blind power CDF (keys 1/3); '
            + 'objectDispatch table on all arms; pt-mis bvh replays the stored bit trail for the emitter-hit MIS weight',
        expected:
            'all four arms converge to the SAME image; the bvh arms are visibly cleaner near the camera corner '
            + 'at equal spp (selection follows 1/d² instead of power alone). Key 4 diverging from key 3 = pick/pmf drift.',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'nee: power ≡ bvh' },
                { kind: 'equality', strategies: [2, 3], meanTol: 0.02, label: 'mis: power ≡ bvh (THE trail-pmf gate)' },
                { kind: 'noise', strategies: [1, 0], assertFirstLowest: true, label: 'σ/µ(bvh) < σ/µ(power) at equal spp — the win metric' },
            ],
        },
    },
    'instance-lights': {
        scene: instanceLightsTwin,
        strategies: posed([-6.5, 1.6, -6.5], [-3, 0.5, -3], instanceLightsNeeStrategy, instanceLightsMisStrategy),
        exercises:
            'stage-2 instance lights (fable-light-bvh §7): ONE instanced batch of 64 emissive spheres = 64 tree lights; '
            + 'light identity = (batch region, Hit.element); the params-tier placement record IS the sphere-light row; '
            + 'the mis arm (key 2) replays the ELEMENT-indexed bit trail at emitter hits',
        expected:
            'converges to the instance-lights-ref image (same spheres as 64 individual objects); '
            + 'key 1 ≡ key 2 (any drift = element trail-pmf bug)',
        witness: {
            spp: 192,
            checks: [
                { kind: 'twin', other: { scene: 'instance-lights-ref' }, meanTol: 0.02, label: 'batch instances ≡ individual objects (both bvh)' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'nee ≡ mis (the ELEMENT trail-pmf gate)' },
            ],
        },
    },
    'instance-lights-sky': {
        scene: instanceLightsSky,
        strategies: posed([-6.5, 1.6, -6.5], [-3, 0.5, -3], instanceLightsNeeStrategy, instanceLightsMisStrategy),
        exercises: 'env-vs-finite selection when the only finite lights are a BATCH under the tree: the two-stage draw is live (u_envSelectProb declared) and the combiner reads the same probability',
        expected: 'the instance-lights image under a dim blue sky; key 1 ≡ key 2',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'batch lights + sky: nee ≡ mis' },
            ],
        },
    },
    'instance-lights-ref': {
        scene: instanceLightsRef,
        strategies: posed([-6.5, 1.6, -6.5], [-3, 0.5, -3], instanceLightsRefStrategy),
        exercises: 'the instance-lights twin\'s other half: the SAME 64 spheres as individual sampleAsLight objects (stage-1 table lights, scene-table dispatch)',
        expected: 'the twin target — see instance-lights',
    },
    'glow-shell': {
        scene: glowShell,
        strategies: posed([0, 0.2, 2.2], [0, 0, 0], glowShellNeeStrategy, glowShellMisStrategy, glowShellPtStrategy),
        exercises:
            'the near-field regime (fable-light-bvh §3.2): the camera INSIDE a shell of 100 instanced emitters — '
            + 'the d² clamp is the active importance term; nee-bvh (key 1) vs mis-bvh (key 2) vs path-found pt (key 3)',
        expected:
            'keys 1 and 2 converge to the same image (the clamp is variance-only, never bias); key 3 converges to it too '
            + 'but MUCH noisier (path-found emitters). σ/µ report quantifies the near-field win.',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'inside-the-cloud: nee ≡ mis under the near-field clamp' },
                { kind: 'noise', strategies: [0, 2], label: 'σ/µ report: sampled (bvh) vs path-found (pt) inside the shell' },
            ],
        },
    },
    'accel-triple': {
        scene: accelTriple,
        strategies: posed([-6.2, 3.2, -6.2], [0, 0.4, 0], accelTripleNeeStrategy, accelTripleMisStrategy, accelTriplePtStrategy),
        exercises:
            'the accel COMPOSITION (Aug 10 review gap): an EMISSIVE standalone mesh (BLAS walk + a MESH row in '
            + 'the light tree — mesh treeBounds) + an instanced MESH batch (frame-tier, BLAS-under-TLAS conjugation) '
            + '+ an emissive SPHERE batch (params tier, 24 instance lights) — mesh BLAS × instance TLAS × light tree '
            + 'in one program, mixed-kind tree leaves; NEE shadow rays thread the mesh AND batch any-hit walks',
        expected:
            'keys 1 and 2 converge to the same image (trail-pmf across mesh + element arms with all three accel '
            + 'structures live); key 3 (path-found pt) converges to it too, noisier',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'nee ≡ mis with mesh BLAS + instance TLAS + light tree composed' },
                // Chance-hit pt arm: coverage-mismatched with the NEE arms → RMSE tripwire,
                // CALIBRATED at the owner's Aug 10 sweep: Δmean 0.11%, rmse 52.44% @192spp
                // (small bright emitters, chance-hit noise floor — the mesh-light-twin story).
                // Δmean is the bias guard; the rmse trips only on gross structural divergence.
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.6, label: 'pt anchor (path-found emitters) tripwire' },
            ],
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
    // Mesh backend (impl-plan-meshes). mesh-furnace: F-BOX 0.4 through the triangle engine +
    // the emissive-mesh path — the sharpest single gate. mesh-quad-twin ⇄ mesh-quad-ref: same
    // floor+blocker geometry as a mesh vs analytic quads (cross-backend twin, exercises NEE
    // occlusion / the blocker's shadow via mesh_intersect_any).
    'mesh-furnace': {
        scene: meshFurnace,
        strategies: posed([0, 0, 0], [0, 0, -1], meshFurnaceStrategy),
        exercises: 'triangle-mesh engine (brute force) + emissive mesh (region_to = owner on front hit); a closed inward-normal cube with the F-BOX material → mean 0.4',
        expected: 'every pixel = EXACTLY 0.4 in linear HDR (F-BOX Le/(1−ρ)) — any energy leak in mesh intersect/shade/emission moves it off 0.4',
        witness: {
            spp: 48,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.01, label: 'mesh F-BOX 0.4' }],
        },
    },
    // Fixture partner: the constant-albedo half of the expression-material twin (P2).
    'expr-const-ref': {
        scene: exprConstRef,
        strategies: [exprTwinStrategy],
        exercises: 'constant-albedo reference arm of the expr-const twin (sphere albedo = plain vec3)',
    },
    'expr-const': {
        scene: exprConst,
        strategies: [exprTwinStrategy],
        exercises: 'sphere albedo authored as a GLSL FORMULA that evaluates to the reference constant (fable-imagery P2): the expression fill path + the (unread) chart gate must be transport-neutral — twin of expr-const-ref',
        expected: 'pixel-identical to expr-const-ref — a formula that computes a constant shades exactly like that constant; the expression scene turns real uv charts on but this formula never reads uv, so it cannot move the image',
        witness: {
            spp: 64,
            checks: [
                // Identical integrand + identical stream → near-bit-exact; the small tolerances
                // only absorb float-formatting of the literal. Any real gap = the expression fill
                // (or the chart-on gate) perturbing transport.
                { kind: 'twin', other: { scene: 'expr-const-ref' }, meanTol: 0.002, rmse: 0.01, label: 'formula ≡ constant albedo' },
            ],
        },
    },
    // Fixture partner: the lens-free half of the GRIN vacuum twin.
    'grin-vacuum-ref': {
        scene: grinVacuumRef,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinVacuumStrategy),
        exercises: 'reference arm of the grin-vacuum twin — the same scene with NO lens object',
    },
    'grin-vacuum': {
        scene: grinVacuum,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinVacuumStrategy),
        exercises:
            'constant-n ≡ vacuum (fable-variable-ior §6): an ior:1 lens routes rays through the GRIN Verlet walker (entry null crossing, ODE steps, refined boundary exit, delta record, current_medium recompute) and must be transport-INVISIBLE; the constant absorbing fog box puts the dispatcher\'s INLINE arm in the same program (the ms.deflected coexistence config of the Jul 21 bug)',
        expected:
            'converges to the SAME image as grin-vacuum-ref — n ≡ 1 bends nothing and weighs nothing. Any lens-shaped difference implicates the exit-ray spawn, boundary refinement, or medium re-classification; any FOG-shaped difference implicates dispatcher-ms initialization',
        witness: {
            spp: 128,
            checks: [
                // Same integrand, but streams diverge on lens-crossing pixels (the walk draws
                // random2() the ref arm never consumes) and pt is chance-hit → the display-space
                // RMSE tripwire, not χ². PROVISIONAL until calibrated at the pinned salt on the
                // first sweep; converged pt equality stays the owner's GPU check.
                { kind: 'twin', other: { scene: 'grin-vacuum-ref' }, meanTol: 0.02, rmse: 0.08, label: 'ior:1 lens ≡ no lens' },
            ],
        },
    },
    'grin-furnace': {
        scene: grinFurnaceScene,
        strategies: posed([0, 0, 0.6], [0, 0, -1], grinFurnaceStrategy),
        exercises:
            'F-BOX-M + a REAL Luneburg lens (n: √2 → 1, formula ior) inside the haze: genuine bending through the Verlet walker coexisting with the chromatic scattering arms; each traversal consumes a bounce (the orbit budget)',
        expected:
            'per-channel mean stays EXACTLY 0.4 — a weight-1 deflector cannot change the furnace equilibrium. Mean below 0.4 ⇒ bounce starvation or absorption sneaking into the GRIN arm; channels splitting ⇒ chromatic weight bug. NOTE: deliberately BLIND to wrong bending (any lossless field gives 0.4) — trajectory geometry is pinned by grin.test.ts (exact parabola + Bouguer); the F-LUNEBURG focal gate waits on probe checks',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.006, label: 'GRIN furnace 0.4/channel' }],
        },
    },
    'grin-long': {
        scene: grinLongScene,
        strategies: posed([0, 0, 2], [0, 0, -10], grinLongStrategy),
        exercises: 'a GRIN traversal is ONE event however long (taxonomy §4.1), and the walker ends long traversals by an unbiased roulette every 512 steps: an orthographic view through a 30-unit (left, 2 rounds) and a 60-unit (right, 5 rounds) ior:1 region at a unit sky, maxBounces 1',
        expected: 'both halves read exactly 1 (a step-count charge against the bounce budget reads 0; a biased give-up reads low, more so on the right); the right half is noisier than the left',
        witness: {
            spp: 64,
            // σ of each half's mean ≈ 0.0007 (left) and 0.0011 (right) at 64 spp.
            checks: [
                { kind: 'mean', value: 1, tol: 0.006, region: { x: 0.05, y: 0.1, w: 0.4, h: 0.8 }, label: '30-unit traversal (2 roulette rounds)' },
                { kind: 'mean', value: 1, tol: 0.006, region: { x: 0.55, y: 0.1, w: 0.4, h: 0.8 }, label: '60-unit traversal (5 roulette rounds)' },
            ],
        },
    },
    // Fixture partner: the plain-dielectric half of the hard-interface glass twin.
    'grin-glass-ref': {
        scene: grinGlassRef,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinGlassStrategy),
        exercises: 'reference arm of the grin-glass twin — the SAME sphere as a plain ior:1.5 dielectric (region-table constant, no ODE code in the program)',
    },
    'grin-glass': {
        scene: grinGlass,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinGlassStrategy),
        exercises:
            'THE HARD-INTERFACE TWIN (impl-plan-grin-interface): a constant-FORMULA medium ior on a dielectric wall routes through the FULL new pipeline — entry Fresnel reading ior_of(region, p), the Verlet walker on a straight line (∇n = 0), the t_max guard, the inside-exit handoff, exit Fresnel/TIR, the interior L/n² factor (= 1 at constant n)',
        expected:
            'converges to the SAME image as grin-glass-ref (plain glass through the GPU-verified F-ETA-class machinery). A lens-shaped difference implicates the handoff/guard/factor; a brightness difference in the ball implicates the η² bookkeeping split across entry/interior/exit',
        witness: {
            spp: 128,
            checks: [
                // Streams diverge (the GRIN arm consumes the medium branch's random2() and an
                // extra bounce per traversal) and pt is chance-hit → the display-space RMSE
                // tripwire, not χ². PROVISIONAL until calibrated at the pinned salt on the
                // first sweep; converged pt equality stays the owner's GPU check.
                { kind: 'twin', other: { scene: 'grin-glass-ref' }, meanTol: 0.02, rmse: 0.08, label: 'formula-ior glass ≡ plain glass' },
            ],
        },
    },
    // Fixture partner: the closed-form-arm half of the emission twin.
    'grin-emit-ref': {
        scene: grinEmitRef,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinEmitStrategy),
        exercises: 'reference arm of the grin-emit twin — the same emissive absorbing medium through the INLINE closed-form arm (no ior)',
    },
    'grin-emit': {
        scene: grinEmit,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinEmitStrategy),
        exercises:
            'EMISSION ALONG THE BENT PATH (impl-plan-grin-media batch 1): an ior:1 emissive absorbing medium through the GRIN walker\'s PER-STEP collection (E1.5 closed form each step × the (n₀/n)² source factor, ≡ 1 at constant n)',
        expected:
            'converges to the SAME image as grin-emit-ref — for constant coefficients the per-step sum TELESCOPES to the closed-form arm\'s exact integral. A glow-brightness difference implicates the per-step collection or the source factor',
        witness: {
            spp: 128,
            checks: [
                { kind: 'twin', other: { scene: 'grin-emit-ref' }, meanTol: 0.02, rmse: 0.08, label: 'per-step emission ≡ closed form' },
            ],
        },
    },
    'grin-furnace-emit': {
        scene: grinFurnaceEmitScene,
        strategies: posed([0, 0, 0.6], [0, 0, -1], grinFurnaceEmitStrategy),
        exercises:
            'THE KIRCHHOFF GATE (impl-plan-grin-media batch 1): an absorbing Luneburg region authored with its local thermal source ε(x) = σ_a·L₀·n²(x) (an expression ε on a deflecting medium — majorant-free by the carve). Radiance inside index n is n²·L₀, so equilibrium holds ONLY if emission carries the (n₀/n)² source factor',
        expected:
            'per-channel mean stays EXACTLY 0.4 — without the source factor the re-emitted term mis-scales by n² (up to 2× at the lens center) and the mean drifts. Every other furnace witness is blind to this term',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.006, label: 'Kirchhoff GRIN furnace 0.4/channel' }],
        },
    },
    // Fixture partner: the analytic-arm half of the scattering twin.
    'grin-scatter-ref': {
        scene: grinScatterRef,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinScatterStrategy),
        exercises: 'reference arm of the grin-scatter twin — the same scattering medium through the analytic channel-MIS arm (no ior)',
    },
    'grin-scatter': {
        scene: grinScatter,
        strategies: posed([0, 1.4, 4], [0, 1, 0], grinScatterStrategy),
        exercises:
            'SCATTERING ALONG THE BENT PATH (impl-plan-grin-media batch 2): an ior:1 scattering medium through the GRIN arc-length channel-MIS sampler (the analytic arm\'s math with t → arc, the walk discovering the exit, the EVENT RAY riding exit_p/exit_dir)',
        expected:
            'converges to the SAME image as grin-scatter-ref (the analytic arm). A fog-brightness difference implicates the arc sampler\'s weights; a fog-SHAPE difference implicates the event-ray unification (the walk reading ms.exit_p/exit_dir)',
        witness: {
            spp: 128,
            checks: [
                { kind: 'twin', other: { scene: 'grin-scatter-ref' }, meanTol: 0.02, rmse: 0.08, label: 'arc channel-MIS ≡ analytic arm' },
            ],
        },
    },
    'grin-furnace-scatter': {
        scene: grinFurnaceScatterScene,
        strategies: posed([0, 0, 0.6], [0, 0, -1], grinFurnaceScatterStrategy),
        exercises:
            'the haze INSIDE the deflecting region (impl-plan-grin-media batch 2): a Luneburg lens whose OWN medium scatters (chromatic σ_s, HG g=0.7) — genuine bending × genuine scattering in one region walker',
        expected:
            'per-channel mean stays EXACTLY 0.4 — lossless scattering × lossless bending preserves the furnace equilibrium; channels splitting ⇒ chromatic weight bug in the arc sampler; low mean ⇒ bounce starvation (scatter events + traversals both consume bounces)',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.006, label: 'scattering-interior GRIN furnace 0.4/channel' }],
        },
    },
    'grin-furnace-hard': {
        scene: grinFurnaceHardScene,
        strategies: posed([0, 0, 0.6], [0, 0, -1], grinFurnaceHardStrategy),
        exercises:
            'the CONSERVATION gate for the hard interface: a dielectric-walled blob with a LINEAR field n(p) = 1.5 + 0.9·(y − c_y) — real Fresnel (η ≠ 1 at every wall point), TIR, genuine bending (constant vertical force), and DIFFERENT n at each path\'s entry and exit points',
        expected:
            'per-channel mean stays EXACTLY 0.4 — enter (1/n_A)² · interior (n_A/n_B)² · exit (n_B)² = 1 only if the interior L/n² factor is present and right; without it this reads visibly off 0.4 (grin-furnace, whose walls sit at n = 1, is blind to it). Mean below 0.4 ⇒ bounce starvation (TIR loops) before physics — raise maxBounces first',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: 0.4, tol: 0.006, label: 'hard-interface GRIN furnace 0.4/channel' }],
        },
    },
    // Fixture partner: the analytic-quad half of the mesh-quad twin.
    'mesh-quad-ref': {
        scene: meshQuadRef,
        strategies: [meshTwinStrategy],
        exercises: 'analytic-quad reference arm of the mesh-quad twin (floor + blocker as two analytic quads)',
    },
    'mesh-quad-twin': {
        scene: meshQuadTwin,
        strategies: [meshTwinStrategy, meshTwinBruteStrategy],
        exercises: 'floor + floating blocker authored as ONE triangle mesh: primary hits, Lambert shading, and NEE occlusion (mesh_intersect_any casts the blocker\'s shadow) — twin of mesh-quad-ref (analytic quads); key 2 = the brute-force traversal arm',
        expected: 'converges to the same image as mesh-quad-ref (the mesh and analytic backends agree); bvh ≡ brute near-exactly (same candidate set, same stream)',
        witness: {
            spp: 96,
            checks: [
                // Cross-backend twin → the display-space RMSE gate (like analytic-minimal), not χ².
                { kind: 'twin', other: { scene: 'mesh-quad-ref' }, meanTol: 0.02, rmse: 0.08, label: 'mesh ≡ analytic quads' },
                // Estimator-swap obligation (taxonomy): identical stream + identical candidate
                // set → near-bit-exact; any gap is a real traversal bug (dropped subtrees,
                // slab edge, wrong leaf range). Tight rmse opts out of χ² (identical-stream arms).
                { kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'bvh ≡ brute (identical stream)' },
            ],
        },
    },
    // Instancing (impl-plan-instancing): one prototype × N placements ≡ N individual objects.
    'instance-twin-ref': {
        scene: instanceTwinRef,
        strategies: [instanceTwinStrategy],
        exercises: 'reference arm of the instance twin — the three spheres as individual analytic objects',
    },
    'instance-twin': {
        scene: instanceTwin,
        strategies: [instanceTwinStrategy, instanceTwinLinearStrategy],
        exercises: 'three spheres as ONE instanced batch (shared prototype + placement texture, ray-into-local, one region) — the placement loop vs the ordinary analytic path; key 2 = the linear-scan arm',
        expected: 'converges to the same image as instance-twin-ref (instancing changes cost + region count, not the image); tlas ≡ linear near-exactly',
        witness: {
            spp: 96,
            checks: [
                { kind: 'twin', other: { scene: 'instance-twin-ref' }, meanTol: 0.01, rmse: 0.03, label: 'instanced ≡ individual objects' },
                // Estimator-swap obligation: the TLAS visits the same placements as the
                // linear scan with the same stream — near-bit-exact (see mesh-quad-twin).
                { kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'tlas ≡ linear (identical stream)' },
            ],
        },
    },
    // The placement-record tier (impl-plan-placement-fold stage 3): the 1-texel
    // folded-params record ≡ the pinned 2-texel rigid-frame record on the SAME rotated,
    // scale-varied, off-center sphere batch — identical stream, identical TLAS.
    'instance-params-frame': {
        scene: instanceParamsFrame,
        strategies: [instanceParamsStrategy],
        exercises: 'frame arm of the params-tier twin — the same batch pinned to the 2-texel §6.1 rigid record (`placementRecord: \'frame\'`)',
    },
    'instance-params-twin': {
        scene: instanceParamsTwin,
        strategies: [instanceParamsStrategy, instanceParamsCwbvhStrategy],
        exercises: 'the params-tier placement record (impl-plan-placement-fold): a rotated, scale-varied, OFF-CENTER sphere batch as 1-texel folded-parameter records — world-space intersect, no conjugation; rotations absorbed exactly by the fold. Key 2 = the CWBVH arm (fable-accel-cwbvh): compressed 8-wide quantized nodes, octant-ordered scalar walk',
        expected: 'near-bit-identical to instance-params-frame (same placements, same TLAS, same stream — only the record layout differs); cwbvh ≡ tlas near-exactly (conservative quantization adds tests, never changes hits)',
        witness: {
            spp: 96,
            checks: [
                { kind: 'twin', other: { scene: 'instance-params-frame' }, meanTol: 0.002, rmse: 0.01, label: 'params ≡ frame records (identical stream)' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'cwbvh ≡ tlas (identical stream)' },
            ],
        },
    },
    // The acceleration-structure perf bench (report-only; `npm run witness -- --perf`,
    // real GPU): ms/frame on a 200k-sphere procedural cloud, params vs frame record
    // tiers. Future accel occupants (wide/compressed nodes) add arms here.
    'perf-cloud': {
        scene: perfCloud,
        strategies: [perfCloudStrategy, perfCloudCwbvhStrategy],
        exercises: `the perf bench (impl-plan-placement-fold): ${PERF_CLOUD_COUNT / 1000}k procedural spheres as ONE params-tier batch (1-texel folded records) — TLAS traversal + nee any-hit dominate; ms/frame is the number every accel change ships against. Key 2 = the CWBVH arm (fable-accel-cwbvh — the experiment's verdict row)`,
        expected: 'report-only ms/frame under --perf (real GPU); compare against perf-cloud-frame for the record-tier delta and across rows for the cwbvh verdict (go at ≥1.15×)',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'params tier ms/frame @512² (binary tlas)' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'CWBVH ms/frame @512²' },
            ],
        },
    },
    'perf-cloud-frame': {
        scene: perfCloudFrame,
        strategies: [perfCloudStrategy],
        exercises: 'frame arm of the perf bench — the identical cloud pinned to 2-texel rigid records (`placementRecord: \'frame\'`)',
        expected: 'report-only ms/frame under --perf; the delta vs perf-cloud is the params tier\'s win',
        witness: {
            spp: 8,
            checks: [{ kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'frame tier ms/frame @512²' }],
        },
    },
    // The scene table (fable-object-tables): 'table' ≡ 'unrolled' on a many-unique-object
    // scene with residual tenants (plane floor + driven sphere) — identical-stream gate.
    bazaar: {
        scene: bazaarScene,
        strategies: [bazaarTableStrategy, bazaarUnrolledStrategy],
        exercises: 'the SCENE TABLE (fable-object-tables): ~35 unique objects as typed records under ONE scene TLAS (analytic + mesh + batch leaves) beside the residual unrolled arm (plane floor, driven sphere) — key 1 = table, key 2 = unrolled',
        expected: 'the two dispatch regimes are near-bit-identical (same stream, same candidates — only addressing differs)',
        witness: {
            spp: 64,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'table ≡ unrolled (identical stream)' }],
        },
    },
    // Mesh area light (fable-mesh-lights): an emissive 2-triangle panel ≡ the analytic
    // quad light with identical corner/edges/Le — the EXACT cross-kind twin (sampler,
    // identity-free pdf, and power must all match the quad's closed forms).
    'mesh-light-ref': {
        scene: meshLightRef,
        strategies: meshLightStrategies,
        exercises: 'reference arm of the mesh-light twin — the same panel as the analytic quad emitter (material route)',
    },
    'mesh-light-smooth': {
        scene: meshLightSmooth,
        strategies: meshLightStrategies.slice(0, 2),
        exercises: 'a SMOOTH-SHADED emissive mesh (an octahedron lamp with radial vertex normals, up to 54.7° off the face normals): a ray spawned from the lamp must start on the side of the TRUE surface it travels into (ray_spawn offsets along Hit.ng). Does not guard the MIS pdf query\'s use of Hit.ng, which is worth ~0.05% here',
        expected: 'keys 1 (pt-nee) and 2 (pt-mis) converge to the same image; pt-mis ~5% bright means spawned rays are crossing back through their own triangle',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'smooth mesh light nee ≡ mis' },
            ],
        },
    },
    'mesh-slab-albedo': {
        scene: meshSlabAlbedoScene,
        strategies: [
            ...posed(SLAB_VIEWS.normal.position, [0, 0, 0], slabRrOffStrategy),
            withPose(slabGrazingStrategy, SLAB_VIEWS.grazing.position, [0, 0, 0]),
        ],
        exercises: 'the mesh self-intersection margin: slab-albedo (the exact Chandrasekhar plane albedo of a scattering halfspace) with the slab as a CLOSED MESH — a margin of 1e-3 world units is 0.02 optical depths here, the scale that biased the analytic slab 1–3% low before its margins became fp-relative',
        expected: 'the same exact plane albedos as slab-albedo: [0.2488, 0.4375, 0.6466] at mu = 1, [0.3741, 0.5824, 0.7654] at mu = 0.3',
        witness: {
            spp: 128,
            checks: [
                { kind: 'mean', value: SLAB_PLANE_ALBEDO.normal, tol: 0.006, strategy: 0, source: { tier: 'exact', from: 'A_p(1) via halfspace.ts' }, label: 'mesh slab exact plane albedo, mu = 1' },
                { kind: 'mean', value: SLAB_PLANE_ALBEDO.grazing, tol: 0.006, strategy: 1, source: { tier: 'exact', from: 'A_p(0.3) via halfspace.ts' }, label: 'mesh slab exact plane albedo, mu = 0.3' },
            ],
        },
    },
    'mesh-scale-twin-ref': {
        scene: meshScaleTwinRef,
        strategies: posed(MESH_TWIN_POSE.position, MESH_TWIN_POSE.target, meshScaleStrategy),
        exercises: 'reference arm of mesh-scale-twin: a mesh floor and block under a uniform sky at unit scale',
    },
    'mesh-scale-twin': {
        scene: meshScaleTwin,
        strategies: posed(
            MESH_TWIN_POSE.position.map((c) => c * MESH_TWIN_SCALE) as [number, number, number],
            MESH_TWIN_POSE.target.map((c) => c * MESH_TWIN_SCALE) as [number, number, number],
            meshScaleStrategy),
        exercises: 'scale invariance of mesh transport: the mesh-scale-twin-ref scene shrunk 100× about the origin, camera with it — no lights, so the mesh self-intersection margin is the only world-space constant involved',
        expected: 'the same image as mesh-scale-twin-ref',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'mesh-scale-twin-ref' }, meanTol: 0.001, rmse: 0.004, label: 'mesh scene ≡ the same scene ×0.01' }],
        },
    },
    'mesh-light-twin': {
        scene: meshLightTwin,
        strategies: [...meshLightStrategies, ...meshLightBvhStrategies],
        exercises: 'the lights family\'s first DATA-DRIVEN kind: an emissive 2-triangle mesh panel sampled via the cumulative-area CDF texture (uniform-area, identity-free pdf r²/(cosθ·A_total), one-sided) — exact twin of mesh-light-ref; keys 1/2/3 = pt-nee/pt-mis/pt; keys 4/5 = the same panel under lightSelection bvh (the mesh TABLE ROW + tree-regime rail-base dispatch — mesh treeBounds)',
        expected: 'pt-nee, pt-mis, and pt all converge to mesh-light-ref\'s image (every mesh-light formula must agree with the quad\'s closed forms); keys 4/5 match key 1 exactly (one-leaf tree: selection ≡ 1)',
        witness: {
            spp: 96,
            checks: [
                { kind: 'twin', other: { scene: 'mesh-light-ref' }, meanTol: 0.02, label: 'mesh light ≡ quad light (nee)' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'mesh light nee ≡ mis' },
                // pt tripwire CALIBRATED at the owner's Jul 20 sweep: measured rmse 49.3%
                // @96spp — this scene is the chance-hit worst case BY DESIGN (a small bright
                // panel in a near-black room), so its display-space noise floor sits far
                // above X-CORNELL's bright-room 0.4. Δmean (0.37% measured) is the real
                // bias guard; the rmse only trips on gross structural divergence.
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.6, label: 'mesh light pt tripwire' },
                // Mesh under the tree (mesh treeBounds): same estimand, tree-regime arms.
                { kind: 'equality', strategies: [0, 3], meanTol: 0.02, label: 'nee: power ≡ bvh (the mesh table row)' },
                { kind: 'equality', strategies: [3, 4], meanTol: 0.02, label: 'bvh: nee ≡ mis (mesh under the tree)' },
            ],
        },
    },
    // Containment (fable-mesh-containment): a CLOSED cube mesh ≡ the same cube as an SDF
    // box, across the three things containment unlocks (dielectric interior, interior
    // medium, innermost-wins nesting). Cross-backend twins → display-space rmse gates.
    'mesh-glass-box-ref': {
        scene: meshGlassPair.ref,
        strategies: [containStrategy],
        exercises: 'reference arm of the mesh-glass twin — the same cube as an SDF box with the dielectric',
    },
    'mesh-glass-box': {
        scene: meshGlassPair.mesh,
        strategies: [containStrategy],
        exercises: 'a CLOSED cube mesh with a dielectric: first-hit-facing containment + closest-distance |d| feed scene_region_at, the exit hit classifies region_from = mesh, ior_of has a mesh row — twin of mesh-glass-box-ref',
        expected: 'converges to the same image as mesh-glass-box-ref (a solid glass mesh ≡ a solid glass SDF box)',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'mesh-glass-box-ref' }, meanTol: 0.03, rmse: 0.08, label: 'mesh glass ≡ SDF glass' }],
        },
    },
    'mesh-fog-ref': {
        scene: meshFogPair.ref,
        strategies: [containStrategy],
        exercises: 'reference arm of the mesh-fog twin — the same cube as an SDF box with the null-interface fog material',
    },
    'mesh-fog': {
        scene: meshFogPair.mesh,
        strategies: [containStrategy],
        exercises: 'an absorbing medium INSIDE a closed mesh (null interface + the medium walker classifying segments by mesh containment) — twin of mesh-fog-ref',
        expected: 'converges to the same image as mesh-fog-ref (fog in a mesh ≡ fog in an SDF box)',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'mesh-fog-ref' }, meanTol: 0.03, rmse: 0.08, label: 'mesh fog ≡ SDF fog' }],
        },
    },
    'mesh-submerged-ref': {
        scene: meshSubmergedPair.ref,
        strategies: [containStrategy],
        exercises: 'reference arm of the mesh-submerged twin — the inner solid as an SDF box inside the water sphere',
    },
    'mesh-submerged': {
        scene: meshSubmergedPair.mesh,
        strategies: [containStrategy],
        exercises: 'a scaled CLOSED glass mesh nested INSIDE a water sphere — innermost-wins must rank the containers by |d| (the closest-distance query × the s·d correction; the R-SUBMERGED exercise with a mesh inner region) — twin of mesh-submerged-ref',
        expected: 'converges to the same image as mesh-submerged-ref (nesting order identical across backends)',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'mesh-submerged-ref' }, meanTol: 0.03, rmse: 0.08, label: 'mesh-in-water ≡ box-in-water' }],
        },
    },
    // Per-instance attributes (fable-instance-attributes): one batch material, three
    // per-instance albedos via the Hit.element-indexed attrs table.
    'attr-twin-ref': {
        scene: attrTwinRef,
        strategies: [attrTwinStrategy],
        exercises: 'reference arm of the attribute twin — the three spheres as individual objects with three materials',
    },
    'attr-twin': {
        scene: attrTwin,
        strategies: [attrTwinStrategy],
        exercises: 'three spheres as ONE batch with per-instance albedo ATTRIBUTES (the fourth storage class: Hit.element → the TLAS-reordered instance_k_attrs table) — twin of attr-twin-ref; a reorder bug shows as swapped colors',
        expected: 'converges to the same image as attr-twin-ref (per-instance attributes ≡ per-object materials)',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'attr-twin-ref' }, meanTol: 0.01, rmse: 0.03, label: 'attribute albedos ≡ individual materials' }],
        },
    },
    // Mesh-prototype instancing (the ÷s-convention guard — the bug class found only by
    // GPU render on scale≠1 instances; see impl-plan-instancing's convention record).
    'mesh-instance-ref': {
        scene: meshInstanceRef,
        strategies: [meshInstanceStrategy],
        exercises: 'reference arm of the mesh-instance twin — the three rotated/scaled cube meshes as individual mesh objects (constant ray-into-local placement)',
    },
    'mesh-instance-twin': {
        scene: meshInstanceTwin,
        strategies: [meshInstanceStrategy],
        exercises: 'three rotated, SCALE-VARIED cube meshes as ONE instanced batch (shared BLAS, ÷s ray-into-local conjugation, per-batch TLAS) — twin of mesh-instance-ref; guards the mesh arm\'s non-unit-ray convention',
        expected: 'converges to the same image as mesh-instance-ref (shared-BLAS instancing ≡ individual meshes, including scale ≠ 1)',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'mesh-instance-ref' }, meanTol: 0.01, rmse: 0.03, label: 'instanced meshes ≡ individual meshes' }],
        },
    },
    // Fixture partner: the SDF half of the analytic-minimal twin (and the direct-only
    // strategy demo rides along on key 2).
    minimal: {
        scene: minimalScene,
        strategies: posed([0, 1, 5], [0, 0, 0], minimalStrategy, directOnlyStrategy),
        exercises: 'constant environment; pathtracer vs direct-only strategy from one scene; twin partner of analytic-minimal',
    },
    'field-glass': {
        scene: fieldGlass,
        strategies: posed([1.4, 1.5, 1.9], [0, 0.8, 0], fieldGlassNeeStrategy, fieldGlassMisStrategy, fieldGlassPtStrategy),
        exercises:
            'the scene-local field door (fable-sdf-contract §5.2) under the X-GLASS pattern: a defineSDF '
            + 'quartic SOLID (value/gradient estimate + `refine: 4`) in real dielectric glass under a samplable '
            + 'panel — delta bookkeeping through a scene-local field\'s interfaces, containment via its twin-'
            + 'checked signed field, hit refinement\'s placement of the entry/exit interfaces',
        expected:
            'keys 1 (nee) and 2 (mis) converge to the same image; key 3 (pt) too, noisier — arm divergence '
            + 'implicates interface placement/classification on the marched field (the ring-banding class)',
        witness: {
            spp: 256,
            checks: [
                // Pre-calibration estimates (X-GLASS values) — the first owner sweep calibrates.
                { kind: 'equality', strategies: [0, 1], meanTol: 0.03, label: 'field-glass nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.4, label: 'field-glass pt tripwire' },
            ],
        },
    },
    'sdf-table-twin': {
        scene: sdfTableTwin,
        strategies: posed([-7.5, 1.1, -7.5], [0, 0.4, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises:
            'boxed-SDF leaves (fable-sdf-accel): 30 rotated pinned-SDF objects + the grazing ground slab — '
            + 'global min-march (key 1) vs per-leaf INTERVAL marching through the scene TLAS (key 2: LEAF_SDF '
            + 'records with the rigid tail, node-box intervals, the §3 epsilon rule); containment via the SDF '
            + 'record loop on the table arm',
        expected:
            'keys 1 and 2 identical (bias-free estimator swap; the low camera grazes the slab, so any '
            + 'interval-end epsilon mistake shows as silhouette divergence)',
        witness: {
            spp: 96,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.002, rmse: 0.01, label: 'table ≡ unrolled (identical stream, grazing stress)' },
            ],
        },
    },
    'perf-sdf-8': {
        scene: perfSdf8,
        strategies: posed([8, 5.5, 8], [0, 1.8, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises: 'the SDF crossover referee at N=8 (fable-sdf-accel §5): unrolled global march vs LEAF_SDF table — the design predicts unrolled WINS here',
        expected: 'report-only ms/frame under --perf; compare rows across N for the crossover',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'N=8 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'N=8 table ms/frame @512²' },
            ],
        },
    },
    'perf-sdf-32': {
        scene: perfSdf32,
        strategies: posed([8, 5.5, 8], [0, 1.8, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises: 'the SDF crossover referee at N=32 — the design\'s predicted crossover zone',
        expected: 'report-only ms/frame under --perf',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'N=32 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'N=32 table ms/frame @512²' },
            ],
        },
    },
    'perf-sdf-128': {
        scene: perfSdf128,
        strategies: posed([8, 5.5, 8], [0, 1.8, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises: 'the SDF crossover referee at N=128 — the table regime\'s home turf (empty space skipped analytically, per-step cost 1 field)',
        expected: 'report-only ms/frame under --perf; table should win decisively',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'N=128 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'N=128 table ms/frame @512²' },
            ],
        },
    },
    'sdf-instance-twin': {
        scene: sdfInstanceTwin,
        strategies: posed([4.6, 2.4, 4.6], [0, 0.5, 0], sdfInstanceStrategy),
        exercises:
            'the MARCHED PROTOTYPE door (impl-plan-sdf-as-shape T7): 12 marched boxes as one instanced batch — '
            + 'placements from the rail, the prototype marched inside its declared bound in its own rigid frame — '
            + 'against the same 12 as individual objects',
        expected: 'identical to sdf-instance-twin-ref (identical stream): the instance path must reproduce the per-object path exactly',
        witness: {
            spp: 96,
            checks: [
                { kind: 'twin', other: { scene: 'sdf-instance-twin-ref' }, meanTol: 0.002, rmse: 0.01, label: 'marched batch ≡ 12 individual marched boxes' },
            ],
        },
    },
    'sdf-instance-twin-ref': {
        scene: sdfInstanceTwinRef,
        strategies: posed([4.6, 2.4, 4.6], [0, 0.5, 0], sdfInstanceStrategy),
        exercises: 'twin partner: the same 12 marched boxes as individual objects (the reference arm)',
    },
    'perf-sdf-0': {
        scene: perfSdf0,
        strategies: posed([8, 5.5, 8], [0, 1.8, 0], sdfTableStrategy),
        exercises: 'the FLOOR row for the SDF ladders: identical film/camera/floor/light, zero SDF objects — subtract it from every other row to read SDF-attributable cost',
        expected: 'report-only ms/frame under --perf',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'N=0 floor ms/frame @512²' },
            ],
        },
    },
    'perf-sdf-cluster-8': {
        scene: perfSdfCluster8,
        strategies: posed([3.0, 2.4, 3.0], [0, 1.8, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises: 'the OVERLAP referee at N=8: the same shapes packed into one fixed ball, framed identically at every N — box overlap is the only variable across the cluster ladder',
        expected: 'report-only ms/frame under --perf; read against perf-sdf-8 (same N, spread apart) to separate re-walking cost from empty-space savings',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'cluster N=8 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'cluster N=8 table ms/frame @512²' },
            ],
        },
    },
    'perf-sdf-cluster-32': {
        scene: perfSdfCluster32,
        strategies: posed([3.0, 2.4, 3.0], [0, 1.8, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises: 'the OVERLAP referee at N=32 — same ball, same framing, 4× the box-overlap depth',
        expected: 'report-only ms/frame under --perf',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'cluster N=32 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'cluster N=32 table ms/frame @512²' },
            ],
        },
    },
    'perf-sdf-cluster-128': {
        scene: perfSdfCluster128,
        strategies: posed([3.0, 2.4, 3.0], [0, 1.8, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises: 'the OVERLAP referee at N=128 — the densest packing on the ladder (deep box overlap AND a heavy per-step ×N for the shared loop)',
        expected: 'report-only ms/frame under --perf',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'cluster N=128 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'cluster N=128 table ms/frame @512²' },
            ],
        },
    },
    'perf-sdf-blob': {
        scene: perfSdfBlob,
        strategies: posed([1.55, 1.05, 1.55], [0, 1.0, 0], sdfUnrolledStrategy, sdfTableStrategy),
        exercises:
            'THE adversarial case for per-object marching (fable-sdf-accel, the Aug 10 architecture question): 6 mutually '
            + 'interpenetrating shapes in one lump, camera close and level so the lump fills the frame at grazing incidence — '
            + 'little empty space to skip, every ray re-walks the same stretch once per overlapping box, and N is small enough '
            + 'that the global march\'s per-step ×6 is nearly free',
        expected:
            'report-only ms/frame under --perf. If the shared global marcher (key 1) wins anywhere it wins HERE; if the table arm '
            + '(key 2) ties or wins, "an SDF is a shape with a slow intersect" carries no measurable penalty at its worst case',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'blob N=6 unrolled ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'blob N=6 table ms/frame @512²' },
            ],
        },
    },
    'solids-analytic': {
        scene: solidsAnalytic,
        strategies: posed([-3.4, 3.2, 4.6], [0, 0.5, 0], solidsStrategy),
        exercises:
            'placement-fold stage 4: box slab + cylinder interval ANALYTIC intersectors — the rotated box/cylinder '
            + 'ride the rigid-residual analytic arm (the first NON-closed constant shapes there: baked quat, T,s folded), '
            + 'the unrotated box the bare params-folded arm; twin of solids-sdf (the same scene under backend pins)',
        expected: 'converges to solids-sdf\'s image (closed forms ≡ marcher on every face and silhouette)',
        witness: {
            spp: 96,
            // Cross-backend twin → display-space gate, not χ² (the analytic-minimal note).
            checks: [{ kind: 'twin', other: { scene: 'solids-sdf' }, meanTol: 0.02, rmse: 0.08, label: 'box/cylinder analytic ≡ SDF backend' }],
        },
    },
    'solids-sdf': {
        scene: solidsSdf,
        strategies: posed([-3.4, 3.2, 4.6], [0, 0.5, 0], solidsStrategy),
        exercises: 'the solids twin\'s marcher arm (backend: sdf pins — deliberate marcher coverage, the minimal/submerged pattern)',
        expected: 'the twin target — see solids-analytic',
    },
    'cube-cloud': {
        scene: cubeCloud,
        strategies: posed([-5.2, 4.0, 5.2], [0, 0.5, 0], cubeCloudStrategy),
        exercises:
            'the cube-clouds door (fable-instance-clouds §8, closed by stage 4): 48 rotated scale-varied boxes as ONE '
            + 'instanced batch — FRAME-tier records (box is not similarityClosed) conjugating the world ray into the '
            + 'prototype frame per instance, box_intersect with s-scaled params, TLAS over the world boxes',
        expected: 'converges to cube-cloud-ref\'s image (batch ≡ 24 individual boxes)',
        witness: {
            spp: 96,
            checks: [{ kind: 'twin', other: { scene: 'cube-cloud-ref' }, meanTol: 0.01, rmse: 0.03, label: 'instanced cubes ≡ individual boxes' }],
        },
    },
    'cube-cloud-ref': {
        scene: cubeCloudRef,
        strategies: posed([-5.2, 4.0, 5.2], [0, 0.5, 0], cubeCloudStrategy),
        exercises: 'the cube-cloud twin\'s other half: the same 48 boxes as individual rigid-residual analytic objects',
        expected: 'the twin target — see cube-cloud',
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
    'slab-albedo': {
        scene: slabAlbedoScene,
        strategies: [
            // FOUR ARMS = three exit angles plus the roulette twin at normal. The pose travels
            // WITH the strategy, so each angle needs its own posed() call — sharing one would
            // silently measure the same direction three times.
            ...posed(SLAB_VIEWS.normal.position, [0, 0, 0], slabRrOffStrategy, slabRrInteriorStrategy),
            withPose(slabObliqueStrategy, SLAB_VIEWS.oblique.position, [0, 0, 0]),
            withPose(slabGrazingStrategy, SLAB_VIEWS.grazing.position, [0, 0, 0]),
        ],
        exercises:
            'F-SLAB-A — does our transport reproduce the EXACT albedo of a semi-infinite scattering halfspace? An '
            + '80-free-path slab of a medium built by subsurfaceMedium, under a uniform environment of radiance 1, viewed '
            + 'through an ORTHOGRAPHIC camera so every ray shares one exit cosine. For isotropic scattering the halfspace '
            + 'has a classical closed-form solution (Chandrasekhar: A_p(mu) = 1 - sqrt(1-omega)*H(mu)), evaluated to ~1e-14 '
            + 'by tests/helpers/halfspace.ts — so this is an EXACT gate, not a comparison against a ~1%-accurate fit. '
            + 'Chromatic target [0.3, 0.5, 0.7] = three independent points on the curve per frame; three viewing angles = '
            + 'the only gate in the suite on the ANGULAR structure of a medium exit distribution (the reading rises 50% '
            + 'from normal to mu = 0.3 in red). NULL interface on purpose (no Fresnel mixing in — that is sss-furnace\'s '
            + 'job) and SCALAR radius on purpose (equal sigma_t keeps every per-event weight at exactly alpha_c < 1). '
            + 'KEY 2 IS THE INTERIOR-TERMINATION GATE: this scene has NO surface events at all, so every difference '
            + 'between keys 1 and 2 is roulette_interior and nothing else. NOTE this witness was rebuilt Aug 2026 — it '
            + 'used to assert the AUTHORED COLOUR, which is a hemispherical albedo and cannot be read by a camera; that '
            + 'claim now lives in tests/authoring/subsurface.test.ts.',
        expected:
            'per-channel mean = the exact plane albedo at each arm\'s exit cosine: [0.2488, 0.4375, 0.6466] at mu = 1 '
            + '(keys 1-2), [0.3066, 0.5088, 0.7086] at mu = 0.6, [0.3741, 0.5824, 0.7654] at mu = 0.3. Plus keys 1 and 2 '
            + 'must agree as estimators of the same integrand. HISTORY (Aug 12 2026): this witness was KNOWINGLY RED for '
            + 'one sweep — low by 2.7/1.9/1.1% at mu = 1 from a REAL RENDERER BIAS at the world-space epsilon scale: J1, '
            + 'ray_spawn\'s fixed 1e-3 normal offset (0.02 optical depths skipped on entry at sigma_t = 20), and J2, the '
            + 'primitives\' t > EPSILON floor refusing shallow exit roots (the walk then continued in a fictitious '
            + 'unbounded medium). Measured at roughly half each, INTERACTING (J1 masks J2), by a renderer-twin CPU walk '
            + 'reproducing all nine numbers to ~1 sigma; fixed by the provenance-epsilon batch '
            + '(docs/impl-plan-epsilon-discipline.md: Hit.eps + fp-relative analytic offsets + t > 0 floors), and the '
            + 'post-fix sweep read the EXACT values. The tolerances were never loosened along the way — that discipline '
            + 'is what kept the bias visible until it was fixed. Failure reading: all channels low at all angles ⇒ truncation (raise maxBounces) '
            + 'or a per-collision energy loss; one channel off ⇒ a per-channel weight bug; key 2 off while key 1 holds ⇒ '
            + 'the interior termination rule; mu = 1 fine but grazing off ⇒ the angular structure of the exit distribution, '
            + 'which nothing else in the suite can see.',
        witness: {
            spp: 128,
            checks: [
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO.normal, tol: 0.006, strategy: 0,
                    source: { tier: 'exact', from: 'A_p(1) = 1 - sqrt(1-w)H(1), Chandrasekhar via halfspace.ts' },
                    label: 'F-SLAB-A exact plane albedo, mu = 1, roulette off',
                },
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO.normal, tol: 0.006, strategy: 1,
                    source: { tier: 'exact', from: 'A_p(1) = 1 - sqrt(1-w)H(1), Chandrasekhar via halfspace.ts' },
                    label: 'F-SLAB-A exact plane albedo, mu = 1, INTERIOR ROULETTE',
                },
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO.oblique, tol: 0.006, strategy: 2,
                    source: { tier: 'exact', from: 'A_p(0.6) via halfspace.ts' },
                    label: 'F-SLAB-A exact plane albedo, mu = 0.6 (the angular arm)',
                },
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO.grazing, tol: 0.006, strategy: 3,
                    source: { tier: 'exact', from: 'A_p(0.3) via halfspace.ts' },
                    label: 'F-SLAB-A exact plane albedo, mu = 0.3 (the angular arm)',
                },
                {
                    // THE sharp form of the step-2 gate: two estimators of one integrand. chi-squared
                    // is parameter-free, which is what a gate with no prior GPU run needs — both arms
                    // sample the same events (one just stops early), so their measured variances
                    // normalize the comparison without any hand-calibrated threshold.
                    kind: 'equality', strategies: [0, 1], meanTol: 0.02,
                    label: 'interior roulette is unbiased — the 1/p compensation, sharply',
                },
                {
                    kind: 'noise', strategies: [1, 0],
                    label: 'interior roulette vs none — pure here (this scene has no surface events)',
                },
            ],
        },
    },
    'slab-albedo-sparse': {
        scene: slabAlbedoSparseScene,
        strategies: [
            ...posed(SLAB_VIEWS.normal.position, [0, 0, 0], slabRrOffStrategy),
            withPose(slabGrazingStrategy, SLAB_VIEWS.grazing.position, [0, 0, 0]),
        ],
        exercises:
            'F-SLAB-A/sigma — THE SCALE-INVARIANCE ARM, and a measuring instrument as much as a gate. A_p(mu) depends on '
            + 'alpha and mu and NOTHING ELSE: it is scale-invariant in sigma_t, because the only length in the problem is '
            + 'the mean free path and the answer is dimensionless. So this scene is slab-albedo\'s medium at sigma_t = 2 '
            + 'instead of 20 (and ten times BIGGER IN EVERY DIMENSION, so it is the same 80 free paths deep and the same '
            + '~120 free paths of lateral margin) and MUST read the identical numbers. It exists because the first sweep '
            + 'found slab-albedo low by 2.7/1.9/1.1%, traced to the two world-space epsilon mechanisms (J1 ray_spawn '
            + 'normal offset + J2 the t > EPSILON acceptance floor, measured at roughly half each — see the slab-albedo '
            + 'card and docs/fable-epsilon-discipline.md). Here the same 0.001 is worth 0.002 optical depths, so the '
            + 'artifact must shrink tenfold. THE PAIR IS THE MEASUREMENT: the difference between the two scenes\' deficits '
            + 'is the interface-epsilon bias as a function of density, and it stays that after anyone changes the epsilon. '
            + 'RAN Aug 12 2026 and CONFIRMED the mechanism (R/G tenfold smaller on cue); the same sweep caught this '
            + 'fixture\'s own first-version bug — depth scaled x10 but width kept at 12, so blue\'s long walks (~42 '
            + 'scatters) leaked out the SIDES and read +0.019 HIGH. Widths scale with 1/sigma_t too now, and '
            + 'slabAlbedo.test.ts pins the lateral margin in free paths.',
        expected:
            'per-channel mean = the SAME [0.2488, 0.4375, 0.6466] at mu = 1 and [0.3741, 0.5824, 0.7654] at mu = 0.3 as '
            + 'slab-albedo — an albedo that depends on the density it was authored with is wrong, and nothing else in the '
            + 'suite would notice. Predicted residual ~0.0007, an order below tolerance (measured Aug 12: R/G within '
            + '0.001 at both angles). If this arm reads LOW BY THE SAME '
            + 'AMOUNT as slab-albedo, the interface-epsilon diagnosis is wrong and the deficit is a genuine transport error.',
        witness: {
            spp: 128,
            checks: [
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO.normal, tol: 0.003,
                    source: { tier: 'exact', from: 'A_p(1) via halfspace.ts — scale-invariant, so identical to slab-albedo' },
                    label: 'F-SLAB-A/sigma same albedo at 1/10 the density, mu = 1',
                },
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO.grazing, tol: 0.003, strategy: 1,
                    source: { tier: 'exact', from: 'A_p(0.3) via halfspace.ts — scale-invariant' },
                    label: 'F-SLAB-A/sigma same albedo at 1/10 the density, mu = 0.3',
                },
            ],
        },
    },
    'slab-albedo-ref': {
        scene: slabAlbedoRefScene,
        strategies: [
            ...posed(SLAB_VIEWS.normal.position, [0, 0, 0], slabRrOffStrategy, slabRrInteriorStrategy),
            withPose(slabObliqueStrategy, SLAB_VIEWS.oblique.position, [0, 0, 0]),
            withPose(slabGrazingStrategy, SLAB_VIEWS.grazing.position, [0, 0, 0]),
        ],
        exercises:
            'THE CONTROL for slab-albedo: identical geometry, cameras and environment, but an ordinary LAMBERTIAN surface '
            + 'whose albedo IS the target colour. A Lambertian surface under uniform radiance 1 returns exactly its albedo '
            + 'in every direction, with no approximation — so this scene has a known answer that touches no medium code at '
            + 'all, and it is ALSO the control for the angular arms: it must read the SAME number at every viewing angle '
            + 'where the medium must not. It splits any slab-albedo failure in one step: if this reads the target, the '
            + 'instrument (camera, environment, region, accumulation) is sound and the medium scene\'s deviation is real '
            + 'transport error.',
        expected:
            'per-channel mean = [0.3, 0.5, 0.7] EXACTLY on all four arms, to noise, INCLUDING both grazing arms — view '
            + 'independence is the whole point of the control. Any deviation invalidates slab-albedo entirely, since the '
            + 'two scenes differ only in the material.',
        witness: {
            spp: 128,
            checks: [
                {
                    kind: 'mean', value: SLAB_TARGET, tol: 0.004, strategy: 0,
                    source: { tier: 'exact', from: 'a Lambertian surface returns its albedo, exactly, in every direction' },
                    label: 'CONTROL: lambert albedo reads exactly, mu = 1',
                },
                {
                    kind: 'mean', value: SLAB_TARGET, tol: 0.004, strategy: 1,
                    source: { tier: 'exact', from: 'a Lambertian surface returns its albedo, exactly, in every direction' },
                    label: 'CONTROL: lambert albedo reads exactly, roulette on',
                },
                {
                    kind: 'mean', value: SLAB_TARGET, tol: 0.004, strategy: 2,
                    source: { tier: 'exact', from: 'Lambertian reflectance is view-INDEPENDENT' },
                    label: 'CONTROL: lambert is view-independent, mu = 0.6',
                },
                {
                    kind: 'mean', value: SLAB_TARGET, tol: 0.004, strategy: 3,
                    source: { tier: 'exact', from: 'Lambertian reflectance is view-INDEPENDENT' },
                    label: 'CONTROL: lambert is view-independent, mu = 0.3',
                },
            ],
        },
    },
    'slab-albedo-aniso': {
        scene: slabAlbedoAnisoScene,
        strategies: posed(SLAB_VIEWS.normal.position, [0, 0, 0], slabAnisoStrategy),
        exercises:
            'F-SLAB-A/g — the HENYEY-GREENSTEIN PHASE FUNCTION under real multiple scattering, at g = 0.6 and alpha up to '
            + '0.990 (~103 collisions per path, hence the 1024-bounce budget). Anisotropic scattering has NO closed-form '
            + 'halfspace solution, so the expected value comes from an independent CPU random walk (tests/helpers/'
            + 'halfspace.ts, 2M samples) that shares no code with the GLSL — a CROSS-CHECK, reported as such. NOTE what '
            + 'this does NOT gate: the inversion\'s g term (that turning anisotropy holds the colour fixed) is a statement '
            + 'about the HEMISPHERICAL albedo and is false of a directional reading — this slab reads 0.2176 head-on where '
            + 'its isotropic twin reads 0.2488, which is real physics, not an error. That claim is gated on the CPU in '
            + 'tests/authoring/subsurface.test.ts.',
        expected:
            'per-channel mean = [0.2176, 0.4155, 0.6367], the independent walk\'s answer +/- its own 0.0011. A DISAGREE '
            + 'here implicates both implementations, not just the renderer — check the walk against its own gates in '
            + 'halfspace.test.ts before suspecting the GLSL.',
        witness: {
            spp: 128,
            checks: [
                {
                    kind: 'mean', value: SLAB_PLANE_ALBEDO_ANISO, tol: 0.006,
                    source: {
                        tier: 'cross-check',
                        from: 'independent CPU HG random walk, 2M samples (halfspace.ts)',
                        refTol: SLAB_ANISO_REF_TOL,
                    },
                    label: 'F-SLAB-A/g HG transport vs an independent walk',
                },
            ],
        },
    },
    'sss-furnace': {
        scene: sssFurnaceScene,
        strategies: posed([0, 0, 0.9], [0, 0, 0], sssFurnaceRrOffStrategy, sssFurnaceRrInteriorStrategy),
        exercises:
            'F-SSS — the SUBSURFACE furnace (docs/fable-subsurface.md §9): a LOSSLESS translucent sphere '
            + '(smooth dielectric boundary, sigma_a = 0, mildly chromatic sigma_s = 4/5/6, HG g = 0.4) inside the 0.4 furnace. '
            + 'Scattering conserves energy and Fresnel conserves energy, so the object cannot change the equilibrium and '
            + 'must be INVISIBLE — the exact statement, not a comparison. Tests Fresnel energy conservation incl. TIR, the '
            + 'eta^2 radiance compression on BOTH sides of the boundary, and the chromatic channel-MIS medium weights. '
            + 'TWO ARMS: key 1 runs roulette OFF (the usual witness protocol), key 2 runs it ON, and each must hit 0.4 '
            + 'independently — enabling roulette must not disturb the equilibrium. NOTE the arms do NOT gate the interior '
            + 'termination rule, which was this fixture\'s original claim and is provably false: with sigma_a = 0 the event '
            + 'weight is W_c/mean(W), and max >= mean always, so the survival probability clamps to exactly 1 and the rule is '
            + 'a no-op for ANY lossless medium. Exercising it needs absorption, which the furnace construction cannot have — '
            + 'that gate is the slab-albedo test (fable-subsurface §8 Step 3).',
        expected:
            'per-channel mean = EXACTLY 0.4 on BOTH arms, frame-wide AND over the sphere alone (the region check — a frame '
            + 'average can hide a visible object by compensating against the walls). Failure reading: both arms low together '
            + '⇒ bounce starvation, since sigma_a = 0 means a path leaves only by escaping the geometry and TIR can hold it '
            + 'a long time (raise maxBounces before suspecting physics, as grin-furnace-hard documents); channels splitting '
            + '⇒ chromatic weight bug in the medium arm; key 2 off while key 1 holds ⇒ the interior termination rule, most '
            + 'likely the surface roulette, since the interior rule is inert here. The reported sigma/mu comparing the arms '
            + 'is SURFACE roulette on the walls, not this work — do not read it as a verdict on interior termination. '
            + 'Deliberately no equality check between the arms: two independent absolute gates say more, and the arms have '
            + 'different path-length distributions so a chi-squared structure gate would not be justified. VERIFIED Aug 12: '
            + 'both arms 0.4 frame-wide to within 0.0008 after the sigma spread was narrowed to 4/5/6 (see the fixture header '
            + 'for what the wider spread taught us about the chromatic sampler).',
        witness: {
            spp: 128,
            checks: [
                { kind: 'mean', value: 0.4, tol: 0.006, strategy: 0, label: 'F-SSS 0.4/channel, roulette off' },
                { kind: 'mean', value: 0.4, tol: 0.006, strategy: 1, label: 'F-SSS 0.4/channel, interior roulette' },
                {
                    kind: 'mean', value: 0.4, tol: 0.008, strategy: 0,
                    region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
                    label: 'F-SSS sphere is invisible, roulette off',
                },
                {
                    kind: 'mean', value: 0.4, tol: 0.008, strategy: 1,
                    region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
                    label: 'F-SSS sphere is invisible, interior roulette',
                },
                {
                    kind: 'noise', strategies: [1, 0],
                    region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
                    label: 'interior roulette vs none, report-only (lossless: the rule barely fires)',
                },
            ],
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
    'fog-area-ignored': {
        scene: fogAreaIgnored,
        strategies: posed([0, 1, 4], [0, 1, 0], fogAreaIgnoredNeeStrategy, fogAreaIgnoredMisStrategy, fogAreaIgnoredPtStrategy),
        exercises:
            "measurement.scattering 'ignored' — the haze is absorbing-only for EVERY technique: camera segments and shadow rays both attenuate by σ_a alone (one extinction per medium, generateMediumTransmittance)",
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image: a clear, slightly dimmed box, no light shafts. Before Sep 25 2026 nee/mis were ~55% darker than pt under the quad (shadow rays kept σ_s)',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'ignored-scattering nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: 'ignored-scattering nee ≡ pt' },
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
            'TWO-STAGE selection (T3, plan D3; p DERIVED per impl-plan-env-power-selection): image env AND a quad light — u_envSelectProb stage 0 (the power-partition closure over env.intensity/totalWeight and light power), the wrapped lighting_sample_finite CDF, the (1−P) factor in lighting_pdf, and the P factor in the miss-MIS weight. The full §6.1 pdf symmetry across techniques',
        expected:
            'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image (warm lamp pool + cool sky fill); the derived P changes NOISE ONLY, never brightness (sweep env.intensity or an estimator.envSelectWeight override to probe) — brightness drift under a P change is a selection-pdf asymmetry. KNOWN estimator boundary: sun-through-glass is BSDF-only in ALL keys (delta lobes skip NEE, §6.3 blocks shadow rays at glass) — equal noise there across keys is expected, not a bug',
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
    // ── Estimator agreement (Sep 2026): each entry pins a place where two techniques must
    // count exactly the same paths — see scenes/estimatorAgreementWitness.ts. All exact.
    'bounce-budget': {
        scene: bounceBudgetScene,
        strategies: posed([0, 0, 3.5], [0, 0, 0], ...bounceBudgetStrategies),
        exercises:
            'maxBounces means the SAME partial sum Σ_{n≤N} TⁿE under pt, pt-nee and pt-mis: the walk does N + 1 intersections, the last one scoring emission only (NEE and continuation stop at the budget). Keys 1-3: N = 0 (nee, mis, pt); keys 4-6: N = 1',
        expected:
            'N = 1: sphere = ρ·L = 0.4 exactly and sky = 1 on all three keys (a convex body\'s single bounce IS its whole answer). N = 0: sky = 1, sphere = 0 (only directly visible emission)',
        witness: {
            spp: 96,
            checks: [0, 1, 2].flatMap((k) => [
                { kind: 'mean' as const, value: 0, tol: 0.001, strategy: k, region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, label: `N=0 sphere = 0 (key ${k + 1})` },
                { kind: 'mean' as const, value: 1.0, tol: 0.005, strategy: k, region: { x: 0.02, y: 0.88, w: 0.1, h: 0.1 }, label: `N=0 sky = L (key ${k + 1})` },
                { kind: 'mean' as const, value: 0.4, tol: 0.008, strategy: k + 3, region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, label: `N=1 sphere = ρ·L = 0.4 (key ${k + 4})` },
                { kind: 'mean' as const, value: 1.0, tol: 0.005, strategy: k + 3, region: { x: 0.02, y: 0.88, w: 0.1, h: 0.1 }, label: `N=1 sky = L (key ${k + 4})` },
            ]),
        },
    },
    'proc-sky-rotated': {
        scene: procSkyRotatedScene,
        strategies: posed([0, 1.4, 5], [0, 0.9, 0], procSkyNeeStrategy, procSkyMisStrategy),
        exercises:
            'the environment pdf under ROTATION: the equirect chart wraps u into [0, 1) so environment_pdf reads the column the sampler used (the sun sits in the band a −3-rad rotation pushes below u = 0)',
        expected: 'keys 1 (pt-nee) and 2 (pt-mis) converge to the same image — mis brighter around the sun means the MIS pdf is read from the wrong table column',
        witness: {
            spp: 192,
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'rotated env: nee ≡ mis' }],
        },
    },
    'fog-sky': {
        scene: fogSkyScene,
        strategies: posed([0, 0, 3.5], [0, 0, 0], furnaceSkyNeeStrategy, furnaceSkyMisStrategy, furnaceSkyPtStrategy),
        exercises:
            'the far clip is one convention: environment NEE places the sky at MAX_DIST, where a missed BSDF ray finds it, so an ambient medium attenuates both by the same e^{−σ·MAX_DIST}',
        expected: `sky = e^{−1} = 0.3679 and sphere centre = 0.4·e^{−1}·e^{−0.0025} = 0.1468 (σ_a = ${FOG_SKY_SIGMA}) on all three keys`,
        witness: {
            // 384, not furnace-sky's 96: the pt-nee arm (uniform-sphere sky sampling, half the
            // samples below the horizon) has ~1% relative noise over the check region at 96 spp,
            // so the 2% tolerance would be only ~2σ. Measured: +2.2% at 96 spp, +0.5% at 384.
            spp: 384,
            checks: [0, 1, 2].flatMap((k) => [
                { kind: 'mean' as const, value: 0.4 * Math.exp(-FOG_SKY_SIGMA * MAX_DIST) * Math.exp(-2.5 * FOG_SKY_SIGMA), tol: 0.003, strategy: k, region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, label: `sphere = ρ·L·e^{−σ(1000+2.5)} (key ${k + 1})` },
                { kind: 'mean' as const, value: Math.exp(-FOG_SKY_SIGMA * MAX_DIST), tol: 0.002, strategy: k, region: { x: 0.02, y: 0.88, w: 0.1, h: 0.1 }, label: `sky = L·e^{−σ·1000} (key ${k + 1})` },
            ]),
        },
    },
    'rough-sheet': {
        scene: roughSheetScene,
        strategies: posed([0, 1, 4], [0, 1, 0], cornellAreaMisStrategy),
        exercises:
            'an index-matched (η = 1) rough dielectric is the DELTA pass-through: a thin rough sheet in front of cornell-area, seen from its BACK (where both sides are air), must be invisible, never NaN (the microfacet branch\'s pdf is infinite at η = 1). From its front a thin dielectric currently refracts into its own index — an open defect, see the fixture',
        expected: 'identical to cornell-area under pt-mis',
        witness: {
            spp: 192,
            checks: [{ kind: 'twin', other: { scene: 'cornell-area', strategy: 1 }, meanTol: 0.02, label: 'η = 1 rough sheet ≡ no sheet (pt-mis)' }],
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
    // Fixture partners: the constant-emission baked references of the driven-light witness.
    'light-driven-baked': {
        scene: drivenLightBaked,
        strategies: posed([0, 1, 4], [0, 1, 0], drivenLightNeeStrategy),
        exercises: 'constant-emission baked reference of the driven-light witness at θ (default power)',
    },
    'light-driven-baked2': {
        scene: drivenLightBaked2,
        strategies: posed([0, 1, 4], [0, 1, 0], drivenLightNeeStrategy),
        exercises: 'constant-emission baked reference at θ′ (the reshuffled-CDF power)',
    },
    'light-off-baked': {
        scene: drivenLightOffBaked,
        strategies: posed([0, 1, 4], [0, 1, 0], drivenLightNeeStrategy),
        exercises: 'constant-emission baked reference at 0 — the second panel is present but black',
    },
    'light-driven': {
        scene: drivenLightScene,
        strategies: posed([0, 1, 4], [0, 1, 0], drivenLightNeeStrategy, drivenLightMisStrategy),
        exercises:
            'driven-emission-equals-baked at θ (impl-plan-driven-lights §A): a Cornell scene with a CONSTANT ceiling panel + a DRIVEN one (emission = {param: lamp.power}). Covers the light_get_1() accessor, the shared u_lamp_power (hittable Le ≡ sampler radiance), and both CPU-shipped selection arrays. key 1 pt-nee, key 2 pt-mis. Drag lamp.power in the lab — the panel brightens and the CDF re-weights with NO recompile',
        expected: 'converges to the same image as light-driven-baked; nee ≡ mis (the u_light_selpdf symmetry); divergence implicates the emission uniform sharing or the CDF closure',
        witness: {
            spp: 128,
            checks: [
                { kind: 'twin', other: { scene: 'light-driven-baked' }, meanTol: 0.003, rmse: 0.02, label: 'driven-emission ≡ baked @θ' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'driven nee ≡ mis' },
            ],
        },
    },
    'light-driven-theta2': {
        scene: drivenLightScene,
        strategies: posed([0, 1, 4], [0, 1, 0], drivenLightNeeStrategy),
        exercises:
            'driven-emission-equals-baked at θ′: lamp.power SET through the ParameterStore after init to a value that RESHUFFLES the power-selection ranking (the CDF coupling made visible) — covers recompute-on-change of the u_light_cdf/u_light_selpdf closures + the emission re-upload',
        expected: 'converges to light-driven-baked2 (visibly brighter side panel than `light-driven`); divergence implicates the multi-path CDF recompute',
        witness: {
            spp: 128,
            checks: [{ kind: 'twin', other: { scene: 'light-driven-baked2' }, meanTol: 0.003, rmse: 0.02, label: 'driven-emission ≡ baked @θ′ (post-set)' }],
        },
        initialParameters: { ...LIGHT_THETA2 },
    },
    'light-off': {
        scene: drivenLightScene,
        strategies: posed([0, 1, 4], [0, 1, 0], drivenLightNeeStrategy),
        exercises:
            'the dead driven light: lamp.power SET to 0 — the second panel ships zero CDF mass (never meaningfully selected, no shader guard) yet remains as present-but-black geometry',
        expected: 'converges to light-off-baked (only the constant panel lights the scene); the black panel costs nothing but occlusion',
        witness: {
            spp: 128,
            checks: [{ kind: 'twin', other: { scene: 'light-off-baked' }, meanTol: 0.003, rmse: 0.02, label: 'driven @0 ≡ constant-black panel' }],
        },
        initialParameters: { ...LIGHT_OFF },
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
    sun: {
        scene: sunScene,
        strategies: posed([0, 3, 1.5], [0, 0, -0.5], sunNeeStrategy),
        exercises:
            'F-SUN: the directional kind — the delta-direction class\'s first occupant (impl-plan-directional-beam). E is authored ⊥ to the propagation direction (B2\'s irradiance rung) and the BSDF supplies the cosine; distance is MAX_DIST (the far clip, as for the environment) through the shadow walker; the sphere\'s HARD PARALLEL shadow is the class signature',
        expected:
            'open floor reads L = ρ·E·cosθ/π = 0.5·0.8/π ≈ 0.1273 in linear HDR (0.1592 ⇒ the obliquity cosine went missing; ~0 ⇒ a distance-fold leaked in); the clay sphere upper-right casts a razor-edged parallel shadow toward +x — no penumbra at ANY distance (delta direction)',
        witness: {
            spp: 48,
            checks: [{
                kind: 'mean', value: 0.12732, tol: 0.003,
                region: { x: 0.4, y: 0.55, w: 0.15, h: 0.15 },   // clean floor: center-left, below the sphere
                label: 'F-SUN ρ·E·cosθ/π = 0.4/π',
            }],
        },
    },
    'beam-wall': {
        scene: beamWallScene,
        strategies: posed([0, 0, 1.2], [0, 0, 0], beamNeeStrategy),
        exercises:
            'F-BEAM: the beam kind (collimated finite-aperture — the honest laser; impl-plan-directional-beam). Pure-evaluation sampling: cylinder test, wi = −direction, NOTHING folded into radiance; outside the cylinder pdf = 0 (the techniques\' invalid-sample guard)',
        expected:
            'inside the spot (disk r = 0.5 at the wall) L = ρ·E/π = 1/π ≈ 0.3183 in linear HDR, no falloff anywhere in the disk; outside the forward cylinder the wall is EXACTLY black (delta light, no env, no chance hits)',
        witness: {
            spp: 48,
            checks: [
                {
                    kind: 'mean', value: 0.31831, tol: 0.004,
                    region: { x: 0.47, y: 0.47, w: 0.06, h: 0.06 },
                    label: 'F-BEAM spot ρ·E/π',
                },
                {
                    kind: 'mean', value: 0.0, tol: 0.002,
                    region: { x: 0.02, y: 0.02, w: 0.08, h: 0.08 },
                    label: 'F-BEAM outside-cylinder = 0 exactly',
                },
            ],
        },
    },
    'beam-slab': {
        scene: beamSlabScene,
        strategies: posed([0, 0, 1.2], [0, 0, 0], beamNeeStrategy),
        exercises:
            'F-BEAM-T: beam transmittance is the WALKER\'s job (radiance carries E verbatim; shadow_media crosses the ink\'s null interfaces). Collimation makes every shadow path exactly the slab thickness — the F-SLAB triple with zero scattering confound',
        expected:
            'spot center = ρ·E·e^{−σ_a·0.2}/π per channel = (0.11711, 0.04308, 0.00583) in linear HDR; the UNSCALED (0.3183·…) triple ⇒ the shadow walker skipped the medium; the SQUARED triple ⇒ double attenuation',
        witness: {
            spp: 48,
            checks: [{
                kind: 'mean', value: [0.117109, 0.043081, 0.005831], tol: [0.0015, 0.0008, 0.0004],
                region: { x: 0.47, y: 0.47, w: 0.06, h: 0.06 },
                label: 'F-BEAM-T walker-supplied e^{−σ_a·D}',
            }],
        },
    },
    'softbeam-wall': {
        scene: softbeamWallScene,
        strategies: posed([0, 0, 1.2], [0, 0, 0], softbeamNeeStrategy, softbeamMisStrategy),
        exercises:
            'F-SOFTBEAM: the finite-divergence beam (fable-emitter-profiles v0) — the HITTABLE laser. Cone-gated radiance over the disk light\'s geometric pdf (gate on radiance ONLY — a gated pdf would poison MIS); the hit-side emission dispatch arm shares the same step(cosδ, axis·ω) literals (one profile truth). nee ≡ mis is load-bearing: mis adds real BSDF-side aperture hits through the gate',
        expected:
            'spot CORE (r < 0.4) = ρ·Le·sin²δ = 0.9992 in linear HDR — the near-field plateau, independent of r and d; a PENUMBRA annulus 0.4 → 0.6 (the soft edge the delta beam cannot make); EXACTLY black outside 0.6; keys 1 (pt-nee) and 2 (pt-mis) converge to the same image',
        witness: {
            // The core check is NOISE-bound: NEE samples the whole aperture (r = 0.5) but only
            // the sub-disk inside the cone (radius d·tanδ ≈ 0.1) contributes — 4% of samples, a
            // per-sample relative sd of ≈ 4.9. The original 80-pixel crop at 96 spp had a 7%
            // standard error against a 1.2% tolerance, and its pinned-salt draw read +3.3%
            // (Sep 25: six salts gave 0.9985 ± 0.030, i.e. no bias). The crop is now a square of
            // half-side 0.25 on the wall (corner radius 0.354 < the core's 0.3999), 3600 px, at
            // 384 spp: 0.9989 ± 0.0028 over three salts, so the tolerance is ~4σ.
            spp: 384,
            checks: [
                {
                    kind: 'mean', value: 0.99917, tol: 0.012,
                    region: { x: 0.315, y: 0.2535, w: 0.37, h: 0.493 },
                    label: 'F-SOFTBEAM core ρ·Le·sin²δ',
                },
                {
                    kind: 'mean', value: 0.0, tol: 0.002,
                    region: { x: 0.02, y: 0.9, w: 0.08, h: 0.08 },
                    label: 'F-SOFTBEAM outside-cone = 0 exactly',
                },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'F-SOFTBEAM nee ≡ mis (hittable + cone gate)' },
            ],
        },
    },
    'tiny-sphere': {
        scene: tinySphereScene,
        strategies: posed([0, 0, 0], [0, 0, -1], tinySphereStrategy),
        exercises: 'sphere_intersect precision: an emissive sphere of radius 0.01 at distance 40 (r/D = 2.5e-4, an instance-cloud sphere seen from across the cloud) through a narrow pinhole — the perpendicular-offset discriminant (Ray Tracing Gems ch. 7) vs the old b² − c, which subtracted two numbers of size 1600 to find one of size 1e-4',
        expected: 'a clean 10-px disk; frame mean = disk area / frame area',
        witness: {
            spp: 256,
            size: TINY_SIZE,
            checks: [
                { kind: 'mean', value: TINY_SPHERE_MEAN, tol: 0.0015, label: 'tiny sphere covers π·ρ² pixels' },
            ],
        },
    },
    'tiny-sphere-light': {
        scene: tinySphereLightScene,
        strategies: posed(TINY_LIGHT_CAMERA.position, TINY_LIGHT_CAMERA.target, tinySphereLightStrategy),
        exercises: 'sphere-light sampling precision: r/d = 1e-4, where the old f32 1 − sqrt(1 − sin²α) rounded to 0, the 1e-8 floor took over and the light read exactly twice its value; now sin²α/(1 + cosα), the w(2 − w) polar-angle sample, and the robust near-root distance',
        expected: 'wall radiance ρ·Le·r²/d²·(1 + x²/d²)^(−3/2) ≈ 0.5 in the crop',
        witness: {
            spp: 64,
            size: TINY_SIZE,
            checks: [
                { kind: 'mean', value: TINY_LIGHT_MEAN, tol: 0.005, region: TINY_LIGHT_REGION, label: 'tiny sphere light ρ·Le·sin²α' },
            ],
        },
    },
    'sun-haze': {
        scene: sunHazeScene,
        strategies: posed(SUN_HAZE_CAMERA.position, SUN_HAZE_CAMERA.target, sunHazeStrategy),
        exercises: 'the sun at the far clip: a directional light through an absorbing ambient medium is attenuated over MAX_DIST, the declared truncation the environment already uses (before Sep 25 its 1e20 distance extinguished it completely)',
        expected: 'a flat wall at (ρ/π)·E·e^{−σ_a·(MAX_DIST − backoff)}·e^{−σ_a·1} ≈ 0.1838',
        witness: {
            spp: 16,
            size: TINY_SIZE,
            checks: [
                { kind: 'mean', value: SUN_HAZE_CENTER, tol: 0.002, region: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, label: 'sun through haze to the far clip' },
            ],
        },
    },
    'beam-fog': {
        scene: beamFogScene,
        strategies: posed([0, 0.2, 3.5], [0, 0, 0], beamFogNeeStrategy, beamFogMisStrategy),
        exercises:
            'X-BEAM: THE visible-beam shot — medium-vertex NEE lights eye-ray vertices landing inside the beam cylinder (no new machinery); pt-nee (key 1) ≡ pt-mis (key 2) gates the MIS bookkeeping over the delta-direction kind (weight 1 by LIGHT_DELTA). v1 noise ceiling declared (plan P7): vertex placement ignores beam proximity — the beam-segment technique is the deferred fix',
        expected:
            'a horizontal shaft crossing the fog cube, brightest near the entry face (beam transmittance decays left→right), terminating in a wall spot at x = 2.2; keys 1 and 2 converge to the SAME image; black surround (delta light invisible to chance hits). Calibrated mean tripwire lands at the owner\'s sweep',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'X-BEAM nee ≡ mis over the delta-direction kind' },
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
                // Calibrated Jul 19 2026 (first sweep): measured 13.15% @spec spp, ×4-spp probe
                // fell to 6.61% (ratio 0.50 = 1/√4 — PURE VARIANCE, Δmean 0.07%): the
                // delta-tracking arm's per-pixel noise dominates an analytic twin; the
                // pre-calibration 8% guess assumed same-noise arms. Gate = measured ×1.5.
                { kind: 'twin', other: { scene: 'het-const-ref' }, meanTol: 0.015, rmse: 0.20, label: 'F-HET-CONST delta ≡ analytic (nee)' },
                // Calibrated Jul 19: measured 60.05% @spec, 29.36% @×4 (0.49 — variance; Δmean 0.36%).
                { kind: 'twin', other: { scene: 'het-const-ref', strategy: 1 }, strategy: 1, meanTol: 0.03, rmse: 0.9, label: 'F-HET-CONST delta ≡ analytic (pt tripwire)' },
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
                // Calibrated Jul 19: measured 10.26% @spec, 5.11% @×4 (0.50 — variance; Δmean 0.02%).
                { kind: 'twin', other: { scene: 'clamp-ref' }, meanTol: 0.01, rmse: 0.16, label: 'F-CLAMP clamped ≡ authored-1.0' },
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
            // Calibrated Jul 19: measured 17.84% @spec, 9.04% @×4 (0.51 — variance; Δmean 0.02%).
            checks: [{ kind: 'twin', other: { scene: 'het-driven-baked' }, meanTol: 0.015, rmse: 0.27, label: 'HET-DRIVEN ≡ baked @gain 1' }],
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
            // Calibrated Jul 19: measured 19.93% @spec, 10.06% @×4 (0.50 — variance; Δmean 0.05%).
            checks: [{ kind: 'twin', other: { scene: 'het-driven-baked2' }, meanTol: 0.015, rmse: 0.30, label: 'HET-DRIVEN ≡ baked @gain 2 (post-set)' }],
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
    'emit-driven': {
        scene: emitDrivenScene,
        strategies: posed([30, 1, 0], [31, 1, 0], emitSatStrategy),
        exercises:
            'EMIT-DRIVEN (impl-plan-env-power-selection batch 2): F-EMIT-SAT with a DRIVEN σ_a slid ABOVE its authored default (0.5 → 2.0, live σ_t = 3 > the default-point 1.5) — gates the DERIVED u_majorant compute closure: σ̄ must follow the slider, or the delta arm\'s null coefficient goes negative',
        expected:
            'EVERY pixel = (0.5, 1.0, 2.0) in linear HDR — the SAME equilibrium number as emit-sat. A wrecked/dark image here with emit-sat green implicates a stale majorant (σ̄ < live σ_t)',
        witness: {
            spp: 96,
            checks: [{ kind: 'mean', value: [0.5, 1.0, 2.0], tol: [0.005, 0.01, 0.02], label: 'EMIT-DRIVEN ε/σ_a @slid σ̄' }],
        },
        initialParameters: { 'glow.absorb': 2.0 },
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
    'emit-sat-budget': {
        scene: emitSatBudgetScene,
        strategies: posed([30, 1, 0], [31, 1, 0], ...EMIT_SAT_BUDGETS.map((n) => emitSatBudgetStrategy(n))),
        exercises: 'the bounce budget INSIDE a medium: the emit-sat fog at maxBounces 0, 1, 2 (keys 1–3) against the exact truncated Neumann sums — an off-by-one in the medium branch\'s budget reads a neighbouring N',
        expected: 'every pixel = (ε/σ_t)·Σ_{n≤N} (1/3)ⁿ with ε = (1, 2, 4), σ_t = 3: N = 0 → (0.3333, 0.6667, 1.3333), N = 1 → (0.4444, 0.8889, 1.7778), N = 2 → (0.4815, 0.9630, 1.9259)',
        witness: {
            spp: 96,
            // Tolerance 1% of each channel. Measured at salts 11/22/33 (channel means): N = 0 reads
            // exactly 0.77778 (no noise: the first collision is certain), N = 1 1.0372 ± 0.0004
            // (exact 1.0370), N = 2 1.1236 ± 0.0004 (exact 1.1235). A budget off by one reads 25%
            // (N = 1) or 7.7% (N = 2) low.
            checks: EMIT_SAT_BUDGETS.map((n, k) => ({
                kind: 'mean' as const, value: emitSatBudgetValue(n), tol: emitSatBudgetValue(n).map((v) => 0.01 * v) as [number, number, number], strategy: k,
                source: { tier: 'exact' as const, from: '(ε/σ_t)·Σ_{n≤N} αⁿ, α = σ_s/σ_t' },
                label: `medium budget, maxBounces ${n}`,
            })),
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
    'shadow-medium': {
        scene: shadowMediumScene,
        strategies: posed([0, 1, 4], [0, 1, 0], shadowMediumNeeStrategy, shadowMediumPtStrategy),
        exercises:
            'NEE shadow ray crossing a bounded ABSORBING fog-box boundary to reach a ceiling quad — the regression gate for the shadow_transmittance light-POINT fix (the pre-fix drift blocked the shadow ray on the light\'s own surface, blacking out NEE through any bounded medium)',
        expected:
            'keys 1 (pt-nee) and 2 (pt) converge to the same image. The MEAN is the discriminator: the pre-fix bug drove pt-nee ~orders dark, so Δmean explodes; here 0.81% @192spp. The pt arm is chance-hit (finds the quad by random bounce), so its DISPLAY-space RMSE is high (~47%) like every pt tripwire — a loose structural tripwire, not the gate.',
        witness: {
            spp: 192,
            // Δmean is the real gate (a shadow regression blacks NEE out → huge Δmean). The
            // rmse is a loose chance-hit-pt tripwire (measured ~47% display-space, sibling of
            // cornell-area 40% / fog-area 65%) — NOT a tight equality (pt fireflies per pixel).
            checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.65, label: 'shadow-through-medium nee ≡ pt' }],
        },
    },
    'null-budget-view': {
        scene: nullBudgetViewScene,
        strategies: posed(NULL_VIEW_POSE.position, NULL_VIEW_POSE.target, ...nullViewStrategies),
        exercises: `measurement.maxNullCrossings on the camera path: a quad light seen through ${SLABS} absorbing null-walled slabs (${2 * SLABS} crossings per ray), maxBounces 0 — keys 1/2/3 = default budget / exactly ${2 * SLABS} / ${2 * SLABS - 1}`,
        expected: `keys 1 and 2: every pixel Le·e^(−${SLABS}·σ_a·d) = ${NULL_VIEW_THROUGH.toFixed(4)}; key 3: black (the ${2 * SLABS}th crossing is past the budget, so the path is not in the measurement)`,
        witness: {
            spp: 16,
            // Deterministic: every ray crosses the same slabs perpendicularly and scores only
            // the light's emission, so the tolerance is fp only.
            checks: [
                { kind: 'mean', value: NULL_VIEW_THROUGH, tol: 0.002, strategy: 0, label: 'default budget: the light through the stack' },
                { kind: 'mean', value: NULL_VIEW_THROUGH, tol: 0.002, strategy: 1, label: `budget ${2 * SLABS}: the light through the stack` },
                { kind: 'mean', value: 0, tol: 1e-6, strategy: 2, label: `budget ${2 * SLABS - 1}: the path is cut` },
            ],
        },
    },
    'null-budget': {
        scene: nullBudgetScene,
        strategies: posed(NULL_BUDGET_POSE.position, NULL_BUDGET_POSE.target, ...nullBudgetStrategies),
        exercises: `measurement.maxNullCrossings shared by a path and its shadow rays: a floor lit through ${SLABS} absorbing null-walled slabs (${2 * SLABS} crossings to the light), its right half under a null-walled carpet (one more crossing each way) — keys 1/2/3 = nee/mis/pt at the default budget, keys 4/5/6 = the same at ${2 * SLABS + 1}, where the direct light through the stack is cut under the carpet only`,
        expected: 'at each budget nee, mis and pt converge to the same image; at the smaller budget the carpet half loses its direct light under every estimator',
        witness: {
            spp: 192,
            // Δmean against pt is the gate: a shadow ray with a budget of its own would keep the
            // carpet half lit under nee (carpet-half mean 0.044) where pt cuts it (0.024); measured
            // nee/pt carpet halves 0.0445/0.0440 (default) and 0.0248/0.0244 (budget 11). The rmse
            // is pt's chance-hit noise in a dim frame, measured 64.5% (default) and 74.4% (budget
            // 11) at 192 spp; each tripwire is 1.5× its measurement (the README rule) — a
            // structural tripwire only (a black arm reads ≥ 200% by the statistic's definition).
            // nee ≡ mis is nearly identical-stream here (the small light gives the BSDF side
            // little weight).
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'default budget: nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.97, label: 'default budget: pt tripwire' },
                { kind: 'equality', strategies: [3, 4], meanTol: 0.02, label: `budget ${2 * SLABS + 1}: nee ≡ mis` },
                { kind: 'equality', strategies: [3, 5], meanTol: 0.03, rmse: 1.12, label: `budget ${2 * SLABS + 1}: pt tripwire` },
            ],
        },
    },
    // Shadow rays end at the light point they were aimed at (shadowAimWitness.ts has the geometry
    // and the derivation). pt uses no shadow ray: it is the control for each scene's exact value.
    // Tolerances from the spread over three salts (11, 22, 33) at 160×120 × 256 spp, measured
    // before the fix: pt-nee sd ≈ 0.0037 in every scene (tol 0.015); pt-mis sd ≈ 0.00013 and pt
    // sd ≈ 0.00005 (tol 0.005). pt reads slightly high because its BSDF rays see the disk from the
    // moved origin, height h − ε: 4/(4 + (0.25 − ε)²) = 0.98474 at ε = 10⁻³ and 0.98498 at
    // ε = 3·10⁻³, both as measured (0.98474, 0.98498); in the fog scene pt reads 0.95106.
    // Before the fix pt-nee read 0.828 / 0.474 / 0.599 and pt-mis 0.876 / 0.863 / 0.839
    // (march / far / fog, three-salt means).
    'shadow-aim-march': {
        scene: shadowAimMarch,
        strategies: posed([0, AIM_CAMERA_Y, 0], [0, 0, 0], ...shadowAimStrategies),
        exercises: 'the NEE shadow ray from a MARCHED receiver (spawn margin 10⁻³) to an authored disk light: the ray must be aimed at the sampled light point, or the light\'s own surface blocks it at grazing angles',
        expected: `keys 1/2/3 (pt-nee, pt-mis, pt) all read ρ·Le·R²/(R²+h²) = ${AIM_OPEN.toFixed(5)}`,
        witness: {
            spp: 256,
            checks: [
                { kind: 'mean', value: AIM_OPEN, tol: 0.015, strategy: 0, source: { tier: 'exact', from: 'ρ·Le·R²/(R²+h²), coaxial disk view factor' }, label: 'marched floor, pt-nee' },
                { kind: 'mean', value: AIM_OPEN, tol: 0.005, strategy: 1, source: { tier: 'exact', from: 'ρ·Le·R²/(R²+h²), coaxial disk view factor' }, label: 'marched floor, pt-mis' },
                { kind: 'mean', value: AIM_OPEN, tol: 0.005, strategy: 2, source: { tier: 'exact', from: 'ρ·Le·R²/(R²+h²), coaxial disk view factor' }, label: 'marched floor, pt (control)' },
            ],
        },
    },
    'shadow-aim-far': {
        scene: shadowAimFar,
        strategies: posed([AIM_FAR_X, AIM_CAMERA_Y, 0], [AIM_FAR_X, 0, 0], ...shadowAimStrategies),
        exercises: 'the NEE shadow ray from an analytic receiver 100 units from the origin (fp-relative spawn margin ≈ 3·10⁻³) to an emissive disk object',
        expected: `keys 1/2/3 (pt-nee, pt-mis, pt) all read ${AIM_OPEN.toFixed(5)}`,
        witness: {
            spp: 256,
            checks: [
                { kind: 'mean', value: AIM_OPEN, tol: 0.015, strategy: 0, source: { tier: 'exact', from: 'ρ·Le·R²/(R²+h²), coaxial disk view factor' }, label: 'floor at x = 100, pt-nee' },
                { kind: 'mean', value: AIM_OPEN, tol: 0.005, strategy: 1, source: { tier: 'exact', from: 'ρ·Le·R²/(R²+h²), coaxial disk view factor' }, label: 'floor at x = 100, pt-mis' },
                { kind: 'mean', value: AIM_OPEN, tol: 0.005, strategy: 2, source: { tier: 'exact', from: 'ρ·Le·R²/(R²+h²), coaxial disk view factor' }, label: 'floor at x = 100, pt (control)' },
            ],
        },
    },
    'shadow-aim-fog': {
        scene: shadowAimFog,
        strategies: posed([0, AIM_FOG_CAMERA_Y, 0], [0, 0, 0], ...shadowAimStrategies),
        exercises: 'the media shadow walker across two MARCHED null interfaces (a thin absorbing slab between the floor and a disk light): after each crossing the re-spawned ray must be aimed at the light point again',
        expected: `keys 1/2/3 (pt-nee, pt-mis, pt) all read 2ρ·Le·∫u·e^{−τ/u}du = ${AIM_FOG.toFixed(5)}`,
        witness: {
            spp: 256,
            checks: [
                { kind: 'mean', value: AIM_FOG, tol: 0.015, strategy: 0, source: { tier: 'exact', from: '2ρ·Le·∫_{u₀}^1 u·e^{−τ/u} du (Simpson)' }, label: 'fog slab, pt-nee' },
                { kind: 'mean', value: AIM_FOG, tol: 0.005, strategy: 1, source: { tier: 'exact', from: '2ρ·Le·∫_{u₀}^1 u·e^{−τ/u} du (Simpson)' }, label: 'fog slab, pt-mis' },
                { kind: 'mean', value: AIM_FOG, tol: 0.005, strategy: 2, source: { tier: 'exact', from: '2ρ·Le·∫_{u₀}^1 u·e^{−τ/u} du (Simpson)' }, label: 'fog slab, pt (control)' },
            ],
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
    // ── Rough dielectric (fable-rough-dielectric §5) ────────────────────────────
    // All four gates are PRE-CALIBRATION estimates until the owner's first sweep
    // (impl-plan-rough-dielectric T4); the energy numbers are RECORDED there, since
    // the whole point of W-ENERGY is that the curve is measured, not predicted.
    'rough-smooth-limit': {
        scene: roughSmoothLimit,
        strategies: posed([0, 1, 0.05], [0, -1, 0], roughSmoothLimitStrategy),
        exercises:
            'the α → 0 trend gate: the rough dielectric at roughness 0.02 on the F-ETA geometry — the '
            + 'microfacet TRANSMISSION lobe (Walter Eq. 21 + the η² factor) reaching the same number the '
            + 'delta branch does. A twin of the `eta` witness, not an exact one: the α floor makes true '
            + 'smoothness unreachable and single-scattering costs a G1 factor',
        expected:
            'center pixel ≈ 0.5540 (F-ETA) — the η² factor is the same one the smooth model carries, so '
            + '0.98 here means it was dropped in the transmission weight; a large deficit instead '
            + 'implicates G1/the Jacobian',
        witness: {
            spp: 128,
            checks: [
                {
                    kind: 'mean', value: 0.554, tol: 0.02,
                    region: { x: 0.47, y: 0.47, w: 0.06, h: 0.06 },
                    label: 'smooth limit ≈ F-ETA 0.5540',
                },
                {
                    kind: 'twin', other: { scene: 'eta' }, meanTol: 0.03, rmse: 0.15,
                    label: 'rough(0.02) ≈ smooth dielectric (TREND gate)',
                },
            ],
        },
    },
    'rough-mis': {
        scene: roughMis,
        strategies: posed([1.4, 1.5, 1.9], [0, 0.8, 0], roughMisNeeStrategy, roughMisMisStrategy, roughMisPtStrategy),
        exercises:
            'the X-GLASS pattern on a TWO-LOBE non-delta BSDF: NEE now runs at a glass surface (the first '
            + 'model where material_has_nondelta_lobes is true AND transmission is true), so the F-weighted '
            + 'lobe split in interaction_surface_pdf, the two-sided eval, and the stored-query replay all '
            + 'have to agree for the arms to converge',
        expected:
            'keys 1 (nee) and 2 (mis) converge to the same image; key 3 (pt) too, noisier. Divergence '
            + 'implicates the pdf/sample agreement (§11.3 covers it on the twin) or the MIS weights',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.03, label: 'rough-glass nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 0.4, label: 'rough-glass pt tripwire' },
            ],
        },
    },
    'glass-inclusion': {
        scene: glassInclusion,
        strategies: posed([2.2, 1.6, 2.6], [0, 1.0, 0],
            inclusionNeePowerStrategy, inclusionNeeBvhStrategy, inclusionMisBvhStrategy, inclusionPtStrategy),
        exercises:
            'THE two-sided-query gate (fable-rough-dielectric §3): a glowing core INSIDE rough glass is the '
            + 'one configuration where far-side NEE survives the opaque-dielectrics truncation — its shadow '
            + 'ray never leaves the glass. The core lies entirely below the tangent plane of every outer '
            + 'surface point, so a one-sided light query culls it (pmf 0) and nee-only loses its direct term '
            + 'outright. Key 1 (power: no cull anywhere) is the reference; key 2 (bvh) must match it, and '
            + 'key 3 (mis × bvh) must replay the same stored two-sided context in the pmf',
        expected:
            'keys 1, 2 and 3 converge to the same image (key 4 = pt, noisier). A DARK core under key 2 with '
            + 'key 1 correct is the horizon cull firing at a sphere-support receiver — the exact bias the '
            + 'capability split exists to prevent',
        witness: {
            spp: 256,
            checks: [
                // Same integrand, shared event coverage ⇒ χ² is valid on both pairs.
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'inclusion nee: power ≡ bvh (THE cull gate)' },
                { kind: 'equality', strategies: [1, 2], meanTol: 0.02, label: 'inclusion bvh: nee ≡ mis (trail replay)' },
                // CALIBRATED by the first sweep (Aug 11): Δmean 0.09% — the arms agree in
                // energy to a tenth of a percent — but display-space rmse measured 136%.
                // That is the chance-hit pt arm doing what it does in a caustic scene: a
                // 40-emission core behind glossy glass is found by rare, huge-contribution
                // paths, so per-pixel spread is enormous while the mean is dead on. The
                // tripwire's job is to catch STRUCTURAL divergence, so it sits above the
                // measured floor with headroom (cf. veach's 1.2, fog-area's 0.65).
                { kind: 'equality', strategies: [0, 3], meanTol: 0.04, rmse: 1.8, label: 'inclusion pt tripwire' },
            ],
        },
    },
    // ── Instanced dielectrics (impl-plan-instanced-containment) ─────────────────
    // Each is a cross-scene twin against the individually-authored geometry. The gate is
    // unusually sharp: before containment an instanced glass object had NO interior, so
    // ior_of fell to 1.0 and the batch refracted at η = 1 — a regression is visible on
    // the first bounce wherever the glass is on screen, not a subtle bias.
    'instance-glass': {
        scene: instanceGlass,
        strategies: posed([0.4, 1.6, 4.2], [0, 0.7, 0], instanceGlassStrategy, instanceGlassLinearStrategy, instanceGlassLowRRStrategy),
        exercises:
            'instanced DIELECTRICS, params tier: a batch of glass spheres claims an interior through the '
            + 'TLAS point descent in scene_region_at (the record IS the folded world shape, so the field is '
            + 'evaluated at p with no conjugation). Key 2 swaps instanceAccel to \'linear\', whose containment '
            + 'is a linear scan instead of a descent — the two walks must agree. Key 3 drops the RR survival '
            + 'CEILING to 0.5: clear glass never dims throughput, so that ceiling is the only thing ending these '
            + 'paths (~1 further bounce instead of ~20) — the converged image must be IDENTICAL, which is what '
            + 'makes "unbiased" checkable rather than asserted',
        expected:
            'identical to instance-glass-ref (the same three spheres authored individually), and key 2 '
            + 'identical to key 1. A batch that renders as clear air with a Fresnel sheen is the η = 1 '
            + 'regression — the interior was lost',
        witness: {
            spp: 192,
            checks: [
                { kind: 'twin', other: { scene: 'instance-glass-ref' }, meanTol: 0.02, rmse: 0.12, label: 'instanced glass ≡ individual glass' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.05, label: 'containment: TLAS descent ≡ linear scan' },
                // Δmean is THE gate here (bias); the arms differ ~20× in path length, so
                // their noise differs by design and χ² normalizes by measured variance.
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, label: 'RR ceiling 0.95 ≡ 0.5 (unbiased termination)' },
                { kind: 'noise', strategies: [0, 2], label: 'σ at equal spp: the price of the shorter paths' },
            ],
        },
    },
    'instance-glass-ref': {
        scene: instanceGlassRef,
        strategies: posed([0.4, 1.6, 4.2], [0, 0.7, 0], instanceGlassStrategy),
        exercises: 'the instanced-glass twin\'s reference arm: the same spheres as individual analytic objects, each with its own region',
    },
    'instance-glass-mesh': {
        scene: instanceGlassMesh,
        strategies: posed([0.4, 1.6, 4.2], [0, 0.7, 0], instanceGlassStrategy),
        exercises:
            'instanced dielectrics, MESH prototype (frame tier): a closed glass cube instanced under rotation '
            + '+ scale. Containment is the lazy three-tier query — the prototype\'s baked local box, then '
            + 'first-hit-facing along the fixed LOCAL direction, then closest-triangle only when inside — run '
            + 'per instance in its own conjugated frame, with the ÷s / ×s discipline the unscaled BLAS needs. '
            + 'The `closed: true` prototype was a hard Validator error until this batch',
        expected: 'identical to instance-glass-mesh-ref (the same cubes placed individually)',
        witness: {
            spp: 192,
            checks: [{ kind: 'twin', other: { scene: 'instance-glass-mesh-ref' }, meanTol: 0.02, rmse: 0.12, label: 'instanced glass mesh ≡ individual glass meshes' }],
        },
    },
    'instance-glass-mesh-ref': {
        scene: instanceGlassMeshRef,
        strategies: posed([0.4, 1.6, 4.2], [0, 0.7, 0], instanceGlassStrategy),
        exercises: 'the instanced-glass-mesh twin\'s reference arm: the same closed cubes as individual mesh objects',
    },
    'instance-fog': {
        scene: instanceFog,
        strategies: posed([0.4, 1.6, 4.2], [0, 0.7, 0], instanceGlassStrategy),
        exercises:
            'the instanced interior as a MEDIUM region: a null-interface batch holding absorbing fog. '
            + 'Containment here feeds current_medium rather than ior_of, so it proves the batch is a region in '
            + 'the TRANSPORT sense — paths enter and leave instanced volumes and accumulate the right optical '
            + 'depth — not merely a refraction-time lookup',
        expected: 'identical to instance-fog-ref; per-instance absorption depth is the discriminator',
        witness: {
            spp: 192,
            checks: [{ kind: 'twin', other: { scene: 'instance-fog-ref' }, meanTol: 0.02, rmse: 0.12, label: 'instanced fog ≡ individual fog spheres' }],
        },
    },
    'instance-fog-ref': {
        scene: instanceFogRef,
        strategies: posed([0.4, 1.6, 4.2], [0, 0.7, 0], instanceGlassStrategy),
        exercises: 'the instanced-fog twin\'s reference arm: the same fog spheres as individual objects',
    },
    // The gate's justification as a number: the SAME 300-sphere batch, glass (containment
    // arm emitted — a TLAS point descent on every classification probe) vs opaque (no arm
    // at all). Read across the two rows; report-only, real GPU.
    'perf-instance-glass': {
        scene: perfInstanceGlass,
        strategies: perfInstanceLadder,
        exercises:
            'THE BOUNCE LADDER on 300 instanced glass spheres (faintly absorbing, ior 1.5): keys 1/2/3 = '
            + '12/24/48 bounces. maxBounces is the only knob that can make the picture WRONG — it truncates '
            + 'paths uncompensated, so its error is one-directional (too dark) and never converges away, and '
            + 'roulette does not reduce it (killed paths are paid forward into the survivors). A cluster needs '
            + 'two interfaces per sphere CROSSED, so the budget a single solid wants is badly wrong here — which '
            + 'is why this is a ladder to READ rather than a number to trust. Also the perf row: containment is '
            + 'live, so every hit classification descends the batch TLAS as a point query',
        expected:
            'keys 2 and 3 agree ⇒ 24 bounces suffice and 48 is insurance; if key 3 is visibly brighter than key 2 '
            + 'the budget is still truncating. FIRST READING (equal-spp linear HDR, Aug 11): 12 → 24 gains 3.87%, '
            + '24 → 48 gains 0.76% — so 12 truncates visibly, 24 is nearly converged, and the ladder FLATTENS, which '
            + 'is the absorption doing its job (perfectly clear glass would keep climbing instead). '
            + 'Under --perf, ms/frame per rung + the glass-vs-opaque comparison',
        witness: {
            spp: 8,
            checks: [
                { kind: 'perf', strategy: 0, size: [512, 512], frames: 24, warmup: 8, label: 'glass cluster @12 bounces ms/frame @512²' },
                { kind: 'perf', strategy: 1, size: [512, 512], frames: 24, warmup: 8, label: 'glass cluster @24 bounces ms/frame @512²' },
                { kind: 'perf', strategy: 2, size: [512, 512], frames: 24, warmup: 8, label: 'glass cluster @48 bounces ms/frame @512²' },
            ],
        },
    },
    'perf-instance-opaque': {
        scene: perfInstanceOpaque,
        strategies: [perfInstanceStrategy],
        exercises: 'perf baseline: the identical batch with an OPAQUE prototype material — batchNeedsInterior is false, so no containment arm exists at all',
        expected:
            'report-only ms/frame under --perf. Read honestly: the gap against perf-instance-glass is a GLASS batch '
            + 'vs an opaque one — containment probes AND far longer paths — not the cost of containment alone, which '
            + 'no pair can isolate (containment is derived from the material). What it does bound is what gating buys '
            + 'every opaque cloud: this row emits no containment arm at all',
        witness: {
            spp: 8,
            checks: [{ kind: 'perf', size: [512, 512], frames: 24, warmup: 8, label: 'instanced opaque (containment OFF) ms/frame @512²' }],
        },
    },
    'region-overlap': {
        scene: regionOverlap,
        strategies: posed([0, 1.75, 1.55], [0, 1.4, -1.2], regionOverlapUnrolledStrategy, regionOverlapTableStrategy),
        exercises:
            'THE CONTAINMENT DESCENT under table dispatch — the regime bvhPointWalkLines serves, which had no '
            + 'witness at all. That skeleton read the node layout wrong (never visited left subtrees) and survived '
            + 'for months, and the reason is sharper than "the tabled scenes were opaque": for DISJOINT solids '
            + 'containment is barely load-bearing — entering a sphere the classifier probes only OUTSIDE it, and '
            + 'leaving it a solid owner covers its own side with no probe, so a stranded leaf changes no answer. '
            + 'The descent decides something only where a point is INSIDE a region. Hence twelve heavily '
            + 'OVERLAPPING absorbing balls in three strongly different hues: every point sits inside several at '
            + 'once, innermost-wins has a real decision everywhere, and a stranded leaf lands a segment in the '
            + 'wrong medium — which reads as the wrong COLOUR, not a subtle shift',
        expected:
            'keys 1 (unrolled) and 2 (table) are the same image — a bias-free estimator swap. CALIBRATED against '
            + 'the real defect (Aug 11): with the old child indexing restored this pair diverges 49.2% in frame '
            + 'mean; with it fixed, 0.07%. The gate sits far below the former and far above the latter',
        witness: {
            spp: 192,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, rmse: 0.08, label: 'table ≡ unrolled through overlapping regions (containment descent)' },
            ],
        },
    },
    'rough-grin': {
        scene: roughGrin,
        strategies: posed([0, 1.2, 3.2], [0, 1, 0], roughGrinStrategy),
        exercises:
            'rough × GRIN: a constant-FORMULA medium ior on a ROUGH wall — entry Fresnel through '
            + 'ior_of(region, p), the Verlet walker, the inside-exit handoff, exit Fresnel/TIR, the interior '
            + 'L/n² factor — against the same model reading a region-table constant. The claim under test is '
            + 'that the microfacet lobes do not care where the index came from (they read the SAME seam the '
            + 'smooth model does); previously this combination was untested, not known-good',
        expected: 'identical to rough-grin-ref — any lens-shaped difference implicates the handoff/guard/factor, not the BSDF',
        witness: {
            spp: 192,
            checks: [{
                kind: 'twin', other: { scene: 'rough-grin-ref' }, meanTol: 0.02, rmse: 0.35,
                label: 'rough × GRIN ≡ rough × region-table ior',
            }],
        },
    },
    // Fixture partner: the plain-ior half of the rough-grin twin.
    'rough-grin-ref': {
        scene: roughGrinRef,
        strategies: posed([0, 1.2, 3.2], [0, 1, 0], roughGrinStrategy),
        exercises: 'the rough-grin twin\'s reference arm: the same rough dielectric reading a region-table ior constant (no ODE code emitted)',
    },
    'rough-furnace': {
        scene: roughFurnace,
        strategies: posed([0, 0, 4.2], [0, 0, 0], roughFurnaceStrategy),
        exercises:
            'W-ENERGY: three frosted spheres (roughness 0.05 / 0.2 / 0.5) in a uniform radiance field. An '
            + 'energy-preserving BSDF is INVISIBLE in a furnace, so each sphere\'s deficit below 1.0 IS its '
            + 'single-scattering energy loss — the measurement that makes §6\'s declared truncation checkable '
            + '(and the trigger condition for Turquin-style compensation)',
        expected:
            'background exactly 1.0; the three spheres read progressively darker with roughness. The curve is '
            + 'RECORDED, not predicted — the sphere tolerances here are wide pre-calibration brackets',
        witness: {
            spp: 256,
            checks: [
                // The one EXACT number: the furnace itself. If the background is not 1.0,
                // nothing else on this card means anything.
                { kind: 'mean', value: 1.0, tol: 0.01, region: { x: 0.02, y: 0.85, w: 0.1, h: 0.1 }, label: 'furnace background = 1.0' },
                { kind: 'mean', value: 0.98, tol: 0.06, region: { x: 0.18, y: 0.46, w: 0.06, h: 0.08 }, label: 'roughness 0.05 throughput' },
                { kind: 'mean', value: 0.94, tol: 0.1, region: { x: 0.47, y: 0.46, w: 0.06, h: 0.08 }, label: 'roughness 0.2 throughput' },
                { kind: 'mean', value: 0.85, tol: 0.15, region: { x: 0.76, y: 0.46, w: 0.06, h: 0.08 }, label: 'roughness 0.5 throughput' },
            ],
        },
    },
};
