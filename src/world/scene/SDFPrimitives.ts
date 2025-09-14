/**
 * Purpose: Minimal scene made of SDF primitives and helpers, plus a simple sceneIntersect for bring-up.
 * Public contract: float sceneSDF(vec3 p); Hit sceneIntersect(Ray r);
 * Inputs: Ray from camera/tracer; optional parameters for primitive transforms.
 * Outputs: Hit{valid,p,n_geom,t,materialID} or miss; normals computed from SDF gradient.
 * Lifecycle: Compiled into shader; called per pixel or per step depending on tracer.
 * Invariants: Euclidean assumptions only; no BVH; short marching loop with safety cap.
 */
