import { describe, it, expect } from 'vitest';
import { assembleFragment } from '../src/engine/shaders/AssemblerLite';
import PassthroughFilm from '../src/photography/film/Passthrough';

function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

describe('Film Passthrough descriptor', () => {
    it('declares outputs and provides film_accumulate', () => {
        expect(PassthroughFilm.id).toBe('film.passthrough');
        expect(PassthroughFilm.outputs?.some(o => o.name === 'radiance')).toBe(true);
        expect(PassthroughFilm.provides.some(p => p.name === 'film_accumulate')).toBe(true);
    });

    it('prefixes sampler uniform under module id', () => {
        const GLUE = `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = film_accumulate(v_uv); }`;
        const src = assembleFragment([PassthroughFilm], GLUE);

        expectHasUniform(src, 'sampler2D', 'g_film_passthrough_u_traceColor');
        expect(src).toContain('film_accumulate(v_uv)');
    });
});
