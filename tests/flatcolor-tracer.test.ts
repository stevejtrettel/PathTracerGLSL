import { describe, it, expect } from 'vitest';
import { assembleFragment, assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import type { ModuleDescriptorBase } from '../src/core/contracts/Descriptors';
import PinholeCamera from '../src/photography/camera/PinholeCamera';
import FlatColorTracer from '../src/photography/tracer/FlatColor';

// helper (whitespace-tolerant)
function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('FlatColor tracer descriptor', () => {
    it('exposes id and provides tracePixel', () => {
        expect((FlatColorTracer as ModuleDescriptorBase).id).toBe('tracer.flat_color');
        expect(FlatColorTracer.provides.some(p => p.name === 'tracePixel')).toBe(true);
    });

    it('prefixes its uniforms when assembled stand-alone', () => {
        const GLUE = `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = tracePixel(v_uv); }`;
        const src = assembleFragment([FlatColorTracer], GLUE);

        expectHasUniform(src, 'vec3',  'g_tracer_flat_color_color');
        expectHasUniform(src, 'float', 'g_tracer_flat_color_exposureEV');
        expect(src).toContain('tracePixel(v_uv)');
    });

    it('assembles with the Pinhole camera using the trace helper', () => {
        const src = assembleTraceFragment(PinholeCamera, FlatColorTracer);

        // both modules’ uniforms should be present/prefixed
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');
        expectHasUniform(src, 'vec3',  'g_tracer_flat_color_color');

        // glue present
        expect(src).toContain('void main()');
        expect(src).toContain('tracePixel(v_uv)');
    });
});
