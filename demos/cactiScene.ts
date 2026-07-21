// demos/cactiScene.ts — the mesh-story showcase (containment + mesh lights, Jul 20 2026):
// three COLORED-GLASS cacti — real colored glass, not painted: a dielectric surface over an
// ABSORBING interior medium (Beer–Lambert tint through the mesh's proven-closed volume) —
// lit by a GLOWING cactus (an emissive mesh, NEE-sampled via the triangle-area CDF). One
// scene exercising: OBJ meshes, closed-mesh containment (watertight/winding Validator-proven),
// ior_of mesh rows, interior media through mesh boundaries, and the data-driven mesh light.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { parseOBJ } from '../src/authoring/loadOBJ.js';
import { withPose } from '../src/authoring/strategy.js';
import cactusObj from './models/cactus.obj?raw';

// One parse per material role (each mesh object owns its buffers; the pack cache dedups by
// object identity, and these are distinct objects on purpose — different materials).
// Smooth normals: refraction reads far better on smoothed silhouettes than on flat facets.
const glassCactus = (material: string) => parseOBJ(cactusObj, { material, smoothNormals: true, closed: true });
const glowCactus = parseOBJ(cactusObj, { material: 'glow', smoothNormals: true });

const cactusAt = (mesh: ReturnType<typeof glassCactus>, name: string, position: [number, number, number], angle: number, scale: number) => ({
    ...mesh,
    name,
    transform: { position, rotation: { axis: [0, 1, 0] as [number, number, number], angle }, scale },
});

export const cactiScene: SceneDescription = {
    id: 'cacti',
    name: 'Glass Cacti (containment + mesh light)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-8, 0, -8], edge1: [0, 0, 16], edge2: [16, 0, 0] }, material: 'ground' },
        // The lamp: an emissive cactus — a REAL mesh light (uniform-area CDF over its 1152
        // triangles; sampleAsLight defaults on). Slightly raised stage center.
        cactusAt(glowCactus, 'lantern', [0, 0, 0], 0.4, 1.25),
        // Three colored-glass cacti CLOSE around the lantern — transmitted glow is the
        // point of colored glass, so they stand where the light shines through them.
        cactusAt(glassCactus('glass_green'), 'green', [-1.15, 0, 0.5], 2.1, 1.0),
        cactusAt(glassCactus('glass_amber'), 'amber', [1.05, 0, 0.7], -1.2, 0.9),
        cactusAt(glassCactus('glass_blue'), 'blue', [0.65, 0, -1.0], 3.6, 1.05),
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.30, 0.30, 0.33] },
        // The glow: warm Le; albedo matters only for reflected light on the emitter itself.
        glow: { model: 'lambert', albedo: [0.5, 0.35, 0.2], emission: [9, 5.2, 2.2] },
        // Colored glass = dielectric + Beer–Lambert interior (σ_a per unit; the cactus is
        // ~1.35 units tall and thin, so 3–8/unit gives a saturated-but-translucent tint).
        glass_green: { model: 'dielectric', ior: 1.5, medium: { sigma_a: [5.0, 0.5, 4.0] } },
        glass_amber: { model: 'dielectric', ior: 1.5, medium: { sigma_a: [0.4, 2.2, 7.0] } },
        glass_blue: { model: 'dielectric', ior: 1.5, medium: { sigma_a: [6.0, 2.8, 0.5] } },
    },
    lights: [],
    // A faint cool night sky so silhouettes and the glass backsides read; the lantern
    // cactus carries the scene.
    environment: { type: 'constant', color: [0.030, 0.045, 0.075], intensity: 1.0 },
};

const base: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 12 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 5 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const cactiStrategy: RenderStrategy = withPose(base, [0.3, 1.45, 3.9], [0, 0.72, 0]);
export const cactiMisStrategy: RenderStrategy = {
    ...cactiStrategy,
    id: 'pathtracer-mis',
    estimator: { ...cactiStrategy.estimator, directLighting: 'mis' },
};
