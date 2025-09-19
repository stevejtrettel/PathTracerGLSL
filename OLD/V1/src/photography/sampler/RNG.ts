/**
 * Purpose: Deterministic per-pixel RNG providing named sample domains for v1 (lens,time,misc).
 * Public contract: ModuleDescriptor with provides:['initStream','next1D','next2D'] GLSL; domains enumerated in metadata.
 * Inputs: Engine seeds by (pixel, frame); domain indices allocated by Engine.
 * Outputs: Reproducible 1D/2D samples per domain; stable across module swaps.
 * Lifecycle: Pure shader math; no persistent GPU resources.
 * Invariants: Never overlaps dimensions between domains; strategy can be swapped later without changing ABI.
 */
