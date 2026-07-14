// Thin-lens camera descriptor. Model-unique params: aperture (lens radius) and
// focusDistance, both live sliders that trigger accumulation reset (they change the
// INTEGRAL — defocus is measurement, §6.2). fov is shared plumbing (handled by the
// feature). See thinlens.md for the math.

import type { CameraModelDescriptor, CameraParam } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import thinlensGLSL from './thinlens.glsl?raw';

export const thinlensDescriptor: CameraModelDescriptor = {
    type: 'thinlens',
    glsl: thinlensGLSL,
    origin: 'components/camera/thinlens/thinlens.glsl',
    params(cam: CameraDesc): CameraParam[] {
        if (cam.type !== 'thinlens') throw new Error('thinlens descriptor got a non-thinlens camera');
        return [
            { uniform: 'u_aperture', path: 'camera.aperture', name: 'Aperture', default: cam.aperture, range: [0, 1] },
            { uniform: 'u_focusDistance', path: 'camera.focusDistance', name: 'Focus Distance', default: cam.focusDistance, range: [0.1, 50] },
        ];
    },
};
