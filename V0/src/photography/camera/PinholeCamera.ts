/**
 * Research Path Tracer — Camera: Pinhole (v1)
 *
 * Purpose
 *   Provide a rigorously minimal camera module that emits primary rays for a pinhole
 *   model. This module is purely “research side”: it declares uniforms and GLSL,
 *   but never touches WebGL. The engine/assembler handles prefixing and binding.
 *
 * Public ABI (v1)
 *   provides:
 *     - Ray generateRay(vec2 v_uv)
 *
 *   Notes:
 *     - Ray is declared here (single source of truth). Other modules should *not*
 *       redeclare `struct Ray` to avoid GLSL redefinition errors.
 *     - The function parameter `v_uv` is in [0,1]², matching the fullscreen vertex shader.
 *
 * Requires (v1)
 *   - None (reads engine system uniform g_sys_resolution injected by the assembler).
 *
 * Uniforms (unprefixed names; assembler will rewrite to a prefixed form)
 *   - cameraToWorld : mat4   (world-space transform; origin = M * [0,0,0,1], dir = M * [d,0])
 *   - fovY          : float  (vertical field of view in degrees)
 *   - sensorShift   : vec2   (small offsets in NDC space, e.g., for jitter/subpixel; default 0)
 *
 * Invariants
 *   - No #ifdefs; a single concrete implementation.
 *   - No dependency on scene/world; purely geometric projection.
 *   - Safe for headless assembly/testing (string-level only).
 */

import type { ModuleDescriptorBase, UniformDecl } from '../../core/contracts/Descriptors';

const uniforms: UniformDecl[] = [
    { name: 'cameraToWorld', type: 'mat4',  cadence: 'per_frame' },
    { name: 'fovY',          type: 'float', cadence: 'per_frame' },
    { name: 'sensorShift',   type: 'vec2',  cadence: 'per_frame' },
];

const glsl = `
  // --- Camera uniforms (assembler will prefix these names) ---
  uniform mat4  cameraToWorld;
  uniform float fovY;          // degrees (vertical FOV)
  uniform vec2  sensorShift;   // NDC shift (e.g., jitter), in [-1,1] units scaled by 0.5 below

  // --- System uniform (injected by assembler; not prefixed) ---
  // uniform vec2 g_sys_resolution;

  // --- Primary ray type (single source of truth; do not redeclare elsewhere) ---
  struct Ray { vec3 origin; vec3 dir; };

  // Project v_uv in [0,1]^2 to a camera-space direction, account for aspect, then to world.
  Ray generateRay(vec2 v_uv) {
    // 1) Map to normalized device plane: [-1,1]^2, apply optional sensorShift (in "screen" space)
    vec2 ndc = (v_uv + sensorShift) * 2.0 - 1.0;

    // 2) Aspect-corrected pinhole: y scales with tan(fovY/2); x also scales by aspect
    float aspect = max(g_sys_resolution.x / max(g_sys_resolution.y, 1e-6), 1e-6);
    float tanHalfFov = tan(radians(fovY) * 0.5);

    vec3 dirCam = normalize(vec3(ndc.x * aspect * tanHalfFov,
                                 ndc.y * tanHalfFov,
                                 -1.0));

    // 3) Transform to world: origin = camera position; dir = rotated (no translation)
    vec3 origin = (cameraToWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 dir    = normalize((cameraToWorld * vec4(dirCam, 0.0)).xyz);

    return Ray(origin, dir);
  }
` as const;

const PinholeCamera: ModuleDescriptorBase = {
    id: 'camera.pinhole',
    version: '1.0.0',
    provides: [{ name: 'generateRay', stage: 'fragment' }],
    // No `requires`: camera is self-contained (reads system resolution only).
    uniforms,
    glsl,
};

export default PinholeCamera;
