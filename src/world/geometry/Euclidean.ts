/**
 * Purpose: Provide Geometry ABI for Euclidean space: local frames, transforms, geodesicStep, and basic geometryTerm.
 * Public contract: localFrame(p,n,TBN,metricDet); toLocal(w,TBN); toWorld(w,TBN); geodesicStep(r,dt); geometryTerm(...);
 * Inputs: world-space position p and geometric normal n_geom from sceneIntersect.
 * Outputs: TBN basis, metricDet=1, transformed directions; no side effects.
 * Lifecycle: Compiled into the assembled shader; called from tracer/materials per-hit.
 * Invariants: Pure functions; no WebGL; connectPoints/occludedSegment may be stubbed false in v1.
 */
