// The shader constants that witness expected values depend on, read from the GLSL that
// defines them, so a fixture never holds a copy of the number.

import mathGLSL from '../../../src/glsl/core/math.glsl?raw';
import { AMBIENT_SPACES } from '../../../src/components/ambient/index.js';
import { glslDefine } from '../../helpers/glslDefine.js';

/** The far clip, where the sky and the sun are found: the Euclidean ambient occupant's default
 *  (witness scenes that read it are Euclidean and author no farClip). */
export const MAX_DIST = AMBIENT_SPACES.euclidean.farClip;
/** How far short of the light point a shadow ray stops (math.glsl). */
export const SHADOW_BACKOFF = glslDefine(mathGLSL, 'SHADOW_BACKOFF');
