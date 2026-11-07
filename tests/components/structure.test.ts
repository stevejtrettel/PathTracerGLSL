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
    'materials', 'lights', 'volume_scattering', 'geometry', 'intersection', 'accel', 'data', 'ambient',
    'sampler', 'sensor', 'color', 'pixel', 'camera', 'accumulator', 'tonemap', 'env', 'transport', 'quotient',
];

// Family-root files that are NOT occupant folders (shared parts + registries + docs).
const ALLOWED_ROOT_FILES = new Set([
    'index.ts', 'README.md',
    'combiner.ts', 'flags.ts',            // transport shared parts
    'math_mis.glsl',                       // transport shared part (β=2 power heuristic)
    'spectrum.glsl',                       // colour shared reductions and channel selection
    'sampler_cdf.glsl',                    // env shared CDF walk
    'channels.ts', 'ledger.ts', 'pack.ts', // data substrate parts (fable-data-rail — roster/layout truth/assembly)
    'importance.ts',                       // env shared part (importance-table math — E6: mirrors the charts' Jacobians)
    'similarity.ts',                       // geometry shared part (placement algebra — fable-transforms §2)
    'custom.ts',                           // geometry shared part (defineSDF — scene-local fields, fable-sdf-contract §5.2)
    'boundCheck.ts',                       // geometry shared part (twin-sampled bound containment — the §3 gate's core)
    'basis.ts',                            // camera shared part (CPU-computed look-at frame → uniforms)
    'whiteBalance.ts',                     // tonemap shared part (the white-balance matrix, display glue every curve honors)
    'power.ts',                            // lights shared part (radiantScalar — kills the index↔occupant cycle, D5)
    'values.ts',                           // colour shared questions about authored spectrum values
    'spectrumKind.ts',                     // color/spectra shared spectrum-kind contract (docs/claude-spectrum-spec.md)
    'table.ts',                            // lights shared part (light-table layout truth — fable-light-bvh §4)
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

    it('color/spectra has its contract README and keeps each kind in a folder', () => {
        const dir = join(ROOT, 'color', 'spectra');
        expect(existsSync(join(dir, 'README.md'))).toBe(true);
        const loose = readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && !ALLOWED_ROOT_FILES.has(e.name))
            .map((e) => e.name);
        expect(loose, `loose files at color/spectra/: ${loose.join(', ')}`).toEqual([]);
        for (const kind of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
            expect(existsSync(join(dir, kind.name, 'README.md')), `color/spectra/${kind.name}/README.md`).toBe(true);
        }
    });
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
