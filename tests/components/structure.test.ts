// The components documentation structure, enforced (owner-decided July 2026):
// - every FAMILY root carries a README.md — the contract doc: taxonomy section, kind,
//   what an occupant must supply, how the compiler consumes it, the add-a-component
//   recipe. Documentation of the contract is not optional; it can't silently rot.
// - 1 component = 1 folder: occupant code files live inside occupant folders, not
//   loose at family roots (shared family parts — registries, combiner/flags,
//   math_mis, sampler_cdf — are the allowed root files).
// Per-occupant math docs (<name>.md) are OPTIONAL by decision — some components are
// implemented first and derived post hoc — so they are deliberately NOT asserted.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../src/components');

const FAMILIES = [
    'materials', 'lights', 'volume_scattering', 'geometry', 'ambient',
    'sampler', 'sensor', 'pixel', 'camera', 'accumulator', 'tonemap', 'env', 'transport',
];

// Family-root files that are NOT occupant folders (shared parts + registries + docs).
const ALLOWED_ROOT_FILES = new Set([
    'index.ts', 'README.md',
    'combiner.ts', 'flags.ts',            // transport shared parts
    'math_mis.glsl',                       // transport shared part (β=2 power heuristic)
    'sampler_cdf.glsl',                    // env shared CDF walk
]);

describe('components structure', () => {
    it('the library root has its overview README', () => {
        expect(existsSync(join(ROOT, 'README.md'))).toBe(true);
    });

    for (const family of FAMILIES) {
        it(`${family}/ has its contract README`, () => {
            expect(existsSync(join(ROOT, family, 'README.md'))).toBe(true);
        });

        it(`${family}/ keeps occupant code in folders (1 component = 1 folder)`, () => {
            const loose = readdirSync(join(ROOT, family), { withFileTypes: true })
                .filter((e) => e.isFile() && !ALLOWED_ROOT_FILES.has(e.name))
                .map((e) => e.name);
            expect(loose, `loose files at ${family}/ root: ${loose.join(', ')}`).toEqual([]);
        });
    }

    it('transport subfamilies keep occupant code in folders too', () => {
        for (const sub of ['techniques', 'integrators', 'volume', 'shadow']) {
            const dir = join(ROOT, 'transport', sub);
            const loose = readdirSync(dir, { withFileTypes: true })
                .filter((e) => e.isFile() && !ALLOWED_ROOT_FILES.has(e.name))
                .map((e) => e.name);
            expect(loose, `loose files at transport/${sub}/: ${loose.join(', ')}`).toEqual([]);
        }
    });
});
