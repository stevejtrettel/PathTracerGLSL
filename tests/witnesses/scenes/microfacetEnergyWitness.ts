// tests/witnesses/scenes/microfacetEnergyWitness.ts
// Energy compensation of the microfacet models (measurement.microfacet 'energy-compensated',
// components/materials/microfacet_energy) in the open furnace: a constant sky L = 1, samplable
// as a light, and nothing else.
//
// ms-furnace: white rough conductors (ggx, f0 = 1) and clear rough glass. Compensated, each
// interface loses no energy, so every path that leaves to the sky carries 1 and every pixel,
// sphere or sky, reads 1 (up to the table's error, ≤ 0.6% per interface event, and the
// 64-bounce truncation, which cuts a negligible tail: rough glass at these indices lets a
// large fraction escape at each interior hit). Uncompensated, the same spheres read as low as
// 0.31. The spheres sit at roughness 0.3 / 0.6 / 1, where the gain reaches ~3: pt sees only
// sample weights; pt-nee scores the sky through eval; pt-mis mixes both. With eval's gain
// removed (checked once by hand), pt-nee reads 0.36 on the roughness-1 conductor and 0.47 on
// the roughness-1 glass, and pt-mis 0.72 and 0.95. Glass at ior 1.33, 1.5 and 2.0 reads three
// positions of the table's index axis.
// Tolerances, from the measured noise at 512 spp (σ of the region mean ≈ σ_pixel/21):
// 0.01 is ≥ 3.5σ for pt, pt-mis and spectral pt-mis on every sphere. pt-nee samples the sky
// uniformly against a peaked lobe, so it is checked only where its job lies (the eval gain, at
// roughness ≥ 0.6, where a missing gain reads ≤ 0.83) with tolerance 0.05 (≥ 4σ). Glass at
// ior 2.4 and roughness 1 is not used: its internal paths multiply sample weights above 1
// (the gain), and the heavy-tailed result read 2% low at 1024 spp.
//
// ms-furnace-control: one white conductor at roughness 1, alone (convex: one bounce, nothing
// to occlude it). Uncompensated, a pixel reads the single-scattering albedo E(μ, α = 1), which
// is 1 − ln 2 = 0.30685 at μ = 1 and ≤ 0.3078 over the center region (μ ≥ 0.994). This shows
// the furnace can see the loss the gain removes.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessCheck, WitnessRegion } from '../types.js';

const SKY: SceneDescription['environment'] = { type: 'constant', color: [1, 1, 1], intensity: 1.0, sampleAsLight: true };

// Orthographic film at scale 2: x ∈ ±2.667, y ∈ ±2 in world units for the 160×120 frame.
const SCALE = 2;
const HALF_W = SCALE * 160 / 120;
const RADIUS = 0.55;
const COLUMNS = [-1.95, -0.65, 0.65, 1.95];
const ROWS = [0.9, -0.9];

const SPHERES: Array<{ name: string; material: Record<string, unknown> }> = [
    { name: 'metal03', material: { model: 'ggx', f0: 1, roughness: 0.3 } },
    { name: 'metal06', material: { model: 'ggx', f0: 1, roughness: 0.6 } },
    { name: 'metal10', material: { model: 'ggx', f0: 1, roughness: 1 } },
    { name: 'glass20', material: { model: 'rough_dielectric', ior: 2.0, roughness: 0.6 } },
    { name: 'glass03', material: { model: 'rough_dielectric', ior: 1.5, roughness: 0.3 } },
    { name: 'glass06', material: { model: 'rough_dielectric', ior: 1.5, roughness: 0.6 } },
    { name: 'glass10', material: { model: 'rough_dielectric', ior: 1.5, roughness: 1 } },
    { name: 'glass133', material: { model: 'rough_dielectric', ior: 1.33, roughness: 1 } },
];
const centerOf = (i: number): [number, number, number] => [COLUMNS[i % 4], ROWS[Math.floor(i / 4)], 0];

export const msFurnaceScene: SceneDescription = {
    id: 'ms-furnace',
    name: 'Energy-compensated microfacets in the furnace',
    ambientSpace: { type: 'euclidean' },
    objects: SPHERES.map((s, i) => ({
        type: 'sphere', name: s.name, parameters: { center: centerOf(i), radius: RADIUS }, material: s.name,
    })),
    materials: Object.fromEntries(SPHERES.map((s) => [s.name, s.material])) as SceneDescription['materials'],
    lights: [],
    environment: SKY,
};

/** A square inside sphere i's image, half-side 0.65 R (camera cosines from 1 down to 0.53). */
function sphereRegion(i: number): WitnessRegion {
    const [x, y] = centerOf(i);
    const half = 0.65 * RADIUS;
    return { x: (x - half + HALF_W) / (2 * HALF_W), y: (y - half + SCALE) / (2 * SCALE), w: half / HALF_W, h: half / SCALE };
}
/** Sky between the two rows of spheres. */
const BETWEEN_ROWS: WitnessRegion = { x: 0.3, y: 0.47, w: 0.4, h: 0.06 };

function furnaceStrategy(id: string, directLighting: 'none' | 'nee' | 'mis', color: 'rgb' | 'spectral', microfacet: 'single-scattering' | 'energy-compensated'): RenderStrategy {
    return {
        id,
        measurement: {
            camera: { type: 'orthographic', scale: SCALE, position: [0, 0, 6], target: [0, 0, 0] },
            // Generous: a truncated path would read as lost energy (bound in the header).
            maxBounces: 64,
            color,
            microfacet,
        },
        estimator: {
            directLighting,
            ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}),
            russianRoulette: null,
            accumulation: { type: 'average' },
        },
        view: { tonemap: { type: 'none' } },
    };
}

const msFurnaceStrategies = [
    furnaceStrategy('pt', 'none', 'rgb', 'energy-compensated'),
    furnaceStrategy('pt-nee', 'nee', 'rgb', 'energy-compensated'),
    furnaceStrategy('pt-mis', 'mis', 'rgb', 'energy-compensated'),
    furnaceStrategy('spectral-mis', 'mis', 'spectral', 'energy-compensated'),
];
const KEYS = ['pt', 'pt-nee', 'pt-mis', 'spectral pt-mis'];

export const msFurnaceControlScene: SceneDescription = {
    id: 'ms-furnace-control',
    name: 'One rough white conductor in the furnace',
    ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'metal' }],
    materials: { metal: { model: 'ggx', f0: 1, roughness: 1 } },
    lights: [],
    environment: SKY,
};
const CONTROL_SCALE = 1.2;
const controlStrategy = (id: string, microfacet: 'single-scattering' | 'energy-compensated'): RenderStrategy => {
    const s = furnaceStrategy(id, 'none', 'rgb', microfacet);
    return { ...s, measurement: { ...s.measurement, camera: { type: 'orthographic', scale: CONTROL_SCALE, position: [0, 0, 4], target: [0, 0, 0] } } };
};
/** Pixels whose centers lie within 0.1 R of the sphere's center (half-side 0.07 R). */
const CONTROL_CENTER: WitnessRegion = {
    x: 0.5 - 0.07 / (2 * CONTROL_SCALE * 160 / 120), y: 0.5 - 0.07 / (2 * CONTROL_SCALE),
    w: 0.07 / (CONTROL_SCALE * 160 / 120), h: 0.07 / CONTROL_SCALE,
};

/** A square inside the sphere's image, half-side 0.65 R (camera cosines from 1 down to 0.53). */
const CONTROL_DISK: WitnessRegion = {
    x: 0.5 - 0.65 / (2 * CONTROL_SCALE * 160 / 120), y: 0.5 - 0.65 / (2 * CONTROL_SCALE),
    w: 0.65 / (CONTROL_SCALE * 160 / 120), h: 0.65 / CONTROL_SCALE,
};

export const microfacetEnergySuite: Record<string, SceneSuiteEntry> = {
    'ms-furnace': {
        scene: msFurnaceScene,
        strategies: msFurnaceStrategies,
        exercises:
            'microfacet energy compensation on both models (ggx conductor gain, rough_dielectric gain on both lobes and both '
            + 'sides of the interface), through sample weights (pt), eval (pt-nee) and both (pt-mis, RGB and spectral): the '
            + 'table lookup in GLSL at three roughnesses and three indices',
        expected:
            'every sphere and the sky read 1.0 on all four keys (top row: conductors at roughness 0.3 / 0.6 / 1 and glass '
            + 'ior 2.4 at 1; bottom row: glass ior 1.5 at 0.3 / 0.6 / 1 and ior 1.33 at 1)',
        witness: {
            spp: 512,
            checks: msFurnaceStrategies.flatMap((strategy, key): WitnessCheck[] => [
                ...SPHERES.flatMap((s, i): WitnessCheck[] => {
                    const nee = strategy.estimator.directLighting === 'nee';
                    if (nee && (s.material.roughness as number) < 0.6) return [];
                    return [{
                        kind: 'mean', value: 1.0, tol: nee ? 0.05 : 0.01, strategy: key, region: sphereRegion(i),
                        label: `${s.name} = 1 (${KEYS[key]})`,
                    }];
                }),
                { kind: 'mean', value: 1.0, tol: 0.005, strategy: key, region: BETWEEN_ROWS, label: `sky = 1 (${KEYS[key]})` },
            ]),
        },
    },
    'ms-furnace-control': {
        scene: msFurnaceControlScene,
        strategies: [controlStrategy('single-scattering', 'single-scattering'), controlStrategy('energy-compensated', 'energy-compensated')],
        exercises: 'the single-scattering loss the compensation removes, on a convex white conductor at roughness 1 (one bounce)',
        expected: 'key 1: the center reads E(1, α = 1) = 1 − ln 2 = 0.3069; key 2: the whole sphere reads 1',
        witness: {
            spp: 1024,
            checks: [
                {
                    kind: 'mean', value: 1 - Math.LN2, tol: 0.005, strategy: 0, region: CONTROL_CENTER,
                    source: { tier: 'exact', from: 'E(μ=1, α=1) = 1 − ln 2 (over the region μ ≥ 0.994, E ≤ 0.3078)' },
                    label: 'single scattering: center = 1 − ln 2',
                },
                { kind: 'mean', value: 1.0, tol: 0.01, strategy: 1, region: CONTROL_DISK, label: 'compensated: sphere = 1' },
            ],
        },
    },
};
