/**
 * Purpose: One-shot tracer for bring-up with two modes: environment capture or single-hit shading.
 * Public contract: ModuleDescriptor with provides:['tracePixel']; optional uniform mode selector.
 * Inputs: Camera.generateRay(), World.sceneIntersect(), Env.environmentRadiance(), Lambert.scatter_eval().
 * Outputs: vec3 radiance per pixel to 'current' target; no scratch resources.
 * Lifecycle: Runs once per frame; no bounces; no NEE or RR.
 * Invariants: No loops over bounces; no CPU readbacks; uses Geometry ABI for frames when shading a hit.
 */
