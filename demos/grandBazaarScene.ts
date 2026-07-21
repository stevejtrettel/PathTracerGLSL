// demos/grandBazaarScene.ts — the Stage B payoff shot (fable-object-tables): ~350 UNIQUE
// objects (every one its own record — no two alike) + a 150-instance batch + meshes +
// the residual arm (plane floor, driven orb), all under ONE scene TLAS. Table-only
// strategies ON PURPOSE: an unrolled arm at this count would stall compile at load —
// which is exactly the pain the table retires (the A/B lives on the moderate `bazaar`
// witness, where both arms stay tractable).

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { instance, scatter } from '../src/authoring/instance.js';
import { withPose } from '../src/authoring/strategy.js';
import { parseOBJ } from '../src/authoring/loadOBJ.js';
import cactusObj from './models/cactus.obj?raw';

function hueRGB(h: number, sat: number, v: number): [number, number, number] {
    const f = (n: number) => { const k = (n + h * 6) % 6; return v - v * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
}

const cactus = parseOBJ(cactusObj, { material: 'flora', smoothNormals: true });

function build(): { objects: SceneDescription['objects']; materials: SceneDescription['materials'] } {
    let s = 20260721 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const materials: SceneDescription['materials'] = {
        ground: { model: 'lambert', albedo: [0.4, 0.39, 0.37] },
        flora: { model: 'lambert', albedo: [0.2, 0.5, 0.25] },
        accent: { model: 'lambert', albedo: [0.8, 0.65, 0.4] },
        chrome: { model: 'mirror', f0: [0.9, 0.9, 0.92] },
    };
    // A 12-color palette — many objects, FEW materials (regions are per-object; the
    // material table is shared).
    for (let i = 0; i < 12; i++) {
        materials[`c${i}`] = { model: 'lambert', albedo: hueRGB(i / 12, 0.5 + 0.25 * ((i % 3) / 2), 0.78) };
    }
    const mat = () => `c${Math.floor(rnd() * 12)}`;

    const objects: SceneDescription['objects'] = [
        // RESIDUAL: the unbounded floor + a driven orb you can fly with a slider.
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'ground', backend: 'analytic' },
        { type: 'sphere', parameters: { radius: 0.5 }, material: 'chrome', transform: { position: { param: 'grand.orb', default: [0, 3.2, 0] } }, name: 'orb' },
        // Three distinct cactus MESHES (each its own table leaf + BLAS).
        { ...cactus, transform: { position: [-4.5, 0, -3], rotation: { axis: [0, 1, 0], angle: 0.8 }, scale: 1.6 }, name: 'cactus_a' },
        { ...cactus, transform: { position: [4.2, 0, -4], rotation: { axis: [0, 1, 0], angle: 2.4 }, scale: 2.0 }, name: 'cactus_b' },
        { ...cactus, transform: { position: [0.5, 0, -6], rotation: { axis: [0, 1, 0], angle: 4.1 }, scale: 1.3 }, name: 'cactus_c' },
        // A 150-instance pebble batch (ONE table leaf → its own TLAS).
        instance({ type: 'sphere', parameters: { radius: 0.16 }, material: 'accent' },
            scatter(150, 8.5, { y: 0.16, seed: 9, scaleMin: 0.5, scaleMax: 1.4 }), 'pebbles'),
    ];
    // ~250 unique spheres — sizes, positions, colors all distinct.
    for (let i = 0; i < 250; i++) {
        const r = 0.12 + rnd() * rnd() * 0.55;
        objects.push({
            type: 'sphere',
            parameters: { center: [(rnd() * 2 - 1) * 9, r + rnd() * 2.2, (rnd() * 2 - 1) * 9], radius: r },
            material: mat(),
        });
    }
    // ~60 floating tiles.
    for (let i = 0; i < 60; i++) {
        const w = 0.4 + rnd() * 0.9;
        objects.push({
            type: 'quad',
            parameters: {
                corner: [(rnd() * 2 - 1) * 8.5, 1.2 + rnd() * 3.2, (rnd() * 2 - 1) * 8.5],
                edge1: [w, 0, (rnd() - 0.5) * 0.4], edge2: [(rnd() - 0.5) * 0.4, 0, w],
            },
            material: mat(),
        });
    }
    // ~40 tilted disks.
    for (let i = 0; i < 40; i++) {
        objects.push({
            type: 'disk',
            parameters: {
                center: [(rnd() * 2 - 1) * 8, 0.8 + rnd() * 2.8, (rnd() * 2 - 1) * 8],
                radius: 0.2 + rnd() * 0.35,
                normal: [rnd() - 0.5, 0.6 + rnd() * 0.6, rnd() - 0.5],
            },
            material: mat(),
        });
    }
    return { objects, materials };
}

const built = build();

export const grandBazaarScene: SceneDescription = {
    id: 'grand-bazaar',
    name: 'Grand Bazaar (~500 objects, one scene TLAS)',
    ambientSpace: { type: 'euclidean' },
    objects: built.objects,
    materials: built.materials,
    lights: [{ kind: 'point', position: [6, 12, 7], emission: 420 }],
    environment: { type: 'constant', color: [0.16, 0.2, 0.3], intensity: 1.0 },
};

const base: RenderStrategy = {
    id: 'table',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, objectDispatch: 'table', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const grandBazaarStrategy: RenderStrategy = withPose(base, [0, 6.5, 13.5], [0, 1.2, 0]);
export const grandBazaarMisStrategy: RenderStrategy = {
    ...grandBazaarStrategy,
    id: 'table-mis',
    estimator: { ...grandBazaarStrategy.estimator, directLighting: 'mis' },
};
