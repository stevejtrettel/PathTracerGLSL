/**
 * Purpose: Register and manage hierarchical parameter descriptors and values (e.g., 'camera.fov'), producing snapshots atomically.
 * Public contract: class ParameterStore { register(descs); begin(); set(path,val); commit(): Snapshot; }
 * Inputs: Parameter descriptors from modules, runtime UI updates.
 * Outputs: Immutable per-frame Snapshot for UniformBinder.
 * Lifecycle: Long-lived; transactions (begin/set/commit) around each frame.
 * Invariants: No GL calls; no mid-frame mutations once a Snapshot is produced; typed values as declared.
 */
