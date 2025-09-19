/**
 * Research Path Tracer — World: SDFStub (v1)
 *
 * Purpose
 *   Minimal world module that provides two ABI functions:
 *     - bool intersectScene(Ray ray, out vec3 hitPos, out vec3 normal)
 *     - vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo)
 *
 * Model
 *   Analytic sphere at 'sphereCenter' with 'sphereRadius'. 'sphereAlbedo' is returned
 *   from shadeSurface (so you get color when a tracer hits it).
 *
 * Public ABI (v1)
 *   provides: intersectScene, shadeSurface
 *   requires: (none)
 *
 * Uniforms (unprefixed; assembler rewrites with 'g_world_sdf_stub_*')
 *   - sphereCenter : vec3
 *   - sphereRadius : float
 *   - sphereAlbedo : vec3
 *
 * Notes
 *   - Assumes 'struct Ray { vec3 origin; vec3 dir; };' is already declared by the camera
 *     earlier in the assembled shader (our assembler orders modules as [camera, world, tracer]).
 *   - No #ifdefs; one concrete variant.
 */

import type { ModuleDescriptorBase, UniformDecl } from '../../core/contracts/Descriptors';

const uniforms: UniformDecl[] = [
    { name: 'sphereCenter', type: 'vec3',  cadence: 'per_frame' },
    { name: 'sphereRadius', type: 'float', cadence: 'per_frame' },
    { name: 'sphereAlbedo', type: 'vec3',  cadence: 'per_frame' },
];

const glsl = `
  // World uniforms (assembler will prefix)
  uniform vec3  sphereCenter;
  uniform float sphereRadius;
  uniform vec3  sphereAlbedo;

  // ABI expected order ensures Ray is declared by the camera before this module:
  // struct Ray { vec3 origin; vec3 dir; };

  // Analytic sphere intersection (returns first positive t; no epsilon fiddling in v1)
  bool intersectScene(Ray ray, out vec3 hitPos, out vec3 normal) {
    vec3 oc = ray.origin - sphereCenter;
    float b = dot(oc, ray.dir);
    float c = dot(oc, oc) - sphereRadius * sphereRadius;
    float disc = b*b - c;
    if (disc < 0.0) { return false; }
    float t = -b - sqrt(max(disc, 0.0));
    if (t <= 0.0) {
      t = -b + sqrt(max(disc, 0.0));
      if (t <= 0.0) return false;
    }
    hitPos = ray.origin + t * ray.dir;
    normal = normalize(hitPos - sphereCenter);
    return true;
  }

  // Trivial "material": return albedo; a tracer can multiply with lighting
  vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo) {
    return sphereAlbedo;
  }
` as const;

const SDFStubWorld: ModuleDescriptorBase = {
    id: 'world.sdf_stub',
    version: '1.0.0',
    provides: [
        { name: 'intersectScene', stage: 'fragment' },
        { name: 'shadeSurface',   stage: 'fragment' },
    ],
    uniforms,
    glsl,
};

export default SDFStubWorld;
