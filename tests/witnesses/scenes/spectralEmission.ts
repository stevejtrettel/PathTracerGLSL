import type { RenderStrategy, SceneDescription, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { spectralSlab, mediaStrategy } from './spectralMedia.js';
import { emitSatScene, emitScatterScene } from './emissionWitness.js';

const slab: SceneDescription = structuredClone(spectralSlab);
slab.id = 'spectral-emit'; slab.name = 'Spectral glowing slab';
slab.materials.ink.medium!.emission = [0.4, 0.8, 1.2];
const tracked = (s: RenderStrategy): RenderStrategy => ({ ...s, estimator: { ...s.estimator, volumeSampling: 'delta-tracking' } });
const reference = { tier: 'exact' as const, from: '0.25 nm wavelength quadrature of the volume-emission integral; scripts/audit-spectral-emission.ts, refinement discrepancy < 3e-11' };
const slabTarget: Vec3 = [1.0856489702871754, 1.0714052572064272, 0.9989961584015604];
const varying = structuredClone(slab);
varying.id = 'spectral-emit-tracking'; varying.name = 'Spectral varying-density glow';
varying.materials.ink.medium = {
    sigma_a: { kind: 'glsl', source: 'vec3(0.3,0.7,1.2)*(0.5-p.z)' },
    emission: { kind: 'glsl', source: 'vec3(0.4,0.8,1.2)*(0.5-p.z)' }, majorant: 2,
};
// Both densities share f(z); optical path substitution gives the constant-slab target
// because integral_{-1}^0 (0.5-z) dz = 1. The clamp fixture has the same effective field.
const clamped = structuredClone(slab);
clamped.id = 'spectral-emit-clamp'; clamped.name = 'Spectral glow field ceiling';
clamped.materials.ink.medium = {
    sigma_a: { kind: 'glsl', source: 'vec3(0.3,0.7,1.2)*u_glow_gain', params: [{ param: 'glow.gain', default: 4, min: 1, max: 8 }] },
    emission: { kind: 'glsl', source: 'vec3(0.4,0.8,1.2)*u_glow_gain' }, majorant: 1.2,
};
const vacuum = structuredClone(slab);
vacuum.id = 'spectral-emit-vacuum'; vacuum.name = 'Spectral luminous vacuum';
vacuum.materials.ink.medium = { sigma_a: 0, emission: 0.5 };
const vacuumTracked = structuredClone(vacuum);
vacuumTracked.id = 'spectral-emit-vacuum-tracking'; vacuumTracked.name = 'Spectral luminous vacuum, tracking';
vacuumTracked.materials.ink.medium = { sigma_a: 0, emission: { kind: 'glsl', source: '0.5*(0.5-p.z)' }, majorant: 1 };
const fog = structuredClone(emitSatScene);
fog.id = 'spectral-emit-budget'; fog.name = 'Spectral glowing fog: scattering orders';
const budgetTargets: Vec3[] = [[0.3329598596766985,0.6661458997816789,1.3332976734380917],
    [0.4439464795689395,0.8881945330422348,1.7777302312507883],
    [0.48094201953301496,0.9622107441290906,1.925874417188353]];
const budgets = [0,1,2].map(n => {
    const s = tracked(mediaStrategy(`budget-${n}`));
    return { ...s, measurement: { ...s.measurement, maxBounces: n,
        camera: { type: 'pinhole' as const, fov: 0.8, position: [0,0,30] as Vec3, target: [0,0,31] as Vec3 } } };
});
const driven = structuredClone(fog);
driven.id = 'spectral-emit-driven'; driven.name = 'Spectral glow with live extinction';
driven.materials.glow.medium!.sigma_a = { param: 'glow.a', default: 0.05, min: 0, max: 4 };
driven.materials.glow.medium!.sigma_s = { param: 'glow.s', default: 0.1, min: 0, max: 4 };
const scatter = structuredClone(emitScatterScene);
scatter.id = 'spectral-emit-scatter'; scatter.name = 'Spectral glowing fog with an area light';
scatter.materials.glowfog.medium!.sigma_a = [0.02, 0.05, 0.1];
scatter.materials.glowfog.medium!.sigma_s = [0.2, 0.4, 0.7];
const scatterStrategies = (['nee', 'none'] as const).map(d => {
    const s = tracked(mediaStrategy(d, d));
    return { ...s, measurement: { ...s.measurement, maxBounces: 8,
        camera: { type: 'pinhole' as const, fov: 0.8, position: [0,1,4] as Vec3, target: [0,1,0] as Vec3 } },
        estimator: { ...s.estimator, russianRoulette: { startDepth: 3 } } };
});
export const spectralEmissionSuite: Record<string, SceneSuiteEntry> = {
    [slab.id]: { scene: slab, strategies: ['uniform','visible'].map(w => mediaStrategy(w,'none',w as 'uniform' | 'visible')),
        exercises: 'Spectral chromatic absorption and emission, independent source integral',
        witness: { size: [24,24], spp: 512, checks: [0,1].map(strategy => ({ kind: 'mean', strategy, value: slabTarget, tol: 0.005, source: reference })) } },
    ...Object.fromEntries([varying, clamped].map(scene => [scene.id, { scene, strategies: [tracked(mediaStrategy('tracking'))],
        exercises: 'RGB-field scaling precedes coefficient and emission lifts; ratio-tracked source integral',
        witness: { size: [24,24], spp: 1024, checks: [{ kind: 'mean', value: slabTarget, tol: 0.006, source: reference }] },
    } satisfies SceneSuiteEntry])),
    ...Object.fromEntries([vacuum, vacuumTracked].map(scene => [scene.id, { scene,
        strategies: [scene === vacuum ? mediaStrategy('analytic') : tracked(mediaStrategy('tracking'))],
        exercises: 'Zero extinction preserves unit background and adds emission times distance',
        witness: { size: [24,24], spp: 1024, checks: [{ kind: 'mean', value: 1.5, tol: 0.006 }] },
    } satisfies SceneSuiteEntry])),
    [fog.id]: { scene: fog, strategies: budgets,
        exercises: 'Spectral emission collected before the delta-tracking lottery at bounce budgets 0, 1 and 2',
        witness: { size: [24,24], spp: 1024, checks: budgetTargets.map((value,strategy) => ({ kind: 'mean', strategy, value, tol: 0.015, source: reference })) } },
    [driven.id]: { scene: driven, strategies: [budgets[2]], initialParameters: { 'glow.a': 2, 'glow.s': 1 },
        exercises: 'Both live extinction inputs update the spectral majorant above its default value',
        witness: { size: [24,24], spp: 1024, checks: [{ kind: 'mean', value: budgetTargets[2], tol: 0.015, source: reference }] } },
    [scatter.id]: { scene: scatter, strategies: scatterStrategies,
        exercises: 'Coloured spectral extinction and volume emission compose with surface and medium NEE',
        witness: { size: [32,24], spp: 1024, checks: [{ kind: 'equality', strategies: [0,1], meanTol: 0.04, rmse: 0.5, label: 'glowing fog NEE ≡ PT' }] } },
};
