import type { SceneDescription, RenderStrategy, BlackbodyValue } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { spectralLiveAt, liveDefaults, liveStrategies } from './spectralLive.js';

const blackbody = (kelvin: number, scale = 1): BlackbodyValue => ({ blackbody: { kelvin, scale } });
const direct: SceneDescription = {
    id: 'spectral-blackbody-direct', name: 'True 1000 K emission', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'lamp' }],
    materials: { lamp: { model: 'lambert', albedo: 0, emission: blackbody(1000, 0.2174975862105915) } }, lights: [],
};
const directStrategies: RenderStrategy[] = (['rgb', 'spectral'] as const).map(color => ({
    id: color, measurement: { color, maxBounces: 0,
        camera: { type: 'orthographic', scale: 0.5, position: [0, 0, 2], target: [0, 0, 0] } },
    estimator: { directLighting: 'none', ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}),
        russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
}));
const receiver: SceneDescription = {
    ...direct, id: 'spectral-blackbody-receiver', name: 'Selective receiver under a Planck sky',
    materials: { lamp: { model: 'lambert', albedo: [0.1, 0.5, 0.8] } },
    environment: { type: 'constant', color: blackbody(6500, 0.9586431216686195), sampleAsLight: true },
};
const receiverStrategies = (['none', 'nee', 'mis'] as const).map(directLighting => ({
    ...directStrategies[1], id: directLighting,
    measurement: { ...directStrategies[1].measurement, maxBounces: 1 },
    estimator: { ...directStrategies[1].estimator, directLighting },
}));
function sceneAt(kelvin: number, scale: number, live = false): SceneDescription {
    const scene = spectralLiveAt(liveDefaults);
    scene.id = 'spectral-blackbody';
    scene.name = 'Planck lighting — live temperature and reference brightness';
    scene.lights[1].emission = live ? { blackbody: {
        kelvin: { param: 'lamp.kelvin', default: kelvin, min: 1000, max: 40000 },
        scale: { param: 'lamp.power', default: scale, min: 0, max: 22 },
    } } : blackbody(kelvin, scale);
    scene.lights[0].emission = blackbody(12000, 1.914207773915614);
    scene.environment = { type: 'constant', color: blackbody(6500, 0.03834572486674478), sampleAsLight: true };
    return scene;
}
const source = { tier: 'exact' as const, from: 'Independent Planck × shipped CIE quadrature: tests/helpers/planckReference.ts and scripts/audit-blackbody.ts' };
const tree = sceneAt(2900, 7.687615923237919);
tree.id = 'spectral-blackbody-tree';
const treeStrategies = (['power', 'bvh'] as const).flatMap(lightSelection => liveStrategies.map(s => ({
    ...s, id: `${lightSelection}-${s.id}`, estimator: { ...s.estimator, lightSelection },
})));
export const spectralBlackbodySuite: Record<string, SceneSuiteEntry> = {
    [direct.id]: {
        scene: direct, strategies: directStrategies,
        exercises: 'Signed RGB projection of true 1000 K emission in both colour modes',
        witness: { size: [16, 16], spp: 1024, checks: directStrategies.map((_, strategy) => ({
            kind: 'mean', strategy, value: [1, 0.008696905553155198, -0.019583581806685922], tol: 0.003, source,
        })) },
    },
    [receiver.id]: {
        scene: receiver, strategies: receiverStrategies,
        exercises: 'A selective reflector distinguishes Planck from reconstructed RGB under PT/NEE/MIS',
        witness: { size: [48, 48], spp: 1024, checks: receiverStrategies.map((_, strategy) => ({
            kind: 'mean', strategy, value: [0.11238551378670997, 0.4685853532057486, 0.7959666670285566], tol: 0.002, source,
        })) },
    },
    'spectral-blackbody': {
        scene: sceneAt(2900, 7.687615923237919, true), strategies: liveStrategies,
        exercises: 'Live Planck quad, cold Planck point lamp and sky; temperature and scale remain independent',
        witness: { size: [40, 30], spp: 256, checks: [
            { kind: 'twin', other: { scene: 'spectral-blackbody-ref' }, meanTol: 0.005, rmse: 0.003 },
            { kind: 'equality', strategies: [0, 1], meanTol: 0.025 },
        ] },
    },
    'spectral-blackbody-ref': {
        scene: { ...sceneAt(2900, 7.687615923237919), id: 'spectral-blackbody-ref' }, strategies: liveStrategies,
        exercises: 'Constant Planck reference for live defaults',
    },
    'spectral-blackbody-changed': {
        scene: { ...sceneAt(2900, 7.687615923237919, true), id: 'spectral-blackbody-changed' }, strategies: liveStrategies,
        initialParameters: { 'lamp.kelvin': 1000, 'lamp.power': 1.739980689684732 },
        exercises: 'Temperature and intensity updated together, including light and sky selection weights',
        witness: { size: [40, 30], spp: 256, checks: [
            { kind: 'twin', other: { scene: 'spectral-blackbody-changed-ref' }, meanTol: 0.005, rmse: 0.003 },
        ] },
    },
    'spectral-blackbody-changed-ref': {
        scene: { ...sceneAt(1000, 1.739980689684732), id: 'spectral-blackbody-changed-ref' }, strategies: liveStrategies,
        exercises: 'Constant reference for live 1000 K settings',
    },
    [tree.id]: {
        scene: tree, strategies: treeStrategies,
        exercises: 'Distinct Planck forms retain their spectra through light-table reads and power/tree NEE/MIS',
        witness: { size: [40, 30], spp: 512, checks: [
            { kind: 'equality', strategies: [0, 1, 2, 3], meanTol: 0.025 },
        ] },
    },
};
