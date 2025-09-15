/**
 * Purpose: Minimal diffuse surface interaction compliant with Geometry ABI.
 * Public contract: ScatterEval scatter_eval(int matID, vec3 p, mat3 TBN, vec3 wi_world, vec3 wo_world);
 * Inputs: Material albedo (uniform or texture), local frame via Geometry.localFrame.
 * Outputs: ScatterEval.weight = albedo/pi * max(cosTheta,0); no sampling/pdf in v1.
 * Lifecycle: Called at first-hit shading in one-shot tracer; extended with sample/pdf in v2.
 * Invariants: Uses toLocal/toWorld; no Euclidean dot products directly; energy-conserving.
 */
