// Witnesses for the Gaussian reflectance kind and a blackbody beam (docs/claude-spectral-showcase-plan.md).
//
// spectral-gaussian-plane: a Lambert plane with a Gaussian band under a unit white sky. In a
// spectral program the sky is D65, so the one-bounce pixel is ∫ sensor · g · D65, which is the
// band's RGB stand-in (the stand-in's white normalization differs from 1 by ~1e-7). An RGB
// program renders the stand-in itself. The expected value comes from gaussianStandIn, which
// tests/components/gaussian.test.ts checks against an independent 0.25 nm quadrature of the
// shipped curves (agreement 1e-6); this fixture cannot read that file, since it also runs in
// the browser gallery.
//
// spectral-blackbody-softbeam: a 5800 K blackbody softbeam lighting a plane; NEE and MIS must
// agree (the softbeam kind with blackbody emission, which no other witness covers).

import type { SceneDescription, RenderStrategy, GaussianValue } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { gaussianStandIn } from '../../../src/components/color/spectra/gaussian/gaussian.js';

const band: GaussianValue = { gaussian: { center: 610, width: 25, peak: 0.85, floor: 0.04 } };
const standIn = gaussianStandIn(band);

function strategy(color: 'rgb' | 'spectral', directLighting: 'none' | 'nee' | 'mis', maxBounces: number): RenderStrategy {
    return {
        id: `${color}-${directLighting}`,
        measurement: { color, camera: { type: 'pinhole', fov: 0.8, position: [0, 0, 0], target: [0, 0, -1] }, maxBounces },
        estimator: { ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}), directLighting, russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'none' } },
    };
}

const plane: SceneDescription = {
    id: 'spectral-gaussian-plane', name: 'Gaussian band under a white sky', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0, 0, 1], offset: 1 }, material: 'plane' }],
    materials: { plane: { model: 'lambert', albedo: band } }, lights: [],
    environment: { type: 'constant', color: 1, sampleAsLight: true },
};
const planeStrategies = [strategy('spectral', 'none', 1), strategy('spectral', 'mis', 1), strategy('rgb', 'mis', 1)];

const beam: SceneDescription = {
    id: 'spectral-blackbody-softbeam', name: 'Blackbody softbeam on a plane', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0, 0, 1], offset: 1 }, material: 'plane' }],
    materials: { plane: { model: 'lambert', albedo: 0.8 } },
    lights: [{ kind: 'softbeam', position: [0, 0, 1], direction: [0, 0.2, -1], radius: 0.3, divergence: 0.3,
        emission: { blackbody: { kelvin: 5800, scale: 20 } } }],
};
const beamStrategies = [strategy('spectral', 'nee', 1), strategy('spectral', 'mis', 1)].map((s) => ({
    ...s, measurement: { ...s.measurement, camera: { type: 'pinhole' as const, fov: 1.0, position: [0, -1.5, 1.5] as [number, number, number], target: [0, 0.2, -1] as [number, number, number] } },
}));

export const spectralGaussianSuite: Record<string, SceneSuiteEntry> = {
    [plane.id]: {
        scene: plane, strategies: planeStrategies,
        exercises: 'Gaussian reflectance band: exact spectral evaluation and its RGB stand-in, one bounce under a unit white (D65) sky',
        witness: { size: [32, 32], spp: 256, checks: planeStrategies.map((_, strategy) => ({
            kind: 'mean' as const, strategy, value: standIn, tol: 0.006,
            source: { tier: 'exact' as const, from: 'gaussianStandIn, checked against an independent 0.25 nm quadrature in tests/components/gaussian.test.ts' },
            label: 'band stand-in' })) },
    },
    [beam.id]: {
        scene: beam, strategies: beamStrategies,
        exercises: 'A softbeam with blackbody emission: NEE and MIS agree',
        witness: { size: [32, 32], spp: 512, checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'blackbody softbeam NEE/MIS' }] },
    },
};
