/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { isKnownCode } from '../../src/errors/core/codes.js';

// Read compiler + renderer-validation source at test time via Vite's raw glob import
// (no node:fs needed, so the suite typechecks without @types/node).
const sources: Record<string, string> = {
    ...import.meta.glob('../../src/compiler/**/*.ts', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob('../../src/errors/compiler/**/*.ts', { query: '?raw', import: 'default', eager: true }),
};

/** Every string-literal diagnostic code emitted, mapped to the file it first appeared in. */
function emittedCodes(): Map<string, string> {
    // `\s*` spans newlines, so multi-line `.addError(\n  'code', ...)` calls are caught too.
    const re = /\.(?:error|warning|info|hint|addError|addWarning)\(\s*['"]([a-z0-9-]+)['"]/g;
    const found = new Map<string, string>();
    for (const [path, text] of Object.entries(sources)) {
        if (path.endsWith('.test.ts')) continue;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            if (!found.has(m[1])) found.set(m[1], path);
        }
    }
    return found;
}

describe('diagnostic code registry', () => {
    it('finds a non-trivial number of emitted codes (guards the scanner itself)', () => {
        expect(emittedCodes().size).toBeGreaterThan(10);
    });

    it('every diagnostic code the compiler emits is registered in codes.ts', () => {
        const unregistered: string[] = [];
        for (const [code, file] of emittedCodes()) {
            if (!isKnownCode(code)) unregistered.push(`${code} (in ${file})`);
        }
        expect(unregistered).toEqual([]);
    });
});
