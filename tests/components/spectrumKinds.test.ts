// The spectrum-kind registry (docs/claude-spectrum-spec.md, step 1): every authored spectrum
// value has one kind, and code outside components/color/ asks the kind instead of testing for
// a particular one.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { SPECTRUM_KINDS, kindOf, namedKindOf, rgbKind } from '../../src/components/color/spectra/index.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { sceneSuite, isAsyncSceneEntry } from '../../pages/registry.js';

const SRC = resolve(__dirname, '../../src');
const SPECTRA = join(SRC, 'components/color/spectra');

function tsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        return e.isDirectory() ? tsFiles(p) : e.name.endsWith('.ts') ? [p] : [];
    });
}

// Run-time tests for a particular kind: its predicates, its kind object, a comparison of a
// kind's id to a name, or a check for its authored key.
const KIND_TEST = /\b(isBlackbody|isCauchyIndex|isSellmeierIndex|isSpectralIndex|indexIsDispersive|evaluateIndex|indexForm|emitBlackbody|isGaussian|rgbKind|blackbodyKind|cauchyKind|sellmeierKind|gaussianKind)\b|\.id\s*[!=]==?\s*'(rgb|blackbody|cauchy|sellmeier|gaussian)'|'(blackbody|cauchy|sellmeier|gaussian)'\s+in\b/g;

const ALLOWED: Record<string, number> = {};

describe('spectrum kinds', () => {
    it('code outside color/spectra/ asks the kind, except the listed uses', () => {
        const found: Record<string, number> = {};
        for (const file of tsFiles(SRC)) {
            if (file.startsWith(SPECTRA)) continue;
            const lines = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(import|export)\s.*from\s/.test(l));
            const n = lines.reduce((sum, l) => sum + (l.match(KIND_TEST)?.length ?? 0), 0);
            if (n > 0) found[relative(SRC, file)] = n;
        }
        expect(found).toEqual(ALLOWED);
    });

    it('code outside color/spectra/ never compares a kind against a literal role', () => {
        // A setting's role comes from the setting (its descriptor row), never from the kind of
        // value in it. Asking whether a kind may sit in a setting compares against that
        // setting's role variable, which this pattern does not match.
        const found: string[] = [];
        for (const file of tsFiles(SRC)) {
            if (file.startsWith(SPECTRA)) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (/roles\.includes\(\s*['"]/.test(line)) found.push(`${relative(SRC, file)}:${i + 1}`);
            });
        }
        expect(found).toEqual([]);
    });

    it('every spectrum reaches the shader through its kind: only generate/color.ts writes the RGB lift', () => {
        // A setting's GLSL is its kind's (emitSpectrum); a number computed in GLSL is the
        // expression binding. Only the RGB kind converts RGB to a spectrum, and its lift is
        // built in generate/color.ts.
        const found: string[] = [];
        for (const file of tsFiles(SRC)) {
            if (relative(SRC, file) === 'compiler/generate/color.ts') continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // prose may name the lift
                if (/\bemitColor\(|color_lift_/.test(line)) found.push(`${relative(SRC, file)}:${i + 1}`);
            });
        }
        expect(found).toEqual([]);
    });

    it('a kind that may be emission, other than rgb, states its light-table row, with its own code', () => {
        // A light-table row keeps an emission kind whole in its header; code 0 is RGB's plain
        // color. A kind without a row form would be read as its RGB stand-in under the light
        // tree while hits see the true spectrum.
        const emitting = SPECTRUM_KINDS.filter((k) => k !== rgbKind && k.roles.includes('emission'));
        for (const k of emitting) expect(k.packed, k.id).toBeDefined();
        const codes = SPECTRUM_KINDS.flatMap((k) => (k.packed ? [k.packed.code] : []));
        expect(codes.every((c) => c > 0)).toBe(true);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('the named kinds are disjoint and plain values are the rgb kind', () => {
        const examples: Record<string, unknown> = {
            blackbody: { blackbody: { kelvin: 3000, scale: 2 } },
            cauchy: { cauchy: [1.5, 0.004] },
            sellmeier: { sellmeier: { B: [1, 0, 0], C: [0.01, 0, 0] } },
            gaussian: { gaussian: { center: 610, width: 25, peak: 0.85, floor: 0.04 } },
        };
        for (const [id, value] of Object.entries(examples)) {
            expect(SPECTRUM_KINDS.filter((k) => k !== rgbKind && k.is(value)).map((k) => k.id)).toEqual([id]);
        }
        for (const plain of [0.5, [0.1, 0.2, 0.3], { param: 'a.b', default: 1 }, { kind: 'glsl', source: 'vec3(1.0)' }, undefined]) {
            expect(kindOf(plain)).toBe(rgbKind);
        }
    });

    it('every spectrum value in the suite has one kind, allowed in its slot', () => {
        let checked = 0;
        const check = (value: unknown, role: string, where: string) => {
            if (value === undefined) return;
            const named = SPECTRUM_KINDS.filter((k) => k !== rgbKind && k.is(value));
            expect(named.length, `${where}: ${named.map((k) => k.id)}`).toBeLessThanOrEqual(1);
            expect(kindOf(value).roles, where).toContain(role);
            checked++;
        };
        for (const [id, entry] of Object.entries(sceneSuite)) {
            if (isAsyncSceneEntry(entry)) continue;
            const scene = entry.scene;
            for (const [name, mat] of Object.entries(scene.materials)) {
                for (const row of MATERIAL_MODELS[mat.model]?.properties ?? []) {
                    if (row.role !== undefined) check((mat as unknown as Record<string, unknown>)[row.source], row.role, `${id} material ${name}.${row.source}`);
                }
                for (const f of ['sigma_a', 'sigma_s'] as const) check(mat.medium?.[f], 'coefficient', `${id} medium ${name}.${f}`);
                check(mat.medium?.emission, 'emission', `${id} medium ${name}.emission`);
                check(mat.medium?.ior, 'index', `${id} medium ${name}.ior`);
            }
            scene.lights.forEach((l, i) => check(l.emission, 'emission', `${id} light ${i}`));
            if (scene.environment?.type === 'constant') check(scene.environment.color, 'emission', `${id} sky`);
        }
        expect(checked).toBeGreaterThan(500);
    });

    it('namedKindOf finds nothing in a plain value', () => {
        expect(namedKindOf(1)).toBeUndefined();
        expect(namedKindOf({ param: 'x', default: [1, 1, 1] })).toBeUndefined();
    });
});
