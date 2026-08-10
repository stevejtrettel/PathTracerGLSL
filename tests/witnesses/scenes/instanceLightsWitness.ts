// tests/witnesses/scenes/instanceLightsWitness.ts — stage-2 instance lights
// (fable-light-bvh §7): per-instance light identity for instanced emitter batches.
//
// TWIN PAIR: `instance-lights` authors 64 emissive spheres as ONE instanced batch
// (params tier — the placement record IS the sphere-light row; light identity =
// (batch region, Hit.element)); `instance-lights-ref` authors the SAME spheres as 64
// individual objects (the sampleAsLight route → 64 registry lights). Same positions,
// same folded radii (center = placement position, r = 0.12·s — both sides compute the
// identical doubles, both f32-round at pack). Under lightSelection 'bvh' the two
// scenes must converge to the SAME image; the batch's mis arm additionally gates the
// ELEMENT-indexed trail pmf (a chance-hit instance's MIS weight replays its own
// leaf's trail).
//
// GLOW-SHELL: the §3.2 near-field regime — the camera sits INSIDE a shell of 100
// instanced emitters around a diffuse ball. nee-bvh ≡ mis-bvh is the equality gate
// (shared event coverage → χ²); the power arm rides as a σ/µ REPORT (path-found under
// 'power' — different coverage, so no χ² and no assert until calibrated).

import type { SceneDescription, RenderStrategy, Transform } from '../../../src/compiler/types.js';

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

// ---- the twin pair ---------------------------------------------------------

const rand = lcg(97);
const lampPlacements: Transform[] = [];
for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
        lampPlacements.push({
            position: [
                -6 + (12 * i) / 7 + (rand() - 0.5) * 0.5,
                0.9 + rand() * 0.5,
                -6 + (12 * j) / 7 + (rand() - 0.5) * 0.5,
            ],
            scale: 0.7 + rand() * 0.9,
        });
    }
}

const twinMaterials = (): SceneDescription['materials'] => ({
    floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
    lamp: { model: 'lambert', albedo: [0, 0, 0], emission: [18, 15, 10] },
});

export const instanceLightsTwin: SceneDescription = {
    id: 'instance-lights',
    name: 'Instance Lights (batch = 64 lights)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
        {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.12 }, material: 'lamp' },
            placements: lampPlacements,
            name: 'lamps',
        },
    ],
    materials: twinMaterials(),
    lights: [],
    environment: { type: 'none' },
};

export const instanceLightsRef: SceneDescription = {
    id: 'instance-lights-ref',
    name: 'Instance Lights (64 individual objects)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
        ...lampPlacements.map((t, i) => ({
            type: 'sphere',
            parameters: { center: t.position as [number, number, number], radius: 0.12 * (t.scale as number) },
            material: 'lamp',
            name: `lamp_${i}`,
        })),
    ],
    materials: twinMaterials(),
    lights: [],
    environment: { type: 'none' },
};

const twinMeasurement = { camera: { type: 'pinhole' as const, fov: 0.9 }, maxBounces: 4 };
const view = { tonemap: { type: 'reinhard' as const } };

export const instanceLightsNeeStrategy: RenderStrategy = {
    id: 'nee-bvh',
    measurement: twinMeasurement,
    estimator: { directLighting: 'nee', lightSelection: 'bvh', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

export const instanceLightsMisStrategy: RenderStrategy = {
    id: 'mis-bvh',
    measurement: twinMeasurement,
    estimator: { directLighting: 'mis', lightSelection: 'bvh', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

// The ref scene's 64 sphere OBJECTS ride the scene table (the stage-1 storage regime).
export const instanceLightsRefStrategy: RenderStrategy = {
    id: 'nee-bvh',
    measurement: twinMeasurement,
    estimator: { directLighting: 'nee', lightSelection: 'bvh', objectDispatch: 'table', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

// ---- glow-shell (the near-field regime) ------------------------------------

const SHELL = 100;
const srand = lcg(4242);
const shellPlacements: Transform[] = [];
for (let i = 0; i < SHELL; i++) {
    // Deterministic quasi-uniform shell points (golden-angle spiral + jitter).
    const t = (i + 0.5) / SHELL;
    const phi = Math.acos(1 - 2 * t);
    const theta = i * 2.399963229728653 + srand() * 0.05;
    const r = 3.2;
    shellPlacements.push({
        position: [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)],
        scale: 0.8 + srand() * 0.6,
    });
}

export const glowShell: SceneDescription = {
    id: 'glow-shell',
    name: 'Glow Shell (camera inside the cloud)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1.0 }, material: 'ball' },
        {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.1 }, material: 'glow' },
            placements: shellPlacements,
            name: 'shell',
        },
    ],
    materials: {
        ball: { model: 'lambert', albedo: [0.65, 0.6, 0.55] },
        glow: { model: 'lambert', albedo: [0, 0, 0], emission: [10, 8, 6] },
    },
    lights: [],
    environment: { type: 'none' },
};

const shellMeasurement = { camera: { type: 'pinhole' as const, fov: 1.0 }, maxBounces: 4 };

export const glowShellNeeStrategy: RenderStrategy = {
    id: 'nee-bvh',
    measurement: shellMeasurement,
    estimator: { directLighting: 'nee', lightSelection: 'bvh', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

export const glowShellMisStrategy: RenderStrategy = {
    id: 'mis-bvh',
    measurement: shellMeasurement,
    estimator: { directLighting: 'mis', lightSelection: 'bvh', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

// Path-found comparison arm: plain pt — batch emitters found by chance bounces only
// (exactly what this scene renders under any non-bvh selection, since without the
// tree it has NO samplable lights and NEE is structurally absent). Different event
// coverage, so this arm is a σ/µ REPORT, never a χ² gate.
export const glowShellPtStrategy: RenderStrategy = {
    id: 'pt',
    measurement: shellMeasurement,
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};
