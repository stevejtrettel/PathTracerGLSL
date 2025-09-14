import { describe, it, expect } from 'vitest';
import { assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import type { ModuleDescriptorBase } from '../src/core/contracts/Descriptors';
import PinholeCamera from '../src/photography/camera/PinholeCamera';
import SDFStubWorld from '../src/world/scene/SDFStub';

// whitespace-tolerant uniform assertion
function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('World SDFStub descriptor', () => {
    it('has stable id and provides intersectScene + shadeSurface', () => {
        const m = SDFStubWorld as ModuleDescriptorBase;
        expect(m.id).toBe('world.sdf_stub');
        const names = new Set(m.provides.map(p => p.name));
        expect(names.has('intersectScene')).toBe(true);
        expect(names.has('shadeSurface')).toBe(true);
    });

    it('assembles in a 3-module trace with a tiny tracer that requires world + camera', () => {
        // Minimal tracer that uses both world symbols; no lighting complexity
        const DummyHitTracer: ModuleDescriptorBase = {
            id: 'tracer._dummy_hit_',
            version: '1.0.0',
            provides: [{ name: 'tracePixel', stage: 'fragment' }],
            requires: ['generateRay', 'intersectScene', 'shadeSurface'],
            glsl: `
        struct Ray { vec3 origin; vec3 dir; };
        Ray generateRay(vec2 v_uv);
        bool intersectScene(Ray ray, out vec3 p, out vec3 n);
        vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo);
        vec4 tracePixel(vec2 v_uv){
          Ray r = generateRay(v_uv);
          vec3 p, n;
          bool hit = intersectScene(r, p, n);
          vec3 col = hit ? shadeSurface(p, n, -r.dir) : vec3(0.0);
          return vec4(col, 1.0);
        }
      `,
        };

        const src = assembleTraceFragment(PinholeCamera, SDFStubWorld, DummyHitTracer);

        // World uniforms should be present/prefixed
        expectHasUniform(src, 'vec3',  'g_world_sdf_stub_sphereCenter');
        expectHasUniform(src, 'float', 'g_world_sdf_stub_sphereRadius');
        expectHasUniform(src, 'vec3',  'g_world_sdf_stub_sphereAlbedo');

        // Camera uniform present
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');

        // Glue calls tracePixel
        expect(src).toContain('tracePixel(v_uv)');
    });
});
