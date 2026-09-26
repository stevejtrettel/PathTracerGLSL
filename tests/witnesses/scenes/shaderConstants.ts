// The shader constants that witness expected values depend on, read from the GLSL that
// defines them, so a fixture never holds a copy of the number.

import mathGLSL from '../../../src/glsl/core/math.glsl?raw';
import { glslDefine } from '../../helpers/glslDefine.js';

/** The far clip, where the sky and the sun are found (math.glsl). */
export const MAX_DIST = glslDefine(mathGLSL, 'MAX_DIST');
/** How far short of the light point a shadow ray stops (math.glsl). */
export const SHADOW_BACKOFF = glslDefine(mathGLSL, 'SHADOW_BACKOFF');
