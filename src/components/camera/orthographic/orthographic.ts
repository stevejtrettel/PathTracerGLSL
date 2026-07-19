// Orthographic camera descriptor. Model-unique param: scale (world half-height of the
// view), a live slider that triggers accumulation reset (it changes the INTEGRAL — the
// projection is measurement). No fov, no aperture. See orthographic.md.

import type { CameraModelDescriptor, CameraControl } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import orthographicGLSL from './orthographic.glsl?raw';

export const orthographicDescriptor: CameraModelDescriptor = {
    type: 'orthographic',
    glsl: orthographicGLSL,
    authoredParams: [
        { name: 'scale', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    controls(cam: CameraDesc): CameraControl[] {
        if (cam.type !== 'orthographic') throw new Error('orthographic descriptor got a non-orthographic camera');
        // Read RAW by the shader (pass-through) — the film-plane half-height.
        return [
            // 'camera.orthoScale' (D5): 'scale' alone is ambiguous across models; aperture/
            // focusDistance stay generic-shared (universal lens vocabulary, a future
            // realistic lens SHOULD share them) — ambiguity, not genericity, is the enemy.
            { path: 'camera.orthoScale', uniform: 'u_orthoScale', name: 'Ortho Scale', default: cam.scale as number, range: [0.1, 20] },
        ];
    },
};
