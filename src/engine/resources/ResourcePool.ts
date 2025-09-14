/**
 * Purpose: Reuse textures/FBOs keyed by (width, height, format) to avoid churn on each frame.
 * Public contract: class ResourcePool { acquireTexture(key); releaseTexture(key); acquireFbo(desc); purgeOnResize(w,h); }
 * Inputs: Requested sizes/formats; CapabilityQuery (via Context) for legality.
 * Outputs: Live Texture/Framebuffer instances for passes and ping-pong.
 * Lifecycle: Alive for engine lifetime; purges/reallocates on resize or format policy changes.
 * Invariants: Central authority for allocations; no dangling GL objects; never returns incompatible formats.
 */
