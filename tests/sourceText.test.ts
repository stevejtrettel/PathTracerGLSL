// Source files are plain text: no control bytes other than tab, newline and carriage return.
// A NUL or other control byte makes grep and ripgrep treat the file as binary and skip it,
// so code searches silently miss what it defines. Write such characters as escapes
// ('\u0000') instead.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..');
const DIRS = ['src', 'pages', 'tests', 'scripts', 'tools'];
const TEXT = /\.(ts|mts|mjs|js|glsl|md|json|html)$/;

function textFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return textFiles(p);
        return TEXT.test(e.name) ? [p] : [];
    });
}

describe('source text', () => {
    it('no source file contains control bytes other than tab, LF and CR', () => {
        const offenders: string[] = [];
        for (const dir of DIRS) {
            for (const file of textFiles(join(ROOT, dir))) {
                const bytes = readFileSync(file);
                const bad = bytes.filter((b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
                if (bad.length > 0) offenders.push(`${relative(ROOT, file)} (${bad.length})`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
