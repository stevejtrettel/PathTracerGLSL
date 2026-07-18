// Thin-lens camera descriptor. Model-unique params: aperture (lens radius) and
// focusDistance, both live sliders that trigger accumulation reset (they change the
// INTEGRAL — defocus is measurement, §6.2). fov is shared plumbing (handled by the
// feature). See thinlens.md for the math.

import type { CameraModelDescriptor, CameraControl } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import thinlensGLSL from './thinlens.glsl?raw';

export const thinlensDescriptor: CameraModelDescriptor = {
    type: 'thinlens',
    glsl: thinlensGLSL,
    origin: 'components/camera/thinlens/thinlens.glsl',
    controls(cam: CameraDesc): CameraControl[] {
        if (cam.type !== 'thinlens') throw new Error('thinlens descriptor got a non-thinlens camera');
        // Both read RAW by the shader (pass-through) — no derivation.
        return [
            { path: 'camera.aperture', uniform: 'u_aperture', name: 'Aperture', default: cam.aperture, range: [0, 1] },
            { path: 'camera.focusDistance', uniform: 'u_focusDistance', name: 'Focus Distance', default: cam.focusDistance, range: [0.1, 50] },
        ];
    },
};
