import type { SceneSuiteEntry } from '../types.js';
import { spectralMediaSuite } from './spectralMedia.js';

const slab = structuredClone(spectralMediaSuite['spectral-slab']);
slab.scene.id = 'spectral-tracking-slab';
slab.scene.name = 'Spectral varying absorption';
slab.scene.materials.ink.medium = {
    // z in [-1,0]: this factor has integral one through the slab. The coefficient
    // lift is homogeneous in RGB amplitude, so the existing slab reference applies.
    sigma_a: {kind:'glsl',source:'vec3(0.3,0.7,1.2) * (0.5-p.z)'}, majorant:2,
};
slab.strategies = slab.strategies.map(s => ({...s,estimator:{...s.estimator,volumeSampling:'delta-tracking'}}));
slab.witness!.spp = 1024;
slab.exercises = 'Ratio-tracked spatial absorption against the independent spectral Beer–Lambert reference';

const clamp = structuredClone(slab);
clamp.scene.id = 'spectral-tracking-clamp';
clamp.scene.name = 'Spectral authored density ceiling';
clamp.scene.materials.ink.medium = {
    sigma_a:{kind:'glsl',source:'vec3(0.3,0.7,1.2) * u_density_gain', params:[{param:'density.gain',default:4,min:0,max:8}]}, majorant:1.2,
};
clamp.strategies = [clamp.strategies[1]];
clamp.witness!.checks = [clamp.witness!.checks[0]];
clamp.exercises = 'Authored field ceiling applied before lifting; a larger sampling rate must not change the field';

const shadow = structuredClone(spectralMediaSuite['spectral-shadow-slab']);
shadow.scene.id = 'spectral-tracking-shadow';
shadow.scene.name = 'Spectral varying shadow absorption';
shadow.scene.materials.ink.medium = {
    sigma_a:{kind:'glsl',source:'vec3(0.3,0.7,1.2) * (0.5-p.z)'},
    sigma_s:{kind:'glsl',source:'vec3(0.1,0.3,0.8) * (0.5-p.z)'}, majorant:4,
};
shadow.strategies = [{...shadow.strategies[1],estimator:{...shadow.strategies[1].estimator,volumeSampling:'delta-tracking'}}];
shadow.witness!.spp = 1024;
shadow.witness!.checks = [shadow.witness!.checks[0]];
shadow.exercises = 'Varying absorption on camera and shadow segments; scattering ignored consistently';

const fog = structuredClone(spectralMediaSuite['spectral-fog']);
fog.scene.id = 'spectral-tracking-fog';
fog.scene.name = 'Spectral tracking fog';
fog.scene.materials.haze.medium = {
    sigma_a:{kind:'glsl',source:'vec3(0.02,0.05,0.1)'},
    sigma_s:{kind:'glsl',source:'vec3(0.2,0.4,0.7)'}, phase_g:0.6, majorant:0.9,
};
fog.strategies = [fog.strategies[0],fog.strategies[2]].map(s=>({...s,estimator:{...s.estimator,volumeSampling:'delta-tracking'}}));
fog.witness!.checks = [
    {kind:'twin',other:{scene:'spectral-fog',strategy:0},meanTol:0.03,rmse:0.35,label:'spectral delta ≡ analytic NEE'},
    {kind:'twin',strategy:1,other:{scene:'spectral-fog',strategy:2},meanTol:0.04,rmse:0.65,label:'spectral delta ≡ analytic PT'},
];
fog.exercises = 'Four-lane spectral collision lottery and ratio-tracked shadows against the analytic medium';

export const spectralTrackingSuite: Record<string,SceneSuiteEntry> = {
    'spectral-tracking-slab':slab, 'spectral-tracking-clamp':clamp,
    'spectral-tracking-shadow':shadow, 'spectral-tracking-fog':fog,
};
