// Orthographic camera descriptor. Model-unique param: scale (world half-height of the
// view), a live slider that triggers accumulation reset (it changes the INTEGRAL — the
// projection is measurement). No fov, no aperture. See orthographic.md.

import type { CameraModelDescriptor, CameraControl } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import orthographicGLSL from './orthographic.glsl?raw';

export const orthographicDescriptor: CameraModelDescriptor = {
    type: 'orthographic',
    glsl: orthographicGLSL,
    origin: 'components/camera/orthographic/orthographic.glsl',
    controls(cam: CameraDesc): CameraControl[] {
        if (cam.type !== 'orthographic') throw new Error('orthographic descriptor got a non-orthographic camera');
        // Read RAW by the shader (pass-through) — the film-plane half-height.
        return [
            { path: 'camera.scale', uniform: 'u_orthoScale', name: 'Ortho Scale', default: cam.scale, range: [0.1, 20] },
        ];
    },
};
