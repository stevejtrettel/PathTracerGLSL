// Pinhole camera descriptor — fov + u_tanFov are shared perspective plumbing (minted by the
// feature); no model-unique controls or derived values. See pinhole.md for the math.

import type { CameraModelDescriptor } from '../index.js';
import pinholeGLSL from './pinhole.glsl?raw';

export const pinholeDescriptor: CameraModelDescriptor = {
    type: 'pinhole',
    glsl: pinholeGLSL,
    authoredParams: [
        { name: 'fov', shape: 'value-number', required: true, constraint: { kind: 'interval', min: 0, max: Math.PI } },   // RADIANS, full vertical angle: tan(fov/2) must exist — a degree value (45) is caught here
    ],
};
