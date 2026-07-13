// The components dependency rule, enforced (fable-components §4):
// src/components/ is a LEAF layer — components import NOTHING from app/engine/compiler.
// One pinned nuance from the migration: contract TYPES may cross (a descriptor's
// PlannedLight parameter, the transport generator's ProgramDescription input — importing
// a type creates no runtime edge and the shapes are compiler-owned facts), but VALUES
// may not: a function or constant imported from the compiler is orchestration leaking
// into the library, the exact failure mode that killed the archive's module system.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const COMPONENTS_ROOT = resolve(__dirname, '../../src/components');
const SRC_ROOT = resolve(__dirname, '../../src');

function tsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return tsFiles(p);
        return e.name.endsWith('.ts') ? [p] : [];
    });
}

interface Import {
    specifier: string;
    typeOnly: boolean;
    line: number;
}

/** Every static import in the file (default/named/side-effect; multi-line supported). */
function importsOf(source: string): Import[] {
    const out: Import[] = [];
    const re = /^import\s+(type\s)?[^'";]*?(?:from\s+)?['"]([^'"]+)['"]/gms;
    for (const m of source.matchAll(re)) {
        out.push({
            specifier: m[2],
            typeOnly: m[1] !== undefined,
            line: source.slice(0, m.index).split('\n').length,
        });
    }
    return out;
}

describe('components purity (the leaf-layer rule)', () => {
    const files = tsFiles(COMPONENTS_ROOT);

    it('finds the library', () => {
        expect(files.length).toBeGreaterThan(10);
    });

    for (const file of files) {
        const rel = relative(SRC_ROOT, file);
        const isTest = file.endsWith('.test.ts');

        it(rel, () => {
            const violations: string[] = [];
            for (const imp of importsOf(readFileSync(file, 'utf8'))) {
                const spec = imp.specifier.replace(/\?raw$/, '');
                if (!spec.startsWith('.')) {
                    // Bare package imports: only test files (vitest) may.
                    if (!isTest) violations.push(`line ${imp.line}: package import '${imp.specifier}' in non-test component code`);
                    continue;
                }
                const target = relative(SRC_ROOT, resolve(dirname(file), spec));
                if (target.startsWith('components')) continue;               // internal: fine
                if (target.startsWith('app') || target.startsWith('engine')) {
                    violations.push(`line ${imp.line}: imports ${target} — components must not depend on app/engine at all`);
                } else if (target.startsWith('compiler')) {
                    if (!imp.typeOnly) violations.push(`line ${imp.line}: VALUE import from ${target} — only \`import type\` may cross into the compiler`);
                } else {
                    violations.push(`line ${imp.line}: imports outside src/ (${imp.specifier})`);
                }
            }
            expect(violations, violations.join('\n')).toEqual([]);
        });
    }
});
