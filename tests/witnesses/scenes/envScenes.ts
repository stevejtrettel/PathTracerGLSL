// tests/witnesses/scenes/envScenes.ts
// Environment-as-light scenes (impl-plan-env-as-light):
//   sky — T2 witness: an `image` environment (equirect HDRI via extern:env_map) as the miss
//         radiance. BSDF-only transport (the env is not samplable until T3), so the sky lights
//         the scene exclusively through pt paths — exactly the old reference behavior, now
//         through the compiler + the §2.10 extern chain.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const skyScene: SceneDescription = {
    id: 'sky',
    name: 'HDRI Sky (image environment)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'ground',
        },
        {
            type: 'sphere', parameters: { center: [0, 1, 0], radius: 1 },
            material: 'clay',
        },
        {
            type: 'sphere', parameters: { center: [2.2, 0.7, -0.5], radius: 0.7 },
            material: 'glass',
        },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.4, 0.4, 0.4] },
        clay: { model: 'lambert', albedo: [0.7, 0.45, 0.3] },
        glass: { model: 'dielectric', ior: 1.5 },
    },
    lights: [],
    environment: {
        type: 'image',
        url: '/hdri/table_mountain_2_puresky_1k.hdr',
        intensity: 1.0,
        rotation: 0.0,
    },
};

export const skyPtStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.5 } },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// T3: the env is samplable (image default) — pt-nee and pt-mis join as the X-ENV pair.
// Env-only scene → the selection is the env with probability 1 (no two-stage wrapper).
export const skyNeeStrategy: RenderStrategy = {
    ...skyPtStrategy,
    id: 'pt-nee',
    estimator: { ...skyPtStrategy.estimator, directLighting: 'nee' },
};

export const skyMisStrategy: RenderStrategy = {
    ...skyPtStrategy,
    id: 'pt-mis',
    estimator: { ...skyPtStrategy.estimator, directLighting: 'mis' },
};

// ---------------------------------------------------------------------------
// furnace-sky — W1/W2 (impl-plan-env-as-light §3): the OPEN furnace. A CONVEX Lambertian
// body under uniform sky L never re-illuminates itself (every outward ray escapes), so its
// exit radiance is the SINGLE-bounce value ρ·L exactly — sphere/sky pixel ratio = ρ = 0.4,
// scale-free, for ALL three strategies. (§11.1's L/(1−ρ) is the CLOSED-furnace identity —
// it needs the multiply-scattered field of an enclosure and does NOT apply here.)
// The pt key doubles as W2: under directLighting 'none' the miss branch has no
// bookkeeping, which is exactly the sampleAsLight-irrelevance statement.
// RR OFF — the identity is exact, don't perturb it.
// ---------------------------------------------------------------------------

export const furnaceSkyScene: SceneDescription = {
    id: 'furnace-sky',
    name: 'Open Furnace (constant samplable env)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 },
            material: 'gray',
        },
    ],
    materials: {
        gray: { model: 'lambert', albedo: [0.4, 0.4, 0.4] },
    },
    lights: [],
    environment: { type: 'constant', color: [1, 1, 1], intensity: 1.0, sampleAsLight: true },
};

export const furnaceSkyNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
        maxBounces: 32,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'none' } },   // §11 on-screen radiance check: sky pixels read 1.0 exactly
};

export const furnaceSkyMisStrategy: RenderStrategy = {
    ...furnaceSkyNeeStrategy,
    id: 'pt-mis',
    estimator: { ...furnaceSkyNeeStrategy.estimator, directLighting: 'mis' },
};

export const furnaceSkyPtStrategy: RenderStrategy = {
    ...furnaceSkyNeeStrategy,
    id: 'pt',
    estimator: { ...furnaceSkyNeeStrategy.estimator, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// sky-lamp — the TWO-STAGE selection witness: image env AND a quad light in one scene.
// Exercises u_envSelectProb (stage 0), lighting_sample_finite (the wrapped baked CDF),
// the (1 − u_envSelectProb) factor in lighting_pdf, and the miss-MIS selection factor —
// the full §6.1 pdf symmetry across both techniques and both estimator pairs.
// ---------------------------------------------------------------------------

export const skyLampScene: SceneDescription = {
    ...skyScene,
    id: 'sky-lamp',
    name: 'HDRI Sky + Quad Lamp (two-stage selection)',
    lights: [
        {
            kind: 'quad',
            corner: [-1.6, 2.5, -1.0],
            edge1: [0.8, 0.0, 0.0],
            edge2: [0.0, 0.0, 0.8],
            emission: [40, 34, 24],
        },
    ],
};

export const skyLampNeeStrategy: RenderStrategy = {
    ...skyPtStrategy,
    id: 'pt-nee',
    estimator: { ...skyPtStrategy.estimator, directLighting: 'nee' },
};

export const skyLampMisStrategy: RenderStrategy = {
    ...skyPtStrategy,
    id: 'pt-mis',
    estimator: { ...skyPtStrategy.estimator, directLighting: 'mis' },
};

export const skyLampPtStrategy: RenderStrategy = {
    ...skyPtStrategy,
    id: 'pt',
};

// ---------------------------------------------------------------------------
// proc-sky — T4: a PROCEDURAL environment (gradient sky + analytic sun disk) baked to a
// 512×256 CDF table at load, direct-eval'd at lookup. The sun disk (~2° across, radiance 18)
// spans only a few table texels — exactly the case importance sampling exists for: pt-nee
// finds it through the CDF, pt only by rare BSDF luck. 3-way convergence exercises the
// formula↔CDF consistency the same way X-ENV did for images.
// ---------------------------------------------------------------------------

export const procSkyScene: SceneDescription = {
    ...skyScene,
    id: 'proc-sky',
    name: 'Procedural Sky (baked CDF)',
    environment: {
        type: 'procedural',
        glsl: {
            kind: 'glsl',
            source:
                'mix(vec3(0.06, 0.08, 0.12), vec3(0.35, 0.45, 0.65), 0.5 * (dir.y + 1.0))'
                + ' + vec3(18.0, 16.0, 13.0) * smoothstep(0.9994, 0.9999, dot(dir, normalize(vec3(0.4, 0.35, 0.2))))',
        },
        intensity: 1.0,
        rotation: 0.0,
    },
};

export const procSkyNeeStrategy: RenderStrategy = { ...skyNeeStrategy };
export const procSkyMisStrategy: RenderStrategy = { ...skyMisStrategy };
export const procSkyPtStrategy: RenderStrategy = { ...skyPtStrategy };

// ---------------------------------------------------------------------------
// T5 strategy-axis keys (plan D11):
//   X-CHART (W8) — pt-mis under the OCTAHEDRAL chart on the sky scene. The radiance
//   integrand is bit-identical to the equirect key (radiance never touches the sampler
//   chart), so convergence to the same image is a controlled experiment on the chart alone.
//   W9 — pt-mis with a COMPENSATED table on proc-sky. Same converged image (MIS covers the
//   deliberately-zeroed dim regions); the payoff is measured VARIANCE at fixed render time.
// ---------------------------------------------------------------------------

export const skyMisOctStrategy: RenderStrategy = {
    ...skyMisStrategy,
    id: 'pt-mis-oct',
    estimator: { ...skyMisStrategy.estimator, envSampler: 'octahedral' },
};

export const procSkyMisCompStrategy: RenderStrategy = {
    ...procSkyMisStrategy,
    id: 'pt-mis-comp',
    estimator: { ...procSkyMisStrategy.estimator, envCompensation: true },
};
