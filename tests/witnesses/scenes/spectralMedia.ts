import type { RenderStrategy, SceneDescription } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { slabScene, furnaceScatterScene } from './mediaWitness.js';
import { fogArea } from './areaLightScenes.js';

export const spectralSlab: SceneDescription = {
    ...slabScene, id: 'spectral-slab', name: 'Spectral absorbing slab',
    materials: { ...slabScene.materials, ink: { model: 'none', medium: { sigma_a: [0.3, 0.7, 1.2] } } },
};
export function mediaStrategy(id: string, directLighting: 'none' | 'nee' | 'mis' = 'none', wavelengths: 'uniform' | 'visible' = 'visible'): RenderStrategy {
    return { id,
        measurement: { color: 'spectral', maxBounces: 1,
            camera: { type: 'orthographic', scale: 0.5, position: [0,0,2], target: [0,0,-1] } },
        estimator: { directLighting, wavelengths, russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}
const reference = { tier: 'exact' as const, from: '0.25 nm Simpson quadrature of D65 * exp(-lift(sigma_a) * distance) against CIE; scripts/audit-spectral-media.ts, refinement discrepancy < 7e-12' };
const slabRGB: [number,number,number] = [0.7252018857862556,0.49546203867937083,0.2958918635233839];
const shadowRGB: [number,number,number] = [0.5095338330733582,0.24475284573080522,0.08187756456891372];
const samplers = ['uniform', 'visible'] as const;
const shadow: SceneDescription = {
    ...spectralSlab, id: 'spectral-shadow-slab', name: 'Spectral absorbing shadow',
    materials: { screen: { model: 'lambert', albedo: 1 },
        ink: { model: 'none', medium: { sigma_a: [0.3,0.7,1.2], sigma_s: [0.1,0.3,0.8] } } },
    lights: [{ kind: 'directional', direction: [0,0,-1], emission: Math.PI }],
};
export const spectralFog: SceneDescription = {
    ...fogArea, id: 'spectral-fog', name: 'Spectral fog with an area light',
    materials: { ...fogArea.materials, haze: { model: 'none', medium: {
        sigma_a: [0.02,0.05,0.1], sigma_s: [0.2,0.4,0.7], phase_g: 0.6,
    } } },
};
const fogStrategies = (['nee','mis','none'] as const).map(e => {
    const s = mediaStrategy(e,e);
    return { ...s, measurement: { ...s.measurement, maxBounces: 8,
        camera: { type: 'pinhole', fov: 0.8, position: [0,1,4], target: [0,1,0] } },
        estimator: { ...s.estimator, russianRoulette: { startDepth: 3 } } } as RenderStrategy;
});
export const spectralMediaSuite: Record<string, SceneSuiteEntry> = {
    'spectral-slab': { scene: spectralSlab, strategies: samplers.map(w => mediaStrategy(w,'none',w)),
        exercises: 'Coloured spectral Beer–Lambert attenuation through two null interfaces; both wavelength proposals',
        witness: { size: [24,24], spp: 512, checks: samplers.map((_,strategy) => ({ kind: 'mean', strategy, value: slabRGB, tol: 0.005, source: reference, label: 'spectral Beer–Lambert' })) } },
    'spectral-shadow-slab': { scene: shadow,
        strategies: samplers.map(w => { const s = mediaStrategy(w,'nee',w); return { ...s, measurement: { ...s.measurement, scattering: 'ignored' as const } }; }),
        exercises: 'Two slab crossings, one camera and one shadow; scattering ignored consistently on both paths',
        witness: { size: [24,24], spp: 512, checks: samplers.map((_,strategy) => ({ kind: 'mean', strategy, value: shadowRGB, tol: 0.005, source: reference, label: 'camera and shadow extinction' })) } },
    'spectral-scatter-furnace': {
        scene: { ...furnaceScatterScene, id: 'spectral-scatter-furnace', name: 'Spectral scattering furnace',
            materials: { ...furnaceScatterScene.materials, haze: { model: 'none', medium: { sigma_s: [0.1,0.2,0.4], phase_g: 0.7 } } } },
        strategies: samplers.map(w => { const s = mediaStrategy(w,'none',w); return { ...s, measurement: { ...s.measurement, maxBounces: 48,
            camera: { type: 'pinhole', fov: 1, position: [0,0,0], target: [0,0,-1] } } }; }),
        exercises: 'Chromatic channel-mixture weights and HG scattering preserve the grey furnace equilibrium',
        witness: { size: [24,24], spp: 512, checks: samplers.map((_,strategy) => ({ kind: 'mean', strategy, value: 0.4, tol: 0.005, label: 'scattering furnace equilibrium' })) },
    },
    'spectral-fog': { scene: spectralFog, strategies: fogStrategies,
        exercises: 'Coloured absorption and scattering, area lighting, medium MIS, spectral shadow transmittance and roulette',
        witness: { size: [32,24], spp: 1024, checks: [
            { kind: 'equality', strategies: [0,1], meanTol: 0.03, label: 'spectral fog NEE/MIS' },
            { kind: 'equality', strategies: [0,2], meanTol: 0.04, rmse: 0.65, label: 'spectral fog PT tripwire' },
        ] },
    },
};

// The phase law changes without changing the furnace's equilibrium radiance.
const rayleigh = structuredClone(spectralMediaSuite['spectral-scatter-furnace']);
rayleigh.scene.id = 'spectral-rayleigh-furnace';
rayleigh.scene.name = 'Spectral Rayleigh furnace';
rayleigh.scene.materials.haze.medium = { model: 'rayleigh', sigma_s: [0.1,0.2,0.4] };
rayleigh.strategies = [rayleigh.strategies[1]];
rayleigh.exercises = 'Rayleigh phase sampling preserves the spectral scattering furnace';
rayleigh.witness!.checks = [{ kind: 'mean', value: 0.4, tol: 0.005, label: 'Rayleigh furnace equilibrium' }];
spectralMediaSuite['spectral-rayleigh-furnace'] = rayleigh;

const placement = structuredClone(spectralMediaSuite['spectral-fog']);
placement.scene.id = 'spectral-fog-placement';
placement.scene.name = 'Spectral fog, equiangular placement';
placement.scene.lights = [{ kind: 'point', position: [0.6,1.7,0], emission: 5 }];
const vertex = { ...fogStrategies[0], measurement: { ...fogStrategies[0].measurement, maxBounces: 2 } };
placement.strategies = [vertex, { ...vertex, id: 'equiangular', estimator: { ...vertex.estimator, mediumLightSampling: 'equiangular' } }];
placement.exercises = 'Spectral medium lighting agrees between collision and equiangular placement';
placement.witness = { size: [32,24], spp: 1024, checks: [
    { kind: 'equality', strategies: [0,1], meanTol: 0.04, label: 'spectral medium light placement' },
] };
spectralMediaSuite['spectral-fog-placement'] = placement;
