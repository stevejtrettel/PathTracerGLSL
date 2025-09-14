/**
 * Purpose: Represent one fullscreen draw call: program + inputs + output + viewport, and execute it.
 * Public contract: class Pass { constructor(program, bindings, target, viewport?); execute(textures, snapshot); }
 * Inputs: ShaderProgram, logical texture names → sampler uniforms, optional UBO/uniform map, output FBO or null (screen).
 * Outputs: One draw to target; no CPU-side results.
 * Lifecycle: Construct once per build; execute once per frame (or more) until rebuild.
 * Invariants: No algorithm branching; binds only by logical names resolved via reflection; uses the shared FullscreenTriangle.
 */
