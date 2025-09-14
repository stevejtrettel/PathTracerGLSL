import { describe, it, expect } from 'vitest';
import { assembleFragment, assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import type { ModuleDescriptorBase } from '../src/core/contracts/Descriptors';
import PinholeCamera from '../src/photography/camera/PinholeCamera';

// Reusable helper to tolerate whitespace
function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('PinholeCamera descriptor', () => {
    it('exposes a stable id and provides generateRay', () => {
        expect((PinholeCamera as ModuleDescriptorBase).id).toBe('camera.pinhole');
        expect(PinholeCamera.provides.some(p => p.name === 'generateRay')).toBe(true);
    });

    it('prefixes uniforms via assembler and keeps generateRay symbol present', () => {
        // Assemble *only* the camera with a trivial glue.
        const GLUE = `in vec2 v_uv; out vec4 fragColor; void main(){ vec3 z=vec3(0.0); fragColor=vec4(z,1.0); }`;
        const src = assembleFragment([PinholeCamera], GLUE);

        // Uniforms must be prefixed by module id
        expectHasUniform(src, 'mat4',  'g_camera_pinhole_cameraToWorld');
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');
        expectHasUniform(src, 'vec2',  'g_camera_pinhole_sensorShift');

        // Symbol must be present in the assembled GLSL
        expect(src).toContain('Ray generateRay(vec2 v_uv)');
    });

    it('works in trace assembly when paired with a dummy tracer', () => {
        // Minimal tracer that consumes generateRay and returns a constant
        const DummyTracer: ModuleDescriptorBase = {
            id: 'tracer._dummy_',
            version: '1.0.0',
            provides: [{ name: 'tracePixel', stage: 'fragment' }],
            requires: ['generateRay'],
            glsl: `
        struct Ray { vec3 origin; vec3 dir; };
        Ray generateRay(vec2 v_uv);
        vec4 tracePixel(vec2 v_uv) {
          Ray r = generateRay(v_uv);
          return vec4(abs(r.dir), 1.0);
        }
      `,
        };

        const src = assembleTraceFragment(PinholeCamera, DummyTracer);
        // Camera uniform should be prefixed and present
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');
        // Glue should call tracePixel
        expect(src).toContain('tracePixel(v_uv)');
    });
});
