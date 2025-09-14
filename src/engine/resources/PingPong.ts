/**
 * Purpose: Manage a read/write pair of same-sized textures for GPU accumulation workflows.
 * Public contract: class PingPong { read(); write(); swap(); ensure(gl,w,h,format); }
 * Inputs: ResourcePool, desired size/format.
 * Outputs: Two textures exposed as read/write handles; deterministic swap().
 * Lifecycle: Allocated on first use; reallocated on resize; persists across frames.
 * Invariants: Textures always match in size/format; swap is atomic; no CPU readbacks.
 */
