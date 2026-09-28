import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';

export const dispersionSlab: SceneDescription = {
    id: 'spectral-dispersion-slab', name: 'Dispersive slab — two transmissions',
    ambientSpace: { type: 'euclidean' },
    materials: {
        glass: { model: 'dielectric', ior: { cauchy: [1.5, 0.01] }, transmittance: 1 },
        lamp: { model: 'lambert', albedo: 0, emission: 1 },
    },
    objects: [
        { type: 'box', parameters: { halfSize: [100, 100, 0.5] }, material: 'glass' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2 }, material: 'lamp' },
    ], lights: [],
};
export const dispersionStrategy: RenderStrategy = {
    id: 'spectral', measurement: { color: 'spectral', maxBounces: 2,
        camera: { type: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], scale: 0.5 } },
    estimator: { directLighting: 'none', wavelengths: 'visible', russianRoulette: null,
        accumulation: { type: 'average' } }, view: { tonemap: { type: 'none' } },
};

// A tall triangular prism in x/z, extruded in y; opposite winding on the end caps.
const prism: SceneDescription = {
    id: 'spectral-dispersion-prism', name: 'Cauchy prism — spectral / RGB',
    ambientSpace: { type: 'euclidean' },
    materials: {
        glass: { model: 'dielectric', ior: { cauchy: [1.45, 0.02] } },
        lamp: { model: 'lambert', albedo: 0, emission: 3 },
        surround: { model: 'lambert', albedo: 0.1 },
    },
    objects: [
        { kind: 'mesh', closed: true, material: 'glass',
            positions: new Float32Array([-1,-1,-0.7, 1,-1,-0.7, 0,-1,0.9, -1,1,-0.7, 1,1,-0.7, 0,1,0.9]),
            indices: new Uint32Array([0,1,2, 3,5,4, 0,3,4, 0,4,1, 1,4,5, 1,5,2, 2,5,3, 2,3,0]) },
        { type: 'box', parameters: { center: [0, 0, -3], halfSize: [0.15, 3, 0.03] }, material: 'lamp' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.1 }, material: 'surround' },
    ], lights: [], environment: { type: 'constant', color: 0.015 },
};
const prismStrategies: RenderStrategy[] = (['spectral', 'rgb'] as const).map(color => ({
    ...dispersionStrategy, id: color,
    measurement: { ...dispersionStrategy.measurement, color, maxBounces: 12,
        camera: { type: 'pinhole', position: [0, 0.3, 5], target: [0, 0, 0], fov: 38 * Math.PI / 180 } },
    estimator: { ...dispersionStrategy.estimator, wavelengths: color === 'spectral' ? 'visible' : undefined },
    view: { tonemap: { type: 'aces' } },
}));

// The finite-cone aperture is hittable through glass. Straight shadow connections
// cannot sample the caustic; it converges through wall → glass → aperture paths.
const prismBeam: SceneDescription = {
    id: 'spectral-dispersion-beam', name: 'Prism beam — rainbow on a screen',
    ambientSpace: { type: 'euclidean' },
    materials: {
        glass: { model: 'dielectric', ior: { cauchy: [1.4, 0.04] } },
        screen: { model: 'lambert', albedo: 0.8 },
        floor: { model: 'lambert', albedo: [0.3, 0.32, 0.35] },
        housing: { model: 'lambert', albedo: 0.12 },
    },
    objects: [
        prism.objects[0]!,
        { type: 'box', parameters: { center: [2.5, 0.4, -0.65], halfSize: [0.05, 1.5, 1.1] }, material: 'screen' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.1 }, material: 'floor' },
        { type: 'box', parameters: { center: [-2, 0, -0.735], halfSize: [0.1, 0.15, 0.15] }, material: 'housing' },
    ],
    lights: [{ kind: 'softbeam', position: [-1.8, 0, -0.65],
        direction: [Math.cos(0.4), 0, Math.sin(0.4)], radius: 0.1, divergence: 0.06, emission: 1000 }],
    environment: { type: 'constant', color: 0.2, sampleAsLight: true },
};
const prismBeamStrategies: RenderStrategy[] = prismStrategies.map(strategy => ({
    ...strategy,
    measurement: { ...strategy.measurement,
        camera: { type: 'pinhole', position: [-3.8, 3.4, 5], target: [0.4, -0.1, -0.3], fov: 43 * Math.PI / 180 } },
    estimator: { ...strategy.estimator, directLighting: 'mis' },
}));
export const spectralDispersionSuite: Record<string, SceneSuiteEntry> = {
    [dispersionSlab.id]: {
        scene: dispersionSlab, strategies: [dispersionStrategy],
        exercises: 'Two normal transmissions through n(lambda); a second collapse would quadruple the answer',
        // Independent 0.25 nm integration of (1-F(lambda))² times normalized D65.
        witness: { size: [48, 48], spp: 1024, checks: [{ kind: 'mean',
            value: [0.9157439775502264, 0.9132305300063444, 0.908891337430429], tol: 0.012,
            source: { tier: 'exact', from: 'Normal two-transmission slab quadrature in scripts/witness-dispersion.ts' },
        }] },
    },
    [prism.id]: { scene: prism, strategies: prismStrategies,
        exercises: 'Original Cauchy index in a closed mesh; chromatic displacement of a white stripe' },
    [prismBeam.id]: { scene: prismBeam, strategies: prismBeamStrategies,
        exercises: 'Finite-cone white source refracted through a prism onto a diffuse screen; slowly converging caustic' },
};
