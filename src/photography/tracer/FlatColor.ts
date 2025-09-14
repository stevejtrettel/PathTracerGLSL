/**
 * Research Path Tracer — Tracer: FlatColor (v1)
 *
 * Purpose
 *   Minimal tracer that returns a constant linear RGB color. Ideal for
 *   integration sanity checks (bind a single uniform, see solid color).
 *
 * Public ABI (v1)
 *   provides:
 *     - vec4 tracePixel(vec2 v_uv)
 *
 * Requires
 *   - None (does not use generateRay; camera can be present but isn’t required)
 *
 * Uniforms (unprefixed; assembler will rewrite)
 *   - color      : vec3  (linear RGB)
 *   - exposureEV : float (scales output by 2^EV)
 *
 * Invariants
 *   - No #ifdefs; one concrete implementation.
 *   - Uses both uniforms so the compiler won’t drop them.
 */

import type { ModuleDescriptorBase, UniformDecl } from '../../core/contracts/Descriptors';

const uniforms: UniformDecl[] = [
    { name: 'color',      type: 'vec3',  cadence: 'per_frame' },
    { name: 'exposureEV', type: 'float', cadence: 'per_frame' },
];

const glsl = `
  uniform vec3  color;
  uniform float exposureEV;

  vec4 tracePixel(vec2 v_uv) {
    // color is linear; scale by photographic exposure
    vec3 c = color * exp2(exposureEV);
    return vec4(c, 1.0);
  }
` as const;

const FlatColorTracer: ModuleDescriptorBase = {
    id: 'tracer.flat_color',
    version: '1.0.0',
    provides: [{ name: 'tracePixel', stage: 'fragment' }],
    uniforms,
    glsl,
};

export default FlatColorTracer;
