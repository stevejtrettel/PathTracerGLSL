// witnesses/scenes/drivenWitness.ts
// Stage-4 witness: driven-equals-baked (fable-transforms §8).
//
// ONE scene whose placements are {param}-driven — a driven SDF box (position +
// axis-angle + scale: the full rigid-frame wrapper tier), a driven ANALYTIC sphere
// with a local center offset (position + scale: the conjugation arm, s·center and
// s·radius live), a constant samplable LAMP (NEE — the driven box is a live
// occluder casting its shadow through scene_intersect_any), and a constant floor.
//
// The equality claim: rendered at parameter point θ, the image equals the scene
// with the SAME similarities authored as CONSTANTS (stage-2 folds/wrapper tiers).
// Two parameter points are checked — θ from the ValueParam DEFAULTS, θ′ set through
// initialParameters (the ParameterStore path a slider/graph-runtime uses) — so the
// witness covers the fp64 compute closures, the vec4 uniform uploads, AND a
// parameter change after initialization.

import type { SceneDescription, RenderStrategy, Transform } from '../../../src/compiler/types.js';

export const drivenNeeStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 8,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// Parameter point θ (the ValueParam defaults) and θ′ (set via initialParameters).
export const THETA = {
    'rig.boxPos': [1.0, -0.5, 0] as [number, number, number],
    'rig.boxAngle': 0.6,
    'rig.boxScale': 1.3,
    'rig.orbPos': [-0.9, -0.4, 0.3] as [number, number, number],
    'rig.orbScale': 1.5,
};
export const THETA2 = {
    'rig.boxPos': [0.6, -0.45, -0.4] as [number, number, number],
    'rig.boxAngle': 1.9,
    'rig.boxScale': 0.9,
    'rig.orbPos': [-0.5, -0.55, 0.6] as [number, number, number],
    'rig.orbScale': 1.0,
};

const materials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.55, 0.55, 0.55] },
    red: { model: 'lambert', albedo: [0.75, 0.25, 0.2] },
    blue: { model: 'lambert', albedo: [0.25, 0.4, 0.75] },
    lamp: { model: 'lambert', albedo: [0.0, 0.0, 0.0], emission: [9.0, 9.0, 9.0] },
};
const environment: SceneDescription['environment'] = { type: 'constant', color: [0.05, 0.07, 0.1], intensity: 1.0 };

// Constant leaves shared by every arm.
const floor_: SceneDescription['objects'][number] =
    { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'floor' };
const lamp: SceneDescription['objects'][number] = {
    type: 'quad', parameters: { corner: [-0.6, 1.9, -0.6], edge1: [1.2, 0, 0], edge2: [0, 0, 1.2] },
    material: 'lamp',
};

// LOCAL primitive params (identical in all arms — placement is the only variable).
const BOX = { halfSize: [0.35, 0.45, 0.35] };
const ORB = { center: [0.1, 0, 0], radius: 0.3 };   // nonzero center: s·center is live

/** The DRIVEN arm: every rig field is a {param} with θ as its default. */
export const drivenScene: SceneDescription = {
    id: 'driven',
    name: 'Driven placement witness',
    ambientSpace: { type: 'euclidean' },
    objects: [
        floor_,
        {
            type: 'box', parameters: BOX, material: 'red',
            transform: {
                position: { param: 'rig.boxPos', default: THETA['rig.boxPos'] },
                rotation: { axis: [0, 1, 0], angle: { param: 'rig.boxAngle', default: THETA['rig.boxAngle'], min: 0, max: 6.3 } },
                scale: { param: 'rig.boxScale', default: THETA['rig.boxScale'], min: 0.1, max: 4 },
            },
        },
        {
            type: 'sphere', parameters: ORB, material: 'blue',
            transform: {
                position: { param: 'rig.orbPos', default: THETA['rig.orbPos'] },
                scale: { param: 'rig.orbScale', default: THETA['rig.orbScale'], min: 0.1, max: 4 },
            },
        },
        lamp,
    ],
    materials,
    lights: [],
    environment,
};

/** A baked arm: the same similarities as CONSTANT transforms (stage-2 lowering). */
function bakedAt(values: typeof THETA, id: string): SceneDescription {
    const boxT: Transform = { position: values['rig.boxPos'], rotation: { axis: [0, 1, 0], angle: values['rig.boxAngle'] }, scale: values['rig.boxScale'] };
    const orbT: Transform = { position: values['rig.orbPos'], scale: values['rig.orbScale'] };
    return {
        id,
        name: `Driven witness baked reference (${id})`,
        ambientSpace: { type: 'euclidean' },
        objects: [
            floor_,
            { type: 'box', parameters: BOX, material: 'red', transform: boxT },
            { type: 'sphere', parameters: ORB, material: 'blue', transform: orbT },
            lamp,
        ],
        materials,
        lights: [],
        environment,
    };
}

export const drivenBakedTheta = bakedAt(THETA, 'driven-baked-theta');
export const drivenBakedTheta2 = bakedAt(THETA2, 'driven-baked-theta2');
