// tests/witnesses/scenes/diskWitness.ts
// The disk occupant pair's witnesses:
//   cornell-disk — X-CORNELL's sibling with a CEILING DISK light (explicit-light route →
//                  desugars to a backing disk region): concentric area sampling, the
//                  d²/(πr²·cosθ) solid-angle pdf, the adjacent pdf mirror under MIS, and
//                  the thin/one-sided machinery's SECOND tenant (quad was the only one).
//   disk-bake    — the direction-kind fold witness: an emissive disk OBJECT (sampleAsLight
//                  route) tilted via transform.rotation vs the same disk hand-authored with
//                  the rotated normal — the first witness through the KIND-DERIVED direction
//                  fold (plane's fold is a coupled override; the disk's is the derived path),
//                  through desugar → power CDF → sampler/pdf. fp64 fold ⇒ near-bit-exact.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { cornellBox } from './cornellBox.js';

// ---------------------------------------------------------------------------
// cornell-disk — ceiling disk, slightly below the ceiling plane (the cornell-area
// z-fighting discipline), normal [0,-1,0]: emitting DOWN (one-sided).
// Area πr² ≈ 0.785 of the quad panel's 1.0 — comparable brightness at the same Le.
// ---------------------------------------------------------------------------

export const cornellDisk: SceneDescription = {
    ...cornellBox,
    id: 'cornell-disk',
    name: 'Cornell + Ceiling Disk',
    lights: [
        {
            kind: 'disk',
            position: [0, 1.98, 0],
            radius: 0.5,
            normal: [0, -1, 0],
            emission: 15.0,
        },
    ],
};

export const cornellDiskNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
        maxBounces: 10,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const cornellDiskMisStrategy: RenderStrategy = {
    ...cornellDiskNeeStrategy,
    id: 'pt-mis',
    estimator: { ...cornellDiskNeeStrategy.estimator, directLighting: 'mis' },
};

export const cornellDiskPtStrategy: RenderStrategy = {
    ...cornellDiskNeeStrategy,
    id: 'pt',
    estimator: { ...cornellDiskNeeStrategy.estimator, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// disk-bake / disk-bake-ref — the direction-fold twin.
// The transform arm authors the disk CANONICALLY (center 0, normal [0,-1,0]) and places
// it with transform {position, rotation Rx(0.5)}; the ref arm hand-authors the folded
// values: center = t (rotation about the origin moves nothing at c = 0), normal =
// Rx(0.5)·[0,-1,0] = [0, −cos 0.5, −sin 0.5]. Both are EMISSIVE OBJECTS — the
// sampleAsLight route reads the FOLDED region parameters, so the fold feeds the
// registry, power CDF, sampler, and pdf in one number.
// ---------------------------------------------------------------------------

const TILT = 0.5;   // radians about +X

const diskBakeShared = {
    ambientSpace: { type: 'euclidean' } as const,
    materials: {
        floor: { model: 'lambert' as const, albedo: [0.6, 0.6, 0.65] as [number, number, number] },
        glow: { model: 'lambert' as const, albedo: [0, 0, 0] as [number, number, number], emission: 12.0 },
    },
    lights: [],
};

export const diskBake: SceneDescription = {
    ...diskBakeShared,
    id: 'disk-bake',
    name: 'Tilted Disk Lamp (transform arm)',
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        {
            type: 'disk',
            parameters: { center: [0, 0, 0], radius: 0.6, normal: [0, -1, 0] },
            material: 'glow',
            transform: { position: [0, 1.5, 0], rotation: { axis: [1, 0, 0], angle: TILT } },
            name: 'lamp',
        },
    ],
};

export const diskBakeRef: SceneDescription = {
    ...diskBakeShared,
    id: 'disk-bake-ref',
    name: 'Tilted Disk Lamp (hand-folded arm)',
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        {
            type: 'disk',
            parameters: {
                center: [0, 1.5, 0],
                radius: 0.6,
                normal: [0, -Math.cos(TILT), -Math.sin(TILT)],
            },
            material: 'glow',
            name: 'lamp',
        },
    ],
};

export const diskBakeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
