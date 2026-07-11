import { describe, it, expect } from 'vitest';
import { validateCompiledRenderer, parseBufferRef } from '../../src/errors/compiler/validation.js';
import type { CompiledRenderer, ShaderProgram } from '../../src/compiler/types.js';

function validRenderer(): CompiledRenderer {
    const shaders = new Map<string, ShaderProgram>([
        ['r-main', { vertex: 'v', fragment: 'f' }],
        ['r-display', { vertex: 'v', fragment: 'f' }],
    ]);
    return {
        id: 'r',
        shaders,
        uniforms: [],
        pipeline: {
            framebuffers: [
                { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
                { id: 'screen', type: 'screen' },
            ],
            passes: [
                { id: 'p-main', shader: 'r-main', inputs: { textures: { u_previous: 'accumulation_previous' } }, output: 'accumulation_current', execution: { type: 'once' } },
                { id: 'p-display', shader: 'r-display', inputs: { textures: { u_radiance: 'accumulation_current' } }, output: 'screen', execution: { type: 'once' } },
            ],
            postFrame: { swaps: [{ type: 'swap', buffers: ['accumulation'] }] },
        },
        exportTargets: { hdr: { bufferId: 'accumulation_previous', format: 'float' } },
    };
}

const errorCodes = (r: CompiledRenderer) => validateCompiledRenderer(r).getErrors().map(e => e.code);
const warningCodes = (r: CompiledRenderer) => validateCompiledRenderer(r).getWarnings().map(w => w.code);

describe('validateCompiledRenderer — structure', () => {
    it('a well-formed renderer produces no errors', () => {
        expect(validateCompiledRenderer(validRenderer()).hasErrors()).toBe(false);
    });
    it('flags a blank id', () => {
        const r = validRenderer(); r.id = '';
        expect(errorCodes(r)).toContain('renderer-no-id');
    });
    it('flags a renderer with no shaders', () => {
        const r = validRenderer(); r.shaders = new Map();
        expect(errorCodes(r)).toContain('renderer-no-shaders');
    });
    it('flags a renderer with no passes', () => {
        const r = validRenderer(); r.pipeline.passes = [];
        expect(errorCodes(r)).toContain('renderer-no-passes');
    });
});

describe('validateCompiledRenderer — passes', () => {
    it('flags a pass referencing an unknown shader', () => {
        const r = validRenderer(); r.pipeline.passes[0].shader = 'nope';
        expect(errorCodes(r)).toContain('pass-invalid-shader');
    });
    it('flags a pass outputting to an unknown framebuffer', () => {
        const r = validRenderer(); r.pipeline.passes[0].output = 'ghost_current';
        expect(errorCodes(r)).toContain('pass-invalid-output');
    });
    it('flags a pass binding a texture from an unknown buffer', () => {
        const r = validRenderer(); r.pipeline.passes[0].inputs = { textures: { u_x: 'ghost' } };
        expect(errorCodes(r)).toContain('pass-invalid-texture');
    });
    it('flags MRT outputs spanning multiple base framebuffers', () => {
        const r = validRenderer(); r.pipeline.passes[0].output = ['accumulation_current:0', 'screen:1'];
        expect(errorCodes(r)).toContain('pass-mrt-multiple-buffers');
    });
    it('warns on a color attachment outside 0-7', () => {
        const r = validRenderer(); r.pipeline.passes[0].output = 'accumulation_current:8';
        expect(warningCodes(r)).toContain('pass-invalid-attachment');
    });
});

describe('validateCompiledRenderer — swaps / exports / uniforms', () => {
    it('flags a swap of an unknown buffer', () => {
        const r = validRenderer(); r.pipeline.postFrame!.swaps = [{ type: 'swap', buffers: ['ghost'] }];
        expect(errorCodes(r)).toContain('swap-invalid-buffer');
    });
    it('rejects swapping a non-double_buffer (§9 rule 4 — a misdeclared swap silently no-ops at runtime)', () => {
        const r = validRenderer(); r.pipeline.postFrame!.swaps = [{ type: 'swap', buffers: ['screen'] }];
        expect(errorCodes(r)).toContain('swap-not-double-buffer');
    });
    it("rejects the unimplemented 'rotate' swap at validation instead of mid-frame", () => {
        const r = validRenderer(); r.pipeline.postFrame!.swaps = [{ type: 'rotate', buffers: ['accumulation'] }];
        expect(errorCodes(r)).toContain('swap-rotate-unsupported');
    });
    it('rejects a swap listing more than one buffer (§9 rule 4: exactly one double_buffer)', () => {
        const r = validRenderer(); r.pipeline.postFrame!.swaps = [{ type: 'swap', buffers: ['accumulation', 'accumulation'] }];
        expect(errorCodes(r)).toContain('swap-not-double-buffer');
    });
    it("requires exactly one 'screen' framebuffer (§9 rule 1)", () => {
        const r = validRenderer();
        r.pipeline.framebuffers = r.pipeline.framebuffers.filter((fb) => fb.type !== 'screen');
        r.pipeline.passes = r.pipeline.passes.filter((p) => p.output !== 'screen');
        expect(errorCodes(r)).toContain('pipeline-screen-count');
    });
    it('flags an export from an unknown buffer', () => {
        const r = validRenderer(); r.exportTargets = { hdr: { bufferId: 'ghost', format: 'float' } };
        expect(errorCodes(r)).toContain('export-invalid-buffer');
    });
    it('warns when a uniform is bound more than once', () => {
        const r = validRenderer();
        r.uniforms = [
            { uniform: 'u_a', parameters: ['a'], type: 'float', compute: () => 0 },
            { uniform: 'u_a', parameters: ['b'], type: 'float', compute: () => 0 },
        ];
        expect(warningCodes(r)).toContain('uniform-duplicate');
    });
});

describe('parseBufferRef', () => {
    it('parses a bare id', () => {
        expect(parseBufferRef('accumulation')).toEqual({ bufferId: 'accumulation', attachment: undefined });
    });
    it('strips a _current / _previous qualifier to the base id', () => {
        expect(parseBufferRef('accumulation_current').bufferId).toBe('accumulation');
        expect(parseBufferRef('accumulation_previous').bufferId).toBe('accumulation');
    });
    it('parses an attachment suffix', () => {
        expect(parseBufferRef('accumulation:2')).toEqual({ bufferId: 'accumulation', attachment: 2 });
    });
    it('parses a combined qualifier + attachment', () => {
        expect(parseBufferRef('accumulation_current:1')).toEqual({ bufferId: 'accumulation', attachment: 1 });
    });
    it('preserves underscores in the base id when stripping a qualifier', () => {
        expect(parseBufferRef('my_buffer_previous').bufferId).toBe('my_buffer');
    });
    it('treats a non-numeric suffix as not-an-attachment', () => {
        expect(parseBufferRef('buffer:x')).toEqual({ bufferId: 'buffer:x', attachment: undefined });
    });
});
