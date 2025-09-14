/**
 * Purpose: Provide an immutable view of all parameters for the duration of a frame.
 * Public contract: class Snapshot { get(path); entries(); }
 * Inputs: ParameterStore at commit time.
 * Outputs: Read-only map used by UniformBinder and Pass execution.
 * Lifecycle: Created once at frame start; discarded after frame; compared for diffs if needed.
 * Invariants: Frozen; never mutated; safe to share across passes.
 */
