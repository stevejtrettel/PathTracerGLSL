// Fisheye camera descriptor. The four sub-projections differ ONLY in the radial map
// theta(rho) — four static functions in fisheye.glsl; the compiler aliases FISHEYE_THETA to
// the one `projection` selects (a value #define, the same mechanism as TAN_FOV). `fov` (full
// angular field, radians) is a live uniform. See fisheye.md for the r(θ) forms.

import type { CameraModelDescriptor, CameraParam } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import fisheyeGLSL from './fisheye.glsl?raw';

export const fisheyeDescriptor: CameraModelDescriptor = {
    type: 'fisheye',
    glsl: fisheyeGLSL,
    origin: 'components/camera/fisheye/fisheye.glsl',
    params(cam: CameraDesc): CameraParam[] {
        if (cam.type !== 'fisheye') throw new Error('fisheye descriptor got a non-fisheye camera');
        return [{ uniform: 'u_fisheyeFov', path: 'camera.fisheyeFov', name: 'Fisheye FOV', default: cam.fov, range: [1.0, 2.0 * Math.PI] }];
    },
    defines(cam: CameraDesc): Record<string, string> {
        if (cam.type !== 'fisheye') throw new Error('fisheye descriptor got a non-fisheye camera');
        return { FISHEYE_THETA: `fisheye_theta_${cam.projection}` };
    },
};
