import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { skyScene, procSkyScene } from './envScenes.js';

function strategy(id: string, directLighting: 'none' | 'nee' | 'mis', envSampler = 'equirect', color: 'rgb' | 'spectral' = 'spectral', envCompensation = false): RenderStrategy {
    return { id,
        measurement: { color, maxBounces: 1, camera: { type: 'pinhole', fov: 0.6, position: [0, 1, 0], target: [0, 0, -0.1] } },
        estimator: { directLighting, envSampler, envCompensation, russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}
const plane: SceneDescription = {
    id: 'spectral-sky-plane', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' }],
    materials: { floor: { model: 'lambert', albedo: 0.5 } }, lights: [],
};
const charts = ['equirect', 'octahedral'];
const capStrategies = ['rgb', 'spectral'].flatMap(color => charts.map(chart => strategy(`${color}-${chart}`, 'nee', chart, color as 'rgb' | 'spectral')));
const compStrategies = charts.map(chart => strategy(chart, 'mis', chart, 'spectral', true));
// Constant 16×16 RGBE fixture. The loader currently decodes channels as byte*2/255;
// this reference tests the spectral lift of that decoded RGB, not RGBE file accuracy.
const imageRGB: [number, number, number] = [64/255, 128/255, 256/255];
const constantHDR = 'data:image/vnd.radiance;base64,' + btoa(
    '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 16 +X 16\n' + String.fromCharCode(32,64,128,129).repeat(16*16),
);
const imageStrategies = [strategy('nee','nee'), strategy('mis','mis'), strategy('oct','mis','octahedral')];
const showcase = (scene: SceneDescription, id: string): SceneSuiteEntry => ({
    scene: { ...scene, id, lights: [{ kind:'point', position:[-2,4,2], emission:[5,4,3] }] },
    strategies: imageStrategies.map(s=>({ ...s, measurement: { ...s.measurement, maxBounces: 4,
        camera: { type: 'pinhole', fov: 0.8, position: [4, 2.5, 6], target: [0.6, 0.8, 0] } } })),
    exercises: 'Spectral sky with diffuse surfaces and glass, comparing NEE/MIS and sampling charts',
    witness: { size: [48,36], spp: 512, checks: [
        { kind: 'equality', strategies: [0,1,2], meanTol: 0.03, label: 'spectral sky estimators/charts' },
    ] },
});
export const spectralSkiesSuite: Record<string, SceneSuiteEntry> = {
    'spectral-sky': showcase(skyScene,'spectral-sky'),
    'spectral-proc-sky': showcase(procSkyScene,'spectral-proc-sky'),
    'sky-missed-cap': {
        scene: { ...plane, id: 'sky-missed-cap', environment: { type: 'procedural', tableSize: [4,2],
            glsl: { kind: 'glsl', source: 'vec3(step(0.9, dir.y))' } } },
        strategies: capStrategies,
        exercises: 'Both chart bakes miss a polar cap completely; uniform-sphere NEE still sees the formula. rho*(1-cos²(thetaCap)) = 0.095',
        witness: { size: [32,32], spp: 512, checks: capStrategies.map((_,strategy)=>({
            kind:'mean', strategy, value:0.095, tol:0.004, label:'unbaked cap integral',
        })) },
    },
    'spectral-comp-empty': {
        scene: { ...plane, id:'spectral-comp-empty', environment: { type:'procedural', tableSize:[4,2], glsl:{kind:'glsl',source:'vec3(1.0)'} } },
        strategies: compStrategies,
        exercises:'Uniform sky compensates to zero; the BSDF miss receives full MIS weight',
        witness:{size:[32,32],spp:512,checks:compStrategies.map((_,strategy)=>({kind:'mean',strategy,value:0.5,tol:0.004,label:'empty compensated sky'}))},
    },
    'spectral-image-constant': {
        scene:{...plane,id:'spectral-image-constant',environment:{type:'image',url:constantHDR,intensity:2,rotation:0.73}},
        strategies:[...imageStrategies, strategy('rgb','nee','equirect','rgb')],
        exercises:'Loaded RGBE texture is lifted as spectral emission after filtering and intensity; same integral as constant authored RGB',
        witness:{size:[32,32],spp:512,checks:[
            {kind:'twin',other:{scene:'spectral-image-constant-ref'},meanTol:0.015,label:'image emission ≡ constant RGB'},
            {kind:'equality',strategies:[0,1,2],meanTol:0.015,label:'image charts/estimators'},
            {kind:'mean',strategy:3,value:imageRGB,tol:0.008,label:'RGB image integral'},
        ]},
    },
    'spectral-image-constant-ref': {
        scene:{...plane,id:'spectral-image-constant-ref',environment:{type:'constant',color:imageRGB,intensity:2,sampleAsLight:true}},
        strategies:imageStrategies,
        exercises:'Constant reference for the loaded RGBE sky',
    },
};
