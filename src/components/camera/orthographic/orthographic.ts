// Orthographic camera descriptor. Model-unique param: scale (world half-height of the
// view), a live slider that triggers accumulation reset (it changes the INTEGRAL — the
// projection is measurement). No fov, no aperture. See orthographic.md.

import type { CameraModelDescriptor, CameraParam } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import orthographicGLSL from './orthographic.glsl?raw';

export const orthographicDescriptor: CameraModelDescriptor = {
    type: 'orthographic',
    glsl: orthographicGLSL,
    origin: 'components/camera/orthographic/orthographic.glsl',
    params(cam: CameraDesc): CameraParam[] {
        if (cam.type !== 'orthographic') throw new Error('orthographic descriptor got a non-orthographic camera');
        return [
            { uniform: 'u_orthoScale', path: 'camera.scale', name: 'Ortho Scale', default: cam.scale, range: [0.1, 20] },
        ];
    },
};
