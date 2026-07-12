import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { sceneSuite } from '../../src/compiler/scenes/index.js';
import pathTraceTemplate from '../../src/compiler/generate/glsl/path_trace.glsl?raw';

/**
 * TEMPORARY — the transport split's definition of done (impl-plan-transport-split.md).
 * This file is deleted, together with path_trace.glsl, in the commit that finishes the
 * split. Do not build on it.
 *
 * Proves the item-9 transport generator byte-equivalent to the old template: for every
 * registry pair, the loop the browser's preprocessor WOULD have produced from
 * (template × this pair's defines) must be token-identical to what the generator emits.
 *
 * Both sides come from ONE compile of the real pipeline:
 *   OLD:  the path_trace.glsl fixture, preprocessed under the #defines parsed from the
 *         assembled shader header (a ~60-line TS reimplementation of the preprocessor
 *         subset the template uses: #ifdef / #if defined(..) [&& defined(..)] / #else /
 *         #endif, plus object-macro substitution for the numeric defines).
 *   NEW:  the transport blocks extracted from the same assembled shader via the source
 *         map (origin 'glsl/path_trace.glsl' today; 'generated:transport/*' after the
 *         switch), run through the SAME preprocessor (identity once the generator emits
 *         directive-free text — which is exactly the point).
 * Comments and whitespace are normalized out; the assertion is token identity.
 */

// ============================================================================
// Preprocessor subset (conditional evaluation + object-macro substitution)
// ============================================================================

export function evaluatePreprocessor(source: string, defines: Record<string, string>): string {
    const out: string[] = [];
    // Each frame: was this branch taken? are we currently emitting? has #else run?
    const stack: Array<{ active: boolean; taken: boolean; sawElse: boolean }> = [];
    const emitting = () => stack.every((f) => f.active);

    for (const line of source.split('\n')) {
        const t = line.trim();
        let m: RegExpMatchArray | null;
        if ((m = t.match(/^#ifdef\s+(\w+)\s*$/))) {
            const cond = emitting() && m[1] in defines;
            stack.push({ active: cond, taken: cond, sawElse: false });
        } else if ((m = t.match(/^#if\s+(defined\s*\(\s*\w+\s*\)(?:\s*&&\s*defined\s*\(\s*\w+\s*\))*)\s*$/))) {
            const names = [...m[1].matchAll(/defined\s*\(\s*(\w+)\s*\)/g)].map((g) => g[1]);
            const cond = emitting() && names.every((n) => n in defines);
            stack.push({ active: cond, taken: cond, sawElse: false });
        } else if (t.match(/^#else\s*$/)) {
            const f = stack[stack.length - 1];
            if (!f || f.sawElse) throw new Error(`unmatched #else: ${line}`);
            f.sawElse = true;
            f.active = !f.taken && stack.slice(0, -1).every((p) => p.active);
        } else if (t.match(/^#endif\s*$/)) {
            if (!stack.pop()) throw new Error(`unmatched #endif: ${line}`);
        } else if (t.startsWith('#if')) {
            throw new Error(`preprocessor form not supported by the evaluator: ${line}`);
        } else if (emitting()) {
            out.push(line);
        }
    }
    if (stack.length > 0) throw new Error('unterminated conditional');
    return out.join('\n');
}

/** Comment-strip + tokenize + substitute valued object macros (MAX_BOUNCES → 8). */
export function tokens(source: string, defines: Record<string, string>): string[] {
    const noComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const raw = noComments.match(/[A-Za-z_]\w*|\d+\.?\d*(?:[eE][+-]?\d+)?|\S/g) ?? [];
    const result: string[] = [];
    for (const tok of raw) {
        const val = defines[tok];
        if (val !== undefined && val !== '') {
            result.push(...(val.match(/[A-Za-z_]\w*|\d+\.?\d*(?:[eE][+-]?\d+)?|\S/g) ?? []));
        } else {
            result.push(tok);
        }
    }
    return result;
}

function parseDefines(shader: string): Record<string, string> {
    const defines: Record<string, string> = {};
    // Horizontal whitespace ONLY between name and value — \s would match the newline and
    // swallow the next line as a flag-define's "value". Values lose trailing comments
    // (some header defines carry them) so macro substitution injects clean tokens.
    for (const m of shader.matchAll(/^#define[ \t]+(\w+)[ \t]*([^\n]*)$/gm)) {
        defines[m[1]] = m[2].replace(/\/\/.*$/, '').trim();
    }
    return defines;
}

// ============================================================================
// Evaluator self-tests (commit A's actual subject — the harness must be trustworthy
// before the generator exists to be judged by it)
// ============================================================================

describe('preprocessor evaluator', () => {
    const src = [
        'always;',
        '#ifdef A', 'a_only;', '#else', 'not_a;', '#endif',
        '#if defined(A) && defined(B)', 'a_and_b;', '#endif',
        '#ifdef A', '#ifdef B', 'nested_ab;', '#else', 'a_not_b;', '#endif', '#endif',
    ].join('\n');

    it('takes both branch shapes and nests', () => {
        expect(tokens(evaluatePreprocessor(src, { A: '' }), {}))
            .toEqual(['always', ';', 'a_only', ';', 'a_not_b', ';']);
        expect(tokens(evaluatePreprocessor(src, { A: '', B: '' }), {}))
            .toEqual(['always', ';', 'a_only', ';', 'a_and_b', ';', 'nested_ab', ';']);
        expect(tokens(evaluatePreprocessor(src, {}), {}))
            .toEqual(['always', ';', 'not_a', ';']);
    });

    it('substitutes valued macros, leaves flags alone', () => {
        expect(tokens('for (int i = 0; i < MAX_BOUNCES; i++)', { MAX_BOUNCES: '8', ENABLE_NEE: '' }))
            .toEqual(['for', '(', 'int', 'i', '=', '0', ';', 'i', '<', '8', ';', 'i', '+', '+', ')']);
    });

    it('rejects preprocessor forms outside the template subset', () => {
        expect(() => evaluatePreprocessor('#if FOO > 2\nx;\n#endif', {})).toThrow(/not supported/);
    });
});

// ============================================================================
// The equivalence assertion, per registry pair
// ============================================================================

const compiler = new Compiler();

describe('transport loop token equivalence (item 9 — temporary)', () => {
    for (const [key, entry] of Object.entries(sceneSuite)) {
        for (const strategy of entry.strategies) {
            it(`${key} + ${strategy.id}`, () => {
                const renderer = compiler.compile(entry.scene, strategy);

                // Find the shader holding the transport loop + its source map.
                let shaderText: string | undefined;
                let transportText = '';
                for (const [id, sm] of renderer.sourceMaps ?? []) {
                    const blocks = sm.blocks.filter(
                        (b) => b.origin === 'glsl/path_trace.glsl' || b.origin.startsWith('generated:transport/'),
                    );
                    if (blocks.length === 0) continue;
                    shaderText = renderer.shaders.get(id)?.fragment;
                    const lines = shaderText!.split('\n');
                    transportText = blocks
                        .map((b) => lines.slice(b.startLine - 1, b.endLine).join('\n'))
                        .join('\n');
                    break;
                }
                expect(shaderText, 'no shader contains transport blocks').toBeDefined();

                const defines = parseDefines(shaderText!);
                const oldTokens = tokens(evaluatePreprocessor(pathTraceTemplate, defines), defines);
                const newTokens = tokens(evaluatePreprocessor(transportText, defines), defines);

                expect(newTokens.length).toBeGreaterThan(50);
                expect(newTokens).toContain('transport_trace');

                // Readable first-divergence report (full-array diffs are unusable).
                const n = Math.max(oldTokens.length, newTokens.length);
                for (let i = 0; i < n; i++) {
                    if (oldTokens[i] !== newTokens[i]) {
                        const ctx = (a: string[]) => a.slice(Math.max(0, i - 8), i + 8).join(' ');
                        expect.fail(
                            `first token divergence at ${i}:\n  OLD … ${ctx(oldTokens)} …\n  NEW … ${ctx(newTokens)} …`,
                        );
                    }
                }
                expect(newTokens.length).toBe(oldTokens.length);
            });
        }
    }
});
