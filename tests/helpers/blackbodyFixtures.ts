import type { SceneDescription, SpectrumValue } from '../../src/compiler/types.js';
import { minimalScene } from '../witnesses/scenes/minimalScene.js';

export const blackbodySites = ['surface', 'mesh', 'point', 'quad', 'batch', 'sky'] as const;
export type BlackbodySite = typeof blackbodySites[number];

export function blackbodyFixture(site: BlackbodySite, emission: SpectrumValue): SceneDescription {
    const scene = structuredClone(minimalScene);
    scene.id = 'blackbody-preservation';
    scene.materials.lamp = { model: 'lambert', albedo: 0, emission };
    const sphere = { type: 'sphere', parameters: { center: [0, 2, 0], radius: 0.5 }, material: 'lamp' };
    if (site === 'surface') scene.objects.push(sphere);
    if (site === 'mesh') scene.objects.push({ kind: 'mesh', material: 'lamp',
        positions: new Float32Array([-1, 2, -1, 1, 2, -1, 1, 2, 1, -1, 2, 1]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]) });
    if (site === 'point') scene.lights.push({ kind: 'point', position: [1, 2, 0], emission });
    if (site === 'quad') scene.lights.push({ kind: 'quad', corner: [-1, 2, -1], edge1: [2, 0, 0], edge2: [0, 0, 2], emission });
    if (site === 'batch') scene.objects.push({ kind: 'instanced', prototype: { ...sphere, parameters: { radius: 0.5 } },
        placements: [{ position: [-1, 2, 0] }, { position: [1, 2, 0], scale: 0.75 }] });
    if (site === 'sky') scene.environment = { type: 'constant', color: emission, sampleAsLight: true };
    return scene;
}
