// Equirectangular camera descriptor. No fov, no aperture — the full sphere maps to the
// image, so there are no model-unique controls or derived values (the whole configuration is
// the look-at pose the feature already owns). See equirect.md for the mapping.

import type { CameraModelDescriptor } from '../index.js';
import equirectGLSL from './equirect.glsl?raw';

export const equirectDescriptor: CameraModelDescriptor = {
    type: 'equirect',
    glsl: equirectGLSL,
};
