/**
 * Purpose: Maintain and execute the ordered list of passes (trace → film → develop) for the active pipeline.
 * Public contract: class PassRunner { setPasses(passes); run(textures, snapshot); }
 * Inputs: Array<Pass>, texture registry (logical name → GL handle), Parameter snapshot.
 * Outputs: Draws all passes in order; returns nothing.
 * Lifecycle: Replaced when pipeline rebuilds; invoked once per frame in Engine.render().
 * Invariants: No knowledge of research semantics; strictly ordered execution; no hidden state between passes.
 */
