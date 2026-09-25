// Fisheye camera descriptor. The four sub-projections differ ONLY in the radial map
// theta(rho) — four static functions in fisheye.glsl; the compiler aliases FISHEYE_THETA to
// the one `projection` selects (a function-selector #define — the projection is STRUCTURAL,
// part of the integral, so choosing it recompiles). `fov` (full angular field, radians) is a
// live control feeding u_fisheyeK, a projection-specific radial constant precomputed on the
// CPU (so the radial map takes NO transcendental per ray). See fisheye.md for the r(θ) forms.

import type { CameraModelDescriptor, CameraControl, CameraDerived } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import fisheyeGLSL from './fisheye.glsl?raw';

const FOV_PATH = 'camera.fisheyeFov';

/** u_fisheyeK = the projection's radial constant, so FISHEYE_THETA(rho, K) is trig-free.
 *  θmax = fov/2; each projection folds its per-ray transcendental of θmax into K:
 *    equidistant  θ = rho·K          K = θmax
 *    equisolid    θ = 2·asin(rho·K)  K = sin(θmax/2)
 *    stereographic θ = 2·atan(rho·K) K = tan(θmax/2)
 *    orthographic θ = asin(rho·K)    K = sin(θmax) */
function fisheyeK(projection: string, fov: number): number {
    const tmax = fov * 0.5;
    switch (projection) {
        case 'equisolid': return Math.sin(tmax * 0.5);
        case 'stereographic': return Math.tan(tmax * 0.5);
        case 'orthographic': return Math.sin(tmax);
        default: return tmax;   // equidistant
    }
}

/** The widest full field each radial map represents: θ(ρ) must stay monotone up to θmax.
 *  Orthographic's sin θ peaks at θ = π/2 (fov π); stereographic's tan(θ/2) diverges at θ = π
 *  (fov 2π, exclusive); equidistant and equisolid reach the full sphere (fov 2π). Past these
 *  K stops growing or blows up and the image folds back or collapses to the axis. */
function maxFov(projection: string): { max: number; inclusive: boolean } {
    if (projection === 'orthographic') return { max: Math.PI, inclusive: true };
    if (projection === 'stereographic') return { max: 2 * Math.PI, inclusive: false };
    return { max: 2 * Math.PI, inclusive: true };
}

export const fisheyeDescriptor: CameraModelDescriptor = {
    type: 'fisheye',
    glsl: fisheyeGLSL,
    authoredParams: [
        { name: 'fov', shape: 'number', required: true, constraint: { kind: 'positive' } },   // full angular field, radians
        { name: 'projection', shape: 'enum', required: true, values: ['equidistant', 'equisolid', 'stereographic', 'orthographic'] },
    ],
    validateAuthored(cam) {
        const projection = cam.projection as string;
        const fov = cam.fov as number;
        const { max, inclusive } = maxFov(projection);
        return (inclusive ? fov <= max : fov < max) ? [] : [
            `fisheye '${projection}' fov must be ${inclusive ? '≤' : '<'} ${max === Math.PI ? 'π' : '2π'} radians (the full field its radial map can represent; got ${fov})`,
        ];
    },
    controls(cam: CameraDesc): CameraControl[] {
        if (cam.type !== 'fisheye') throw new Error('fisheye descriptor got a non-fisheye camera');
        // Feeds u_fisheyeK only (not read raw) — the full angular field.
        const { max, inclusive } = maxFov(cam.projection as string);
        return [{ path: FOV_PATH, name: 'Fisheye FOV', default: cam.fov as number, range: [1.0, inclusive ? max : max * 0.999] }];
    },
    derived(cam: CameraDesc): CameraDerived[] {
        if (cam.type !== 'fisheye') throw new Error('fisheye descriptor got a non-fisheye camera');
        const projection = cam.projection as string;
        return [{
            uniform: 'u_fisheyeK', type: 'float', inputs: [FOV_PATH],
            fn: (v) => fisheyeK(projection, (v[FOV_PATH] as number) ?? (cam.fov as number)),
        }];
    },
    defines(cam: CameraDesc): Record<string, string> {
        if (cam.type !== 'fisheye') throw new Error('fisheye descriptor got a non-fisheye camera');
        return { FISHEYE_THETA: `fisheye_theta_${cam.projection as string}` };
    },
};
