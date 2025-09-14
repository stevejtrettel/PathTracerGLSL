/**
 * Purpose: Orchestrate a frame: build (or reuse) passes, bind a per-frame parameter snapshot, run trace → film → develop, handle resize & ping-pong.
 * Public contract: class Engine { constructor(ctx); setModules(mods); render(); resize(w,h); }
 * Inputs: Active module descriptors (camera/sampler/tracer/world/film/developer), ParameterStore snapshot, ResourcePool, ShaderProgram/AssemblerLite.
 * Outputs: Executed passes, updated ping-pong textures, timing logs; no research values returned synchronously.
 * Lifecycle: init (construct) → build pipeline (on modules or size change) → per-frame render() → dispose on teardown.
 * Invariants: No algorithm semantics here (no “path tracing” logic); never mutates research modules; one immutable param snapshot per frame; no CPU readbacks in the loop.
 */
