import { describe, it, expect } from 'vitest';
import { assembleFragment, assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import type { ModuleDescriptorBase } from '../src/core/contracts/Descriptors';
import PinholeCamera from '../src/photography/camera/PinholeCamera';
import SkyOnlyTracer from '../src/photography/tracer/SkyOnly';

// whitespace-tolerant uniform assertion
function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('SkyOnly tracer descriptor', () => {
    it('has stable id, provides tracePixel, and requires generateRay', () => {
        const m = SkyOnlyTracer as ModuleDescriptorBase;
        expect(m.id).toBe('tracer.sky_only');
        expect(m.provides.some(p => p.name === 'tracePixel')).toBe(true);
        expect(m.requires?.includes('generateRay')).toBe(true);
    });

    it('fails to assemble stand-alone because it requires generateRay', () => {
        const GLUE = `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = tracePixel(v_uv); }`;
        expect(() => assembleFragment([SkyOnlyTracer], GLUE)).toThrow(); // missing generateRay
    });

    it('assembles with Pinhole camera; uniforms are prefixed', () => {
        const src = assembleTraceFragment(PinholeCamera, SkyOnlyTracer);

        // camera uniform present
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');

        // tracer uniforms present with prefix
        expectHasUniform(src, 'vec3',  'g_tracer_sky_only_skyBottom');
        expectHasUniform(src, 'vec3',  'g_tracer_sky_only_skyTop');
        expectHasUniform(src, 'vec3',  'g_tracer_sky_only_sunDir');
        expectHasUniform(src, 'vec3',  'g_tracer_sky_only_sunTint');
        expectHasUniform(src, 'float', 'g_tracer_sky_only_sunSize');
        expectHasUniform(src, 'float', 'g_tracer_sky_only_exposureEV');

        // glue calls tracePixel
        expect(src).toContain('tracePixel(v_uv)');
    });
});
