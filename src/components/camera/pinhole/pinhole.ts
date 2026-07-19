// Pinhole camera descriptor — fov + u_tanFov are shared perspective plumbing (minted by the
// feature); no model-unique controls or derived values. See pinhole.md for the math.

import type { CameraModelDescriptor } from '../index.js';
import pinholeGLSL from './pinhole.glsl?raw';

export const pinholeDescriptor: CameraModelDescriptor = {
    type: 'pinhole',
    glsl: pinholeGLSL,
    authoredParams: [
        { name: 'fov', shape: 'value-number', required: true, constraint: { kind: 'positive' } },
    ],
};
