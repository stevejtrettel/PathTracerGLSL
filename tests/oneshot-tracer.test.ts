import { describe, it, expect } from 'vitest';
import { assembleTraceFragment, assembleFragment } from '../src/engine/shaders/AssemblerLite';
import type { ModuleDescriptorBase } from '../src/core/contracts/Descriptors';

import PinholeCamera from '../src/photography/camera/PinholeCamera';
import SDFStubWorld from '../src/world/scene/SDFStub';
import OneShotTracer from '../src/photography/tracer/OneShot';

// whitespace-tolerant uniform assertion
function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('OneShot tracer descriptor', () => {
    it('has stable id, provides tracePixel, and requires camera+world symbols', () => {
        const m = OneShotTracer as ModuleDescriptorBase;
        expect(m.id).toBe('tracer.oneshot');
        expect(m.provides.some(p => p.name === 'tracePixel')).toBe(true);
        expect(m.requires?.includes('generateRay')).toBe(true);
        expect(m.requires?.includes('intersectScene')).toBe(true);
        expect(m.requires?.includes('shadeSurface')).toBe(true);
    });

    it('fails to assemble without required providers (stand-alone)', () => {
        const GLUE = `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = tracePixel(v_uv); }`;
        expect(() => assembleFragment([OneShotTracer], GLUE)).toThrow();
    });

    it('assembles with camera+world; uniforms are prefixed', () => {
        const src = assembleTraceFragment(PinholeCamera, SDFStubWorld, OneShotTracer);

        // camera uniform present
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');

        // world uniforms present
        expectHasUniform(src, 'vec3',  'g_world_sdf_stub_sphereCenter');
        expectHasUniform(src, 'float', 'g_world_sdf_stub_sphereRadius');
        expectHasUniform(src, 'vec3',  'g_world_sdf_stub_sphereAlbedo');

        // tracer uniforms present/prefixed
        expectHasUniform(src, 'vec3',  'g_tracer_oneshot_sunDir');
        expectHasUniform(src, 'vec3',  'g_tracer_oneshot_sunTint');
        expectHasUniform(src, 'float', 'g_tracer_oneshot_sunStrength');
        expectHasUniform(src, 'float', 'g_tracer_oneshot_exposureEV');

        // glue present
        expect(src).toContain('tracePixel(v_uv)');
    });
});
