import { describe, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { Compiler } from '../../src/compiler/Compiler.js';
import { sceneSuite } from '../../src/compiler/scenes/index.js';

/**
 * Static compile check for every generated shader (impl-plan-decision-hoist T3).
 *
 * The generated GLSL is otherwise never PARSED by anything in CI — vitest checks
 * structure and snapshots check text, but a missing brace or a mis-declared symbol in a
 * rarely-exercised (scene, strategy) combination only surfaced in a browser (review: the
 * C4 bug class, "the biggest untested surface"). This suite runs every registry pair's
 * assembled vertex + fragment shaders through glslangValidator (ES profile) — no GPU.
 *
 * KNOWN LIMIT — glslang is NOT ANGLE: it accepts constructs ANGLE rejects (notably `?:`
 * on struct operands, the media-build trap). Green here proves parse/type validity, not
 * "compiles in the browser" — ANGLE dialect quirks remain the GPU witnesses' job.
 *
 * §11.5 SLOT: when spectral lands (contracts §8), this harness compiles every pair under
 * BOTH color modes — the enforcement mechanism for the §2.5 spectral discipline.
 */

const require_ = createRequire(import.meta.url);
const binByPlatform: Record<string, string> = {
    darwin: 'glslangValidator.darwin',
    linux: 'glslangValidator.linux',
    win32: 'glslangValidator.exe',
};
const pkgDir = dirname(require_.resolve('glslang-validator-prebuilt-predownloaded/package.json'));
const bin = join(pkgDir, 'bin', binByPlatform[process.platform] ?? 'glslangValidator.linux');

let dir: string;
beforeAll(() => {
    try { chmodSync(bin, 0o755); } catch { /* already executable or read-only install */ }
    dir = mkdtempSync(join(tmpdir(), 'glsl-compile-'));
});

/** Identical sources validate once (display shaders repeat across pairs). */
const validated = new Map<string, string | null>();

function check(source: string, stageExt: 'vert' | 'frag', label: string): void {
    const cached = validated.get(source);
    if (cached !== undefined) {
        if (cached !== null) throw new Error(`${label}: ${cached}`);
        return;
    }
    const file = join(dir, `${validated.size}.${stageExt}`);
    writeFileSync(file, source);
    try {
        execFileSync(bin, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        validated.set(source, null);
    } catch (e) {
        const out = (e as { stdout?: string }).stdout ?? String(e);
        validated.set(source, out);
        throw new Error(`${label}: glslangValidator rejected the generated shader\n${out}`);
    }
}

const compiler = new Compiler();

describe('generated GLSL compiles (glslang static check)', () => {
    for (const [key, entry] of Object.entries(sceneSuite)) {
        for (const strategy of entry.strategies) {
            it(`${key} + ${strategy.id}`, () => {
                const renderer = compiler.compile(entry.scene, strategy);
                for (const [shaderId, prog] of renderer.shaders) {
                    check(prog.vertex, 'vert', `${shaderId} [vertex]`);
                    check(prog.fragment, 'frag', `${shaderId} [fragment]`);
                }
            });
        }
    }
});
