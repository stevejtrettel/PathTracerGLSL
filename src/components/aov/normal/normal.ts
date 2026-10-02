import type { AovDescriptor } from '../index.js';
import glsl from './normal.glsl?raw';

/** A signed unit vector: `.hdr` cannot store negatives, so it saves as PNG only, through the
 *  'signed' view (0.5·n + 0.5). */
export const normal: AovDescriptor = {
    name: 'normal',
    glsl,
    requires: [],
    picture: { name: 'normal', output: 'fragNormal', previous: 'u_previousNormal', display: 'u_normal', view: 'signed', formats: ['png'] },
};
