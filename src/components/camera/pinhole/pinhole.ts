// Pinhole camera descriptor — the sole shared-plumbing camera (fov handled by the
// feature; no model-unique params). See pinhole.md for the math.

import type { CameraModelDescriptor } from '../index.js';
import pinholeGLSL from './pinhole.glsl?raw';

export const pinholeDescriptor: CameraModelDescriptor = {
    type: 'pinhole',
    glsl: pinholeGLSL,
    origin: 'components/camera/pinhole/pinhole.glsl',
    params: () => [],
};
