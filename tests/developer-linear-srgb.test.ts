import { describe, it, expect } from 'vitest';
import { assembleFragment } from '../src/engine/shaders/AssemblerLite';
import LinearSRGBDeveloper from '../src/photography/developer/LinearSRGB';

function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('Developer Linear→sRGB descriptor', () => {
    it('declares id, provides develop, and requires channel radiance', () => {
        expect(LinearSRGBDeveloper.id).toBe('developer.linear_srgb');
        expect(LinearSRGBDeveloper.provides.some(p => p.name === 'develop')).toBe(true);
        expect(LinearSRGBDeveloper.requiresChannels.includes('radiance')).toBe(true);
    });

    it('keeps reserved g_dev_radiance unprefixed and callable', () => {
        const GLUE = `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = develop(v_uv); }`;
        const src = assembleFragment([LinearSRGBDeveloper], GLUE);

        // Reserved uniform should appear *without* module prefix.
        expectHasUniform(src, 'sampler2D', 'g_dev_radiance');

        // Function present
        expect(src).toContain('develop(v_uv)');
    });
});
