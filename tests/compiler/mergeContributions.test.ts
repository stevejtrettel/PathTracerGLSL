import { describe, it, expect } from 'vitest';
import { mergeContributions } from '../../src/compiler/generate/features/merge.js';
import { emptyContribution } from '../../src/compiler/generate/features/types.js';
import type { FeatureContribution } from '../../src/compiler/generate/features/types.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';

function contribution(over: Partial<FeatureContribution>): FeatureContribution {
    return { ...emptyContribution('test'), ...over };
}

describe('mergeContributions — blocks', () => {
    it('concatenates blocks in contribution order', () => {
        const bag = new DiagnosticBag('test');
        const merged = mergeContributions([
            contribution({ blocks: [{ origin: 'a', source: '1' }] }),
            contribution({ blocks: [{ origin: 'b', source: '2' }] }),
        ], bag);
        expect(merged.blocks.map(b => b.origin)).toEqual(['a', 'b']);
        expect(bag.hasErrors()).toBe(false);
    });
});

describe('mergeContributions — uniforms', () => {
    it('dedupes an identical uniform declared by two features (no error)', () => {
        const bag = new DiagnosticBag('test');
        const u = { name: 'u_a', type: 'float' as const, parameterPath: 'a' };
        const merged = mergeContributions([
            contribution({ uniforms: [u] }),
            contribution({ uniforms: [{ ...u }] }),
        ], bag);
        expect(merged.uniforms).toHaveLength(1);
        expect(bag.hasErrors()).toBe(false);
    });

    it('preserves first-occurrence insertion order', () => {
        const bag = new DiagnosticBag('test');
        const merged = mergeContributions([
            contribution({ uniforms: [{ name: 'u_a', type: 'float', parameterPath: 'a' }] }),
            contribution({ uniforms: [{ name: 'u_b', type: 'vec3', parameterPath: 'b' }] }),
        ], bag);
        expect(merged.uniforms.map(u => u.name)).toEqual(['u_a', 'u_b']);
    });

    it('flags a uniform-conflict when the same name has a different type', () => {
        const bag = new DiagnosticBag('test');
        mergeContributions([
            contribution({ uniforms: [{ name: 'u_a', type: 'float', parameterPath: 'a' }] }),
            contribution({ uniforms: [{ name: 'u_a', type: 'vec3', parameterPath: 'a' }] }),
        ], bag);
        expect(bag.getErrors().some(e => e.code === 'uniform-conflict')).toBe(true);
    });

    it('flags a uniform-conflict when the same name maps to a different parameter path', () => {
        const bag = new DiagnosticBag('test');
        mergeContributions([
            contribution({ uniforms: [{ name: 'u_a', type: 'float', parameterPath: 'a' }] }),
            contribution({ uniforms: [{ name: 'u_a', type: 'float', parameterPath: 'other' }] }),
        ], bag);
        expect(bag.getErrors().some(e => e.code === 'uniform-conflict')).toBe(true);
    });
});

describe('mergeContributions — textures', () => {
    it('dedupes identical textures and flags a texture-conflict on differing source', () => {
        const bag = new DiagnosticBag('test');
        const merged = mergeContributions([
            contribution({ textures: [{ name: 'u_env', source: 'extern:env_map' }] }),
            contribution({ textures: [{ name: 'u_env', source: 'extern:env_map' }] }),
            contribution({ textures: [{ name: 'u_env', source: 'extern:other' }] }),
        ], bag);
        expect(merged.textures).toHaveLength(1);
        expect(bag.getErrors().some(e => e.code === 'texture-conflict')).toBe(true);
    });
});

describe('mergeContributions — defines & parameters (last-writer-wins)', () => {
    it('later contributions overwrite an earlier define with the same key (silent)', () => {
        const bag = new DiagnosticBag('test');
        const merged = mergeContributions([
            contribution({ defines: { MAX_BOUNCES: '4' } }),
            contribution({ defines: { MAX_BOUNCES: '8' } }),
        ], bag);
        expect(merged.defines.MAX_BOUNCES).toBe('8');
        expect(bag.hasErrors()).toBe(false);
    });

    it('later contributions overwrite an earlier parameter with the same key (silent)', () => {
        const bag = new DiagnosticBag('test');
        const merged = mergeContributions([
            contribution({ parameters: { 'a.x': { type: 'float', default: 1 } } }),
            contribution({ parameters: { 'a.x': { type: 'float', default: 2 } } }),
        ], bag);
        expect(merged.parameters['a.x'].default).toBe(2);
    });
});
