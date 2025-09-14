/**
 * Purpose: Apply a Snapshot’s parameter values to the active ShaderProgram using reflected, prefixed uniform locations.
 * Public contract: class UniformBinder { bind(gl, program, snapshot); }
 * Inputs: ShaderProgram reflection, Snapshot values, module→uniform prefix mapping.
 * Outputs: Updated GL uniforms/samplers once per pass; avoids redundant sets when possible.
 * Lifecycle: Called per pass; stateless aside from optional last-bound cache.
 * Invariants: No ad-hoc GL name strings; all names go through reflection; cadence (per_frame/on_resize/static) is respected.
 */
