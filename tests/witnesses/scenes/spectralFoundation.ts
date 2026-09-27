import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { furnaceBox } from './furnaceBox.js';

const reference = { tier: 'exact' as const, from: '0.25 nm Simpson quadrature of the shipped float32 lift and CIE/D65 data; scripts/audit-spectral.ts (refinement discrepancy < 3e-9)' };
function strategy(wavelengths: 'uniform' | 'visible', directLighting: 'none' | 'nee' | 'mis', maxBounces: number): RenderStrategy {
    return {
        id: `${wavelengths}-${directLighting}`,
        measurement: { color: 'spectral', camera: { type: 'pinhole', fov: 0.8, position: [0,0,0], target: [0,0,-1] }, maxBounces },
        estimator: { wavelengths, directLighting, russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'none' } },
    };
}
const furnace = structuredClone(furnaceBox);
furnace.id = 'spectral-furnace';
const colored = structuredClone(furnace);
colored.id = 'spectral-colored-furnace';
colored.materials.furnace.albedo = [.2,.5,.8];
const plane: SceneDescription = {
    id: 'spectral-plane', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0,0,1], offset: 1 }, material: 'plane' }],
    materials: { plane: { model: 'lambert', albedo: [.2,.5,.8] } }, lights: [],
    environment: { type: 'constant', color: 1, sampleAsLight: true },
};
const direct: SceneDescription = { ...plane, id: 'spectral-direct',
    materials: { plane: { model: 'lambert', albedo: 0, emission: 1, sampleAsLight: false } },
    environment: { type: 'none' },
};
const samplers = ['uniform','visible'] as const;
const planeStrategies = samplers.flatMap(w => (['none','nee','mis'] as const).map(e => strategy(w,e,1)));
export const spectralFoundationSuite: Record<string, SceneSuiteEntry> = {
    'spectral-direct': {
        scene: direct, strategies: samplers.map(w=>strategy(w,'none',0)),
        exercises: 'Direct D65 emission, normalized CIE sensor, four wavelength lanes and both wavelength proposals',
        witness: { size:[32,32], spp:256, checks: samplers.map((_,strategy)=>({kind:'mean',strategy,value:1,tol:.004,label:'D65 white'})) },
    },
    'spectral-furnace': {
        scene: furnace, strategies: samplers.map(w=>strategy(w,'none',6)),
        exercises: 'Grey spectral finite furnace; exactly 0.2 times the geometric sum through bounce six',
        witness: { size:[32,32], spp:256, checks: samplers.map((_,strategy)=>({kind:'mean',strategy,value:.4*(1-.5**7),tol:.002,label:'finite grey furnace'})) },
    },
    'spectral-colored-furnace': {
        scene: colored, strategies: samplers.map(w=>strategy(w,'none',6)),
        exercises: 'Spectral multiplication at successive bounces; finite series integrated against CIE response',
        witness: { size:[32,32], spp:256, checks: samplers.map((_,strategy)=>({kind:'mean',strategy,value:[.22947348594259948,.3932385892493329,.7652177863431524],tol:.004,source:reference,label:'finite coloured furnace'})) },
    },
    'spectral-plane': {
        scene: plane, strategies: planeStrategies,
        exercises: 'One-bounce Lambert reflectance under a unit D65 sky; PT/NEE/MIS and both wavelength proposals',
        witness: { size:[32,32], spp:256, checks: planeStrategies.map((_,strategy)=>({kind:'mean',strategy,value:[.19988754650944823,.49999884784204934,.8003487614363121],tol:.006,source:reference,label:'projected lifted albedo'})) },
    },
};
