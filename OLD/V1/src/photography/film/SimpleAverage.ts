/**
 * Purpose: Film that accumulates a running average of the tracer's color into channel 'radiance'.
 * Public contract: FilmDescriptor { provides:['accumulate'], outputs:[{ name:'radiance', format:'rgba16f' }], glsl }
 * Inputs: u_prevRadiance (rgba16f), u_traceColor (rgba16f), frameCount (int).
 * Outputs: 'radiance' (rgba16f) = (prev*frame + curr)/(frame+1).
 * Lifecycle: Uses internal PingPong managed by Engine for 'radiance'; swaps after pass.
 * Invariants: No hardcoded texture names; only semantic channel 'radiance' appears in the descriptor.
 * v1: Optional upgrade for progressive refinement. v2: coexists with variance/aux channels.
 */
