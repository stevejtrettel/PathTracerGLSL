// demos/curvedSculptureScene.ts — two marched sculptures on a floor, in H³ and in S³.
// Both sculptures are scene-local fields written once against the curved SDF vocabulary
// (components/ambient/sdf.glsl and the occupants' sdf_plane / sdf_tube), so the same GLSL source is
// the body in both spaces:
//   - the jack: a core ball, three tubes along the axes cut off by a ball, and six end balls, all
//     smooth-unioned;
//   - the lantern: a ball pierced by three tubes along the axes, carved with a rounded crease.
// Every tube is a tube about a geodesic: in H³ such tubes spread from their axes' common point less
// than straight lines would suggest (the space grows exponentially around them), and in S³ every tube
// about a great circle is a closed solid torus — cut here by a ball. The floor is a plane, the light a
// warm disk overhead; H³ adds a cool sky, S³ a cool disk light to the side.

import type { SceneDescription, RenderStrategy, Vec3 } from '../src/compiler/types.js';
import type { CurvedGeometry, Vec4 } from '../src/components/ambient/isometry.js';
import { hyperbolicGeometry } from '../src/components/ambient/hyperbolic/hyperbolic.js';
import { sphericalGeometry } from '../src/components/ambient/spherical/spherical.js';
import { mat4Apply, tangentAtOrigin } from '../src/components/ambient/isometry.js';
import { defineSDF } from '../src/components/geometry/custom.js';

const length = (name: string, def: number) => ({ name, kind: 'length' as const, shape: 'number' as const, required: false, default: def });

const JACK_GLSL = `
float jack_sdf(Point p, Jack s) {
    Point o = Point(0.0, 0.0, 0.0, 1.0);
    float arms = min(sdf_tube(p, o, Direction(1.0, 0.0, 0.0, 0.0), s.arm),
                 min(sdf_tube(p, o, Direction(0.0, 1.0, 0.0, 0.0), s.arm),
                     sdf_tube(p, o, Direction(0.0, 0.0, 1.0, 0.0), s.arm)));
    arms = max(arms, sdf_ball(p, o, s.reach));
    float tips = min(min(sdf_ball(p, sdf_point(vec3(s.reach, 0.0, 0.0)), s.tip),
                         sdf_ball(p, sdf_point(vec3(-s.reach, 0.0, 0.0)), s.tip)),
                 min(min(sdf_ball(p, sdf_point(vec3(0.0, s.reach, 0.0)), s.tip),
                         sdf_ball(p, sdf_point(vec3(0.0, -s.reach, 0.0)), s.tip)),
                     min(sdf_ball(p, sdf_point(vec3(0.0, 0.0, s.reach)), s.tip),
                         sdf_ball(p, sdf_point(vec3(0.0, 0.0, -s.reach)), s.tip))));
    float body = sdf_smooth_union(sdf_ball(p, o, s.core), arms, s.blend);
    return sdf_smooth_union(body, tips, s.blend);
}
`;

/** The jack. Its solid lies within reach + tip + blend/2 of o: two smooth unions put it inside
 *  {min(pieces) ≤ blend/2}, and every piece of that set (core, capped arms, tips) lies within
 *  reach + tip + blend/2 of o. */
export const jack = defineSDF({
    name: 'jack',
    params: [length('core', 0.15), length('arm', 0.05), length('reach', 0.32), length('tip', 0.09), length('blend', 0.08)],
    glsl: { hyperbolic: JACK_GLSL, spherical: JACK_GLSL },
    marchBound: { type: 'sphere', values: (v) => ({ radius: (v.reach as number) + (v.tip as number) + 0.5 * (v.blend as number) + 0.01 }) },
});

const LANTERN_GLSL = `
float lantern_sdf(Point p, Lantern s) {
    Point o = Point(0.0, 0.0, 0.0, 1.0);
    float holes = min(sdf_tube(p, o, Direction(1.0, 0.0, 0.0, 0.0), s.hole),
                  min(sdf_tube(p, o, Direction(0.0, 1.0, 0.0, 0.0), s.hole),
                      sdf_tube(p, o, Direction(0.0, 0.0, 1.0, 0.0), s.hole)));
    return sdf_smooth_subtraction(sdf_ball(p, o, s.radius), holes, s.blend);
}
`;

/** The lantern: a ball with three tunnels. The smooth subtraction is never below the hard one (a
 *  smooth maximum is at least the maximum), so it removes material only and the ball bounds it. */
export const lantern = defineSDF({
    name: 'lantern',
    params: [length('radius', 0.3), length('hole', 0.13), length('blend', 0.06)],
    glsl: { hyperbolic: LANTERN_GLSL, spherical: LANTERN_GLSL },
    marchBound: { type: 'sphere', values: (v) => ({ radius: (v.radius as number) + 0.01 }) },
});

const FLOOR = 0.6;   // the floor plane's distance below o

/** The center (exp coordinates at o) of a body whose lowest point sits `lift` above the floor at
 *  geodesic polar coordinates (ρ, θ) about the floor's foot point exp_o((0, −FLOOR, 0)): the point
 *  `lift` along the floor's normal there. */
function standing(geom: CurvedGeometry, rho: number, theta: number, lift: number): Vec3 {
    const T = geom.transvection([0, -FLOOR, 0]);
    const f = mat4Apply(T, geom.exp([rho * Math.cos(theta), 0, rho * Math.sin(theta)]));
    const n = mat4Apply(T, tangentAtOrigin([0, 1, 0]));
    const hyperbolic = geom === hyperbolicGeometry;
    const a = hyperbolic ? Math.cosh(lift) : Math.cos(lift), b = hyperbolic ? Math.sinh(lift) : Math.sin(lift);
    return geom.log(f.map((x, i) => a * x + b * n[i]) as Vec4);
}

const materials = {
    floor: { model: 'lambert' as const, albedo: [0.62, 0.6, 0.56] as Vec3 },
    terracotta: { model: 'lambert' as const, albedo: [0.78, 0.42, 0.28] as Vec3 },
    bone: { model: 'lambert' as const, albedo: [0.86, 0.83, 0.76] as Vec3 },
    slate: { model: 'lambert' as const, albedo: [0.34, 0.44, 0.7] as Vec3 },
};

function sculptures(geom: CurvedGeometry): SceneDescription['objects'] {
    return [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: FLOOR }, material: 'floor' },
        // The jack floats a little above the floor, turned so no axis is vertical.
        { type: jack, name: 'jack', parameters: {}, material: 'terracotta', transform: { position: standing(geom, 0.4, 3.5, 0.46), rotation: { axis: [1, 0.4, 0.2], angle: 0.7 } } },
        // The lantern rests on the floor (its radius is its lowest point's height).
        { type: lantern, name: 'lantern', parameters: {}, material: 'bone', transform: { position: standing(geom, 0.42, 5.9, 0.3), rotation: { axis: [0, 1, 0], angle: 0.5 } } },
        // A small closed-form ball for scale, beside them.
        { type: 'sphere', parameters: { center: standing(geom, 0.55, 4.75, 0.1), radius: 0.1 }, material: 'slate' },
    ];
}

export const hyperbolicSculptureScene: SceneDescription = {
    id: 'hyperbolic-sculpture',
    name: 'Marched Sculptures (H³)',
    ambientSpace: { type: 'hyperbolic' },
    objects: sculptures(hyperbolicGeometry),
    materials,
    lights: [{ kind: 'disk', position: [0.2, 0.95, 0.3], normal: [0, -1, 0], radius: 0.5, emission: [11.0, 9.2, 7.0] }],
    environment: { type: 'constant', color: [0.32, 0.42, 0.62], intensity: 0.35 },
};

export const sphericalSculptureScene: SceneDescription = {
    id: 'spherical-sculpture',
    name: 'Marched Sculptures (S³)',
    ambientSpace: { type: 'spherical' },
    objects: sculptures(sphericalGeometry),
    materials,
    lights: [
        { kind: 'disk', position: [0.2, 0.75, 0.3], normal: [0, -1, 0], radius: 0.35, emission: [11.0, 9.2, 7.0] },
        { kind: 'disk', position: [0.9, 0.2, 0.4], normal: [-1, -0.3, -0.4], radius: 0.25, emission: [2.2, 3.0, 4.6] },
    ],
};

export const sculptureMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 6 },
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'aces' } },
};
export const sculptureNeeStrategy: RenderStrategy = {
    ...sculptureMisStrategy, id: 'pt-nee', estimator: { ...sculptureMisStrategy.estimator, directLighting: 'nee' },
};
/** S³ is small (a great circle has length 2π) and the sculptures fill a 1-radian view from any
 *  distance (a ball of radius r at distance d subtends tan α = tan r / sin d), so S³ looks wider. */
export const sculptureWideMisStrategy: RenderStrategy = {
    ...sculptureMisStrategy, measurement: { ...sculptureMisStrategy.measurement, camera: { type: 'pinhole', fov: 1.5 } },
};
export const sculptureWideNeeStrategy: RenderStrategy = {
    ...sculptureWideMisStrategy, id: 'pt-nee', estimator: { ...sculptureWideMisStrategy.estimator, directLighting: 'nee' },
};
