/**
 * Research Path Tracer — Film: Passthrough (v1)
 *
 * Purpose
 *   Minimal film that forwards the tracer’s per-frame color to the semantic
 *   channel 'radiance'. No accumulation/ping-pong; one-shot each frame.
 *
 * ABI (v1)
 *   provides:
 *     - vec4 film_accumulate(vec2 v_uv)
 *   outputs:
 *     - { name:'radiance', format:'rgba16f' }
 *
 * Uniforms (unprefixed; assembler rewrites with module prefix)
 *   - u_traceColor : sampler2D  (engine binds the tracer’s color buffer)
 *
 * Notes
 *   - This module doesn’t know about developer routing; the engine will bind
 *     the film’s 'radiance' to the developer’s 'g_dev_radiance' uniform.
 *   - No #ifdefs; single concrete variant.
 */

import type { FilmDescriptor, UniformDecl } from '../../core/contracts/Descriptors';

const uniforms: UniformDecl[] = [
    { name: 'u_traceColor', type: 'sampler2D', cadence: 'per_frame' },
];

const glsl = `
  uniform sampler2D u_traceColor;

  // Return the radiance sample for this pixel (no accumulation).
  vec4 film_accumulate(vec2 v_uv){
    return texture(u_traceColor, v_uv);
  }
` as const;

const PassthroughFilm: FilmDescriptor = {
    id: 'film.passthrough',
    version: '1.0.0',
    provides: [{ name: 'film_accumulate', stage: 'fragment' }],
    outputs: [{ name: 'radiance', format: 'rgba16f' }],
    uniforms,
    glsl,
};

export default PassthroughFilm;
