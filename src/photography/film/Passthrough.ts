/**
 * Purpose: Film that performs no accumulation; writes the tracer's per-frame color into the semantic channel 'radiance'.
 * Public contract: FilmDescriptor { provides:['accumulate'], outputs:[{ name:'radiance', format:'rgba16f' }], glsl }
 * Inputs: u_traceColor (engine-provided binding of the tracer output), frameCount (ignored).
 * Outputs: channel 'radiance' (rgba16f). Developer consumes 'radiance' by name.
 * Lifecycle: One draw per frame; no ping-pong or persistence.
 * Invariants: No CPU readbacks; channel names are semantic (no 'current'/'accum').
 * Notes: Keeps the v1 ABI stable so you can later drop in a real accumulator without changing Developer or Engine routing.
 * v1: Default film for bring-up and deterministic tests.
 * v2: Coexists with variance/aux channels or a running-average Film.
 */

import type {
    FilmDescriptor,
    FilmOutputDecl,
} from '../../core/contracts/Descriptors';

// Declare the single semantic output this Film produces.
const outputs: FilmOutputDecl[] = [
    { name: 'radiance', format: 'rgba16f' },
];

// GLSL contract:
//  - Engine binds the tracer’s output texture to `u_traceColor` (rgba16f).
//  - Engine routes the semantic channel 'radiance' to the developer uniform `g_dev_radiance`.
//  - Assembler prefixes this module's uniforms/functions using the module id (no #ifdefs).
const glsl = `
  // Tracer output (engine binds this by convention for Film input):
  uniform sampler2D u_traceColor;

  // Fullscreen UV comes from the engine’s vertex shader; the assembled program
  // will call: vec4 outColor = accumulate(v_uv, u_prevRadiance?, u_traceColor, frameCount?).
  // This passthrough Film ignores frameCount and any previous history.

  // Entry point required by Film ABI.
  // NOTE: The engine's glue code will adapt the exact call signature to this function;
  // we keep it simple: just read u_traceColor and forward it to the 'radiance' channel.
  vec4 accumulate(vec2 v_uv) {
    return texture(u_traceColor, v_uv);
  }
` as const;

export const PassthroughFilm: FilmDescriptor = {
    id: 'film.passthrough',
    version: '1.0.0',
    provides: [{ name: 'accumulate', stage: 'fragment' }],
    outputs,
    // No additional uniforms or resources are required for passthrough.
    glsl,
};

export default PassthroughFilm;
