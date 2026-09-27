import type { InstancedObject, RenderStrategy, SceneDescription, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';

// Identical geometry and authored colours through individual materials versus packed attributes.
// Deliberately unsorted positions exercise the placement/attribute permutation during TLAS packing.
export const packedPositions: Vec3[] = [[1.2, 0.6, -0.4], [-1.2, 0.5, 0], [0, 0.7, -1.1]];
export const packedAlbedos: Vec3[] = [[0.15, 0.3, 0.8], [0.8, 0.25, 0.1], [0.2, 0.7, 0.3]];
export const packedEmissions: Vec3[] = [[0.3, 0.8, 3], [3, 0.5, 0.2], [0.4, 2, 0.6]];
export const packedBatch: InstancedObject = {
    kind: 'instanced', name: 'coloured lamps',
    prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'lamps' },
    placements: packedPositions.map(position => ({ position })),
    attributes: { albedo: packedAlbedos, emission: packedEmissions },
};
export const spectralPackedScene: SceneDescription = {
    id: 'spectral-packed', ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        packedBatch,
    ],
    materials: { floor: { model: 'lambert', albedo: 0.65 }, lamps: { model: 'lambert', albedo: 0, emission: 0 } },
    lights: [{ kind: 'point', position: [0, 3, 2], emission: [0.6, 1.8, 3.6] }],
    environment: { type: 'constant', color: [0.02, 0.03, 0.05], sampleAsLight: true },
};
export const spectralPackedReference: SceneDescription = {
    ...spectralPackedScene, id: 'spectral-packed-ref',
    objects: [spectralPackedScene.objects[0], ...packedPositions.map((center, i) => ({
        type: 'sphere', parameters: { center, radius: 0.5 }, material: `lamp${i}`,
    }))],
    materials: {
        floor: spectralPackedScene.materials.floor,
        ...Object.fromEntries(packedAlbedos.map((albedo, i) => [`lamp${i}`, {
            model: 'lambert' as const, albedo, emission: packedEmissions[i],
        }])),
    },
};
export function packedStrategy(directLighting: 'nee' | 'mis', lightSelection: 'power' | 'bvh'): RenderStrategy {
    return {
        id: `${directLighting}-${lightSelection}`,
        measurement: {
            color: 'spectral', maxBounces: 3,
            camera: { type: 'pinhole', fov: 0.75, position: [3, 2.2, 5], target: [0, 0.5, -0.5] },
        },
        estimator: { directLighting, lightSelection, wavelengths: 'visible', russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}
export const spectralPackedSuite: Record<string, SceneSuiteEntry> = {
    'spectral-packed': {
        scene: spectralPackedScene, strategies: [packedStrategy('nee', 'bvh'), packedStrategy('mis', 'bvh')],
        exercises: 'Spectral albedo/emission attributes, instance light sampling and MIS, mixed point/instance lights and a sampled sky',
        witness: { size: [48, 36], spp: 256, checks: [
            { kind: 'twin', other: { scene: 'spectral-packed-ref' }, meanTol: 0.025, label: 'packed colours ≡ individual materials' },
            { kind: 'equality', strategies: [0, 1], meanTol: 0.025, label: 'instance NEE ≡ MIS' },
        ] },
    },
    'spectral-packed-ref': {
        scene: spectralPackedReference,
        strategies: [packedStrategy('nee', 'bvh'), packedStrategy('nee', 'power'), packedStrategy('mis', 'bvh')],
        exercises: 'The same scene using ordinary sphere/point light rows; tree versus inline light accessors',
        witness: { size: [48, 36], spp: 256, checks: [
            { kind: 'equality', strategies: [0, 1], meanTol: 0.025, label: 'packed light rows ≡ inline lights' },
            { kind: 'equality', strategies: [0, 2], meanTol: 0.025, label: 'ordinary-light NEE ≡ MIS' },
        ] },
    },
};
