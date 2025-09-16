/**
 * Purpose: Provide a tiny descriptor wrapper for the minimal SDF scene (no CPU acceleration data).
 * Public contract: export default { id, provides:['sceneIntersect','sceneSDF'], requires:[], glsl, uniforms? }
 * Inputs: None beyond module parameters (e.g., sphere radius) if present.
 * Outputs: GLSL fragment and parameter descriptors for the Assembler.
 * Lifecycle: Static during v1; replaced by BVH-backed descriptors in later versions.
 * Invariants: No GL calls; no file I/O; deterministic module id/version.
 */
