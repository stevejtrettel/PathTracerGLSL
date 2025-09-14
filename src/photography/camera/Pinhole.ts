/**
 * Purpose: Simple pinhole camera that maps a pixel to a primary ray via fov and cameraToWorld.
 * Public contract: ModuleDescriptor with provides:['generateRay'] and GLSL implementing Ray generateRay(ivec2 pixel, inout SampleStream s).
 * Inputs: Parameters: cameraToWorld (mat4), fov (deg), sensorShift (vec2).
 * Outputs: Primary Ray in world space; ignores lens/time in v1.
 * Lifecycle: Static shader code; parameters bound per frame by UniformBinder.
 * Invariants: No GL calls; no hardcoded uniform names (engine prefixes).
 */
