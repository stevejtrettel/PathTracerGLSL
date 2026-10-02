import type { AovDescriptor } from '../index.js';
import glsl from './albedo.glsl?raw';

/** Albedo in [0, 1] per channel: saved raw ('hdr') or shown and saved clamped and sRGB-encoded. */
export const albedo: AovDescriptor = {
    name: 'albedo',
    glsl,
    requires: ['material_albedo'],
    picture: { name: 'albedo', output: 'fragAlbedo', previous: 'u_previousAlbedo', display: 'u_albedo', view: 'unit', formats: ['hdr', 'png'] },
};
