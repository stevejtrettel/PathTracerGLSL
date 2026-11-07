// tests/witnesses/scenes/curvedSdfWitness.ts
// Marched signed-distance fields in H³ and S³: the march along geodesics, the curved SDF vocabulary
// (components/ambient/sdf.glsl, the occupants' sdf_plane / sdf_tube), the tangent-frame normal, the
// isometry placement of a marched object and the Klein-chart door.
//
//   h3-sdf-ball, s3-sdf-ball     — a lambert ball off o, marched (backend 'sdf', bounded by its own
//                                  sphere_interval), under one point light, maxBounces 1, pt-nee. The
//                                  window mean equals the closed form (closed-form hit, analytic normal,
//                                  E = I·|cos θ|/A(d) along the arc NEE takes; in S³ the window holds
//                                  points lit through the short arc and through the long arc), and the
//                                  whole frame equals the closed-form ball's (…-ref, the partner scene).
//   h3-klein-ball                — the same ball as a Euclidean defineSDF sphere of radius tanh R
//                                  evaluated in the Klein chart: the same expected value.
//   h3-sdf-furnace, s3-sdf-furnace — the camera inside a cavity whose walls are a marched field (the
//                                  complement of a smooth union of two balls, marched unbounded):
//                                  every path scores Σ_{k≤6} 0.8^k exactly. A no-leak test: every ray
//                                  from inside must find the wall and every spawn must stay inside; it
//                                  cannot see hit positions or normals, which the window checks do.
//   h3-sdf-blend, s3-sdf-blend   — a smooth-union sculpture (two balls and a capped tube), placed by a
//                                  rotation and a translation, under a point light: the window mean
//                                  against the fp64 twin (exact first hit, central-difference normal,
//                                  a shadow ray marched along the arc NEE takes).
//
// Expected values are computed by curvedSdfTwins.ts; tests/witnesses/curvedSdfTwins.test.ts recomputes
// them, so a stale constant fails vitest.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { withPose } from '../../../src/authoring/strategy.js';
import { defineSDF } from '../../../src/components/geometry/custom.js';
import { CAVITY, SCULPTURE, sculptureBound } from './curvedSdfTwins.js';

export const SDF_SIZE: [number, number] = [160, 120];
export const SDF_WINDOW: WitnessRegion = { x: 0.375, y: 0.375, w: 0.25, h: 0.25 };
export const SDF_FOV = 0.8;
export const SDF_FURNACE_VALUE = (1 - 0.8 ** 7) / (1 - 0.8);   // Σ_{k=0}^{6} 0.8^k = 3.951424
export const SDF_ALBEDO = 0.5;

// ---------------------------------------------------------------------------
// The fields
// ---------------------------------------------------------------------------

const length = (name: string, def: number) => ({ name, kind: 'length' as const, shape: 'number' as const, required: false, default: def });

/** The sculpture (SCULPTURE in the twin): one body for both curved spaces, written against the
 *  curved SDF vocabulary. */
const BLEND_GLSL = `
float curvedBlend_sdf(Point p, CurvedBlend s) {
    float balls = sdf_smooth_union(sdf_ball(p, sdf_point(vec3(s.offset, 0.0, 0.0)), s.radius),
                                   sdf_ball(p, sdf_point(vec3(-s.offset, 0.0, 0.0)), s.radius), s.k1);
    float tube = max(sdf_tube(p, Point(0.0, 0.0, 0.0, 1.0), Direction(0.0, 1.0, 0.0, 0.0), s.tube),
                     max(sdf_plane(p, Direction(0.0, 1.0, 0.0, 0.0), -s.halfLength),
                         sdf_plane(p, Direction(0.0, -1.0, 0.0, 0.0), -s.halfLength)));
    return sdf_smooth_union(balls, tube, s.k2);
}
`;

export const curvedBlend = defineSDF({
    name: 'curvedBlend',
    params: [
        length('offset', SCULPTURE.offset), length('radius', SCULPTURE.radius), length('k1', SCULPTURE.k1),
        length('tube', SCULPTURE.tube), length('halfLength', SCULPTURE.halfLength), length('k2', SCULPTURE.k2),
    ],
    glsl: { hyperbolic: BLEND_GLSL, spherical: BLEND_GLSL },
    marchBound: {
        type: 'sphere',
        values: (v) => ({ radius: sculptureBound(v as { offset: number; radius: number; k1: number; tube: number; halfLength: number; k2: number }) }),
    },
});

/** The furnace cavity (CAVITY in the twin): the solid is outside a smooth union of two balls. */
const CAVITY_GLSL = `
float curvedCavity_sdf(Point p, CurvedCavity s) {
    return -sdf_smooth_union(sdf_ball(p, sdf_point(vec3(s.offset, 0.0, 0.0)), s.radius),
                             sdf_ball(p, sdf_point(vec3(-s.offset, 0.0, 0.0)), s.radius), s.k);
}
`;

export const curvedCavity = defineSDF({
    name: 'curvedCavity',
    params: [length('offset', CAVITY.offset), length('radius', CAVITY.radius), length('k', CAVITY.k)],
    glsl: { hyperbolic: CAVITY_GLSL, spherical: CAVITY_GLSL },
    marchBound: 'unbounded',
});

/** A Euclidean sphere about the origin, served to H³ through the Klein chart. */
export const kleinBall = defineSDF({
    name: 'kleinBall',
    params: [{ name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } }],
    glsl: `
float kleinBall_sdf(vec3 p, KleinBall s) {
    return length(p) - s.radius;
}
`,
    field: (p, v) => Math.hypot(p[0], p[1], p[2]) - (v.radius as number),
    marchBound: { type: 'sphere', values: (v) => ({ radius: v.radius }) },
    kleinChart: true,
});

// ---------------------------------------------------------------------------
// (a) the marched ball, and the Klein ball
// ---------------------------------------------------------------------------

/** The balls, their point lights and the camera poses. In S³ the light sits to the side of the
 *  ball, so most of the window is lit through the long arc and the rest through the short arc. */
export const SDF_BALL = {
    hyperbolic: { center: [0.15, 0, -0.1] as Vec3, radius: 0.6, light: { position: [0.9, 1.1, 1.0] as Vec3, emission: 20 }, camera: { position: [0, 0.25, 1.3] as Vec3, target: [0.15, 0, -0.1] as Vec3 } },
    spherical: { center: [0.1, 0, -0.1] as Vec3, radius: 0.5, light: { position: [1.3, 0.3, 0] as Vec3, emission: 6 }, camera: { position: [0, 0.2, 1.2] as Vec3, target: [0.1, 0, -0.1] as Vec3 } },
};
/** Window means of (albedo/π)·E (curvedSdfTwins.test.ts recomputes them). */
export const SDF_BALL_WINDOW_MEAN = { hyperbolic: 0.2026915, spherical: 0.1434743 };

const matte = { matte: { model: 'lambert' as const, albedo: [SDF_ALBEDO, SDF_ALBEDO, SDF_ALBEDO] as Vec3 } };

const ballScene = (space: 'hyperbolic' | 'spherical', marched: boolean): SceneDescription => {
    const b = SDF_BALL[space];
    return {
        id: `${space === 'hyperbolic' ? 'h3' : 's3'}-sdf-ball${marched ? '' : '-ref'}`,
        name: `${space === 'hyperbolic' ? 'H³' : 'S³'} ${marched ? 'Marched' : 'Closed-Form'} Ball`,
        ambientSpace: { type: space },
        objects: [{ type: 'sphere', parameters: { center: b.center, radius: b.radius }, material: 'matte', ...(marched ? { backend: 'sdf' as const } : {}) }],
        materials: matte,
        lights: [{ kind: 'point', ...b.light }],
    };
};

export const h3SdfBall = ballScene('hyperbolic', true);
export const h3SdfBallRef = ballScene('hyperbolic', false);
export const s3SdfBall = ballScene('spherical', true);
export const s3SdfBallRef = ballScene('spherical', false);

export const h3KleinBall: SceneDescription = {
    id: 'h3-klein-ball',
    name: 'H³ Klein-Chart Ball',
    ambientSpace: { type: 'hyperbolic' },
    objects: [{ type: kleinBall, parameters: { radius: Math.tanh(SDF_BALL.hyperbolic.radius) }, material: 'matte', transform: { position: SDF_BALL.hyperbolic.center } }],
    materials: matte,
    lights: [{ kind: 'point', ...SDF_BALL.hyperbolic.light }],
};

export const sdfDirectStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: SDF_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// (b) the furnaces
// ---------------------------------------------------------------------------

const cavityScene = (space: 'hyperbolic' | 'spherical'): SceneDescription => ({
    id: `${space === 'hyperbolic' ? 'h3' : 's3'}-sdf-furnace`,
    name: `${space === 'hyperbolic' ? 'H³' : 'S³'} Furnace (marched cavity)`,
    ambientSpace: { type: space },
    objects: [{ type: curvedCavity, parameters: {}, material: 'furnace' }],
    materials: { furnace: { model: 'lambert', albedo: [0.8, 0.8, 0.8], emission: [1, 1, 1] } },
    lights: [],
});

export const h3SdfFurnace = cavityScene('hyperbolic');
export const s3SdfFurnace = cavityScene('spherical');

export const sdfFurnaceStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 6 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// (c) the sculpture
// ---------------------------------------------------------------------------

export const SDF_BLEND = {
    transform: { position: [0.05, 0.05, 0] as Vec3, rotation: { axis: [0, 0, 1] as Vec3, angle: 0.35 } },
    hyperbolic: { light: { position: [0.8, 1.0, 1.1] as Vec3, emission: 10 }, camera: { position: [0, 0.15, 1.1] as Vec3, target: [0, 0, 0] as Vec3 } },
    spherical: { light: { position: [0.9, 0.8, 1.0] as Vec3, emission: 2 }, camera: { position: [0, 0.2, 1.3] as Vec3, target: [0, 0, 0] as Vec3 } },
};
export const SDF_BLEND_WINDOW_MEAN = { hyperbolic: 0.1859302, spherical: 0.2352988 };

const blendScene = (space: 'hyperbolic' | 'spherical'): SceneDescription => ({
    id: `${space === 'hyperbolic' ? 'h3' : 's3'}-sdf-blend`,
    name: `${space === 'hyperbolic' ? 'H³' : 'S³'} Smooth-Union Sculpture`,
    ambientSpace: { type: space },
    objects: [{ type: curvedBlend, parameters: {}, material: 'matte', transform: SDF_BLEND.transform }],
    materials: matte,
    lights: [{ kind: 'point', ...SDF_BLEND[space].light }],
});

export const h3SdfBlend = blendScene('hyperbolic');
export const s3SdfBlend = blendScene('spherical');

// ---------------------------------------------------------------------------
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts)
// ---------------------------------------------------------------------------

const posed = (pose: { position: Vec3; target: Vec3 }, ...strategies: RenderStrategy[]) => strategies.map((s) => withPose(s, pose.position, pose.target));
const atOrigin = posed({ position: [0, 0, 0], target: [0, 0, -1] }, sdfFurnaceStrategy);

const ballEntry = (space: 'hyperbolic' | 'spherical', scene: SceneDescription, ref: SceneDescription): SceneSuiteEntry => ({
    scene,
    strategies: posed(SDF_BALL[space].camera, sdfDirectStrategy),
    exercises: `${space === 'hyperbolic' ? 'H³' : 'S³'} marched ball (backend 'sdf'): the march along geodesics in the object's frame, sphere_interval as its bound, the tangent-frame 4-tap normal mapped by isometry_direction, MARCH_CLEARANCE spawns, point-light NEE${space === 'spherical' ? ' through the short and the long arc' : ''}`,
    expected: `window mean ${SDF_BALL_WINDOW_MEAN[space]} (closed form, curvedSdfTwins.ts); the whole frame equals the closed-form ball (${ref.id})`,
    witness: {
        size: SDF_SIZE,
        spp: 64,
        checks: [
            { kind: 'mean', value: SDF_BALL_WINDOW_MEAN[space], tol: 0.002, region: SDF_WINDOW, label: `${space} marched ball = closed form` },
            { kind: 'twin', other: { scene: ref.id }, meanTol: 0.01, rmse: 0.05, label: `${space} marched ball ≡ closed-form ball` },
        ],
    },
});
const refEntry = (space: 'hyperbolic' | 'spherical', scene: SceneDescription): SceneSuiteEntry => ({
    scene,
    strategies: posed(SDF_BALL[space].camera, sdfDirectStrategy),
    exercises: `${space === 'hyperbolic' ? 'H³' : 'S³'} closed-form ball: the twin partner of the marched ball`,
    expected: `window mean ${SDF_BALL_WINDOW_MEAN[space]} (closed form)`,
    witness: {
        size: SDF_SIZE,
        spp: 64,
        checks: [{ kind: 'mean', value: SDF_BALL_WINDOW_MEAN[space], tol: 0.002, region: SDF_WINDOW, label: `${space} closed-form ball = closed form` }],
    },
});
const furnaceEntry = (space: 'hyperbolic' | 'spherical', scene: SceneDescription): SceneSuiteEntry => ({
    scene,
    strategies: atOrigin,
    exercises: `${space === 'hyperbolic' ? 'H³' : 'S³'} furnace in a marched cavity (defineSDF, the complement of a smooth union of two balls, marched unbounded): every ray from inside finds the wall, every spawn stays inside`,
    expected: `every pixel = Σ_{k≤6} 0.8^k = ${SDF_FURNACE_VALUE.toFixed(6)} exactly`,
    witness: {
        spp: 16,
        checks: [{ kind: 'mean', value: SDF_FURNACE_VALUE, tol: 0.004, label: `${space} marched-cavity furnace Σ_{k≤6} 0.8^k` }],
    },
});
const blendEntry = (space: 'hyperbolic' | 'spherical', scene: SceneDescription): SceneSuiteEntry => ({
    scene,
    strategies: posed(SDF_BLEND[space].camera, sdfDirectStrategy),
    exercises: `${space === 'hyperbolic' ? 'H³' : 'S³'} smooth-union sculpture (defineSDF over sdf_ball, sdf_tube, sdf_plane, sdf_smooth_union), placed by a rotation and a translation: the field, its march bound, the FD normal through the blend, shadow rays against the field`,
    expected: `window mean ${SDF_BLEND_WINDOW_MEAN[space]} (fp64 twin, curvedSdfTwins.ts)`,
    witness: {
        size: SDF_SIZE,
        spp: 64,
        checks: [{ kind: 'mean', value: SDF_BLEND_WINDOW_MEAN[space], tol: 0.002, region: SDF_WINDOW, label: `${space} sculpture = fp64 twin` }],
    },
});

export const curvedSdfSuite: Record<string, SceneSuiteEntry> = {
    'h3-sdf-ball': ballEntry('hyperbolic', h3SdfBall, h3SdfBallRef),
    'h3-sdf-ball-ref': refEntry('hyperbolic', h3SdfBallRef),
    'h3-klein-ball': {
        scene: h3KleinBall,
        strategies: posed(SDF_BALL.hyperbolic.camera, sdfDirectStrategy),
        exercises: 'H³ Klein-chart door: a Euclidean defineSDF sphere of radius tanh R evaluated at k(p) = p.xyz/p.w, marched unbounded — the hyperbolic ball of radius R',
        expected: `window mean ${SDF_BALL_WINDOW_MEAN.hyperbolic} (the same ball's closed form)`,
        witness: {
            size: SDF_SIZE,
            spp: 64,
            checks: [{ kind: 'mean', value: SDF_BALL_WINDOW_MEAN.hyperbolic, tol: 0.002, region: SDF_WINDOW, label: 'H³ Klein-chart ball = closed form' }],
        },
    },
    'h3-sdf-furnace': furnaceEntry('hyperbolic', h3SdfFurnace),
    'h3-sdf-blend': blendEntry('hyperbolic', h3SdfBlend),
    's3-sdf-ball': ballEntry('spherical', s3SdfBall, s3SdfBallRef),
    's3-sdf-ball-ref': refEntry('spherical', s3SdfBallRef),
    's3-sdf-furnace': furnaceEntry('spherical', s3SdfFurnace),
    's3-sdf-blend': blendEntry('spherical', s3SdfBlend),
};
