// Shared glslang static-check harness (impl-plan-decision-hoist T3), extracted from
// glsl-compile.test.ts so other suites (the lights door test) can prove SYMBOL LINKAGE —
// a generated shader calling a function whose GLSL was never included only fails when
// something actually parses it.
//
// KNOWN LIMIT — glslang is NOT ANGLE: it accepts constructs ANGLE rejects (notably `?:`
// on struct operands, the media-build trap). Green here proves parse/type validity, not
// "compiles in the browser" — ANGLE dialect quirks remain the GPU witnesses' job.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const binByPlatform: Record<string, string> = {
    darwin: 'glslangValidator.darwin',
    linux: 'glslangValidator.linux',
    win32: 'glslangValidator.exe',
};
const pkgDir = dirname(require_.resolve('glslang-validator-prebuilt-predownloaded/package.json'));
const bin = join(pkgDir, 'bin', binByPlatform[process.platform] ?? 'glslangValidator.linux');

let dir: string | null = null;
/** Identical sources validate once (display shaders repeat across pairs). */
const validated = new Map<string, string | null>();

/** ANGLE-only rule glslang does NOT enforce: GLSL ES reserves any identifier
 *  containing `__` (the flatten-tree lesson — provenance names like 'ball/#0'
 *  sanitized to 'ball__0' and died at ANGLE compile while every static gate stayed
 *  green). Comments legitimately contain `__` (the '__light_n' provenance labels),
 *  so strip them before scanning. */
function checkNoReservedUnderscores(source: string, label: string): void {
    const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const m = code.match(/[A-Za-z0-9_]*__[A-Za-z0-9_]*/);
    if (m !== null) {
        throw new Error(`${label}: identifier '${m[0]}' contains '__' — reserved in GLSL ES; ANGLE rejects it even though glslang accepts it`);
    }
}

/** Throws (with glslang's output) if `source` fails the ES-profile static check. */
export function glslangCheck(source: string, stageExt: 'vert' | 'frag', label: string): void {
    checkNoReservedUnderscores(source, label);
    if (dir === null) {
        try { chmodSync(bin, 0o755); } catch { /* already executable or read-only install */ }
        dir = mkdtempSync(join(tmpdir(), 'glsl-compile-'));
    }
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
