// Cylindrical panorama camera descriptor. One live param in DEGREES (the GLSL converts with
// radians()): hfov = horizontal sweep (the panorama width, up to 360°). The vertical field
// follows the window aspect at square pixels (see cylindrical.md) — no vfov dial, so the
// render is perspectivally correct at any window size.

import type { CameraModelDescriptor, CameraParam } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import cylindricalGLSL from './cylindrical.glsl?raw';

export const cylindricalDescriptor: CameraModelDescriptor = {
    type: 'cylindrical',
    glsl: cylindricalGLSL,
    origin: 'components/camera/cylindrical/cylindrical.glsl',
    params(cam: CameraDesc): CameraParam[] {
        if (cam.type !== 'cylindrical') throw new Error('cylindrical descriptor got a non-cylindrical camera');
        return [
            { uniform: 'u_cylHfov', path: 'camera.cylHfov', name: 'Width (°)', default: cam.hfov, range: [30, 360] },
        ];
    },
};
