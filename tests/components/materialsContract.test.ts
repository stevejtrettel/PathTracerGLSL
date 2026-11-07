// The materials-registry contract (materials-§7): schema rows ARE the property
// vocabulary, so the registry must uphold the structural rules compiler policy
// leans on — no row source may collide with a material's meta-keys, the
// transmission capability implies a region-table row (ior_of finds it structurally,
// never by name), and emissive capability implies a row at EMISSION_KEY (the one
// name policy reads, paired with the capability).

import { describe, it, expect } from 'vitest';
import { MATERIAL_MODELS, EMISSION_KEY, modelStructFields, hasPerHitForm } from '../../src/components/materials/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../src/components/volume_scattering/index.js';
import type { PropertySchema } from '../../src/components/descriptors.js';

/** SceneMaterial keys that are NOT properties — a row source colliding with one
 *  would make the authored record ambiguous. */
const RESERVED_KEYS = new Set(['model', 'medium', 'sampleAsLight']);

describe('material model descriptors (schema-vocabulary contract)', () => {
    for (const [id, d] of Object.entries(MATERIAL_MODELS)) {
        if (d === undefined) continue;
        describe(id, () => {
            it('registry key matches descriptor id', () => {
                expect(d.id).toBe(id);
            });

            it('row sources avoid the reserved meta-keys and are unique', () => {
                const sources = d.properties.map((f) => f.source as string);
                for (const s of sources) expect(RESERVED_KEYS.has(s), `source '${s}'`).toBe(false);
                expect(new Set(sources).size).toBe(sources.length);
            });

            it('defaults are finite numbers (GLSL default strings are derived, never authored)', () => {
                for (const f of d.properties) {
                    expect(typeof f.default, `${id}.${f.name}`).toBe('number');
                    expect(Number.isFinite(f.default)).toBe(true);
                }
            });

            it('transmission capability ⇒ a region-table row (ior_of finds it structurally)', () => {
                if (d.capabilities.transmission) {
                    expect(d.properties.some((f) => f.storage === 'region-table')).toBe(true);
                }
            });

            it(`emissive capability ⇒ a row at EMISSION_KEY (the capability's paired value)`, () => {
                if (d.capabilities.emissive) {
                    expect(d.properties.some((f) => f.source === EMISSION_KEY && f.storage === 'field')).toBe(true);
                }
            });
        });
    }
});

/** Every row name declared with more than one glslType across `models`, as messages. */
function glslTypeConflicts(models: [string, PropertySchema[]][]): string[] {
    const declared = new Map<string, Map<string, string[]>>();
    for (const [id, rows] of models) {
        for (const row of rows) {
            const types = declared.get(row.name) ?? new Map<string, string[]>();
            types.set(row.glslType, [...(types.get(row.glslType) ?? []), id]);
            declared.set(row.name, types);
        }
    }
    return [...declared].filter(([, types]) => types.size > 1)
        .map(([name, types]) => `${name}: ${[...types].map(([t, ids]) => `${t} in ${ids.join(', ')}`).join('; ')}`);
}

// A scene may combine any models, and the generated properties struct holds one field per row
// name (unionFields), so a row name has one glslType across the whole registry. Derived fields
// join the struct like rows.
describe('one glslType per row name across the registry', () => {
    it('material models (rows and derived fields)', () => {
        const models = Object.values(MATERIAL_MODELS).filter((d) => d !== undefined)
            .map((d): [string, PropertySchema[]] => [d.id, modelStructFields(d)]);
        expect(glslTypeConflicts(models)).toEqual([]);
    });

    it('phase models', () => {
        const models = Object.entries(VOLUME_SCATTERING_MODELS)
            .map(([id, d]): [string, PropertySchema[]] => [id, d?.properties ?? []]);
        expect(glslTypeConflicts(models)).toEqual([]);
    });

    it('a name declared as Spectrum in one model and float in another is reported', () => {
        const row = (glslType: 'float' | 'Spectrum'): PropertySchema => ({ name: 'eta', glslType, source: 'eta', default: 1, storage: 'field' });
        expect(glslTypeConflicts([['metal', [row('Spectrum')]], ['pane', [row('float')]], ['glass', [row('float')]]]))
            .toEqual(['eta: Spectrum in metal; float in pane, glass']);
    });
});

// ============================================================================
// GLSL symbol contracts (naming batch N3 — audit P4 made explicit for the
// remaining families; geometry's contract test is the template). The generated
// dispatches emit `${id}_${op}(...)` literally — a missing/misnamed symbol used
// to surface only as a glslang compile error.
// ============================================================================

describe('material model GLSL symbols (<id>_eval/_sample/_pdf/_emission)', () => {
    for (const [id, d] of Object.entries(MATERIAL_MODELS)) {
        if (d === undefined) continue;
        it(`${id} defines all four interaction ops`, () => {
            expect(new RegExp(`Spectrum\\s+${id}_eval\\s*\\(`).test(d.glsl), `${id}_eval`).toBe(true);
            expect(new RegExp(`InteractionSample\\s+${id}_sample\\s*\\(`).test(d.glsl), `${id}_sample`).toBe(true);
            expect(new RegExp(`float\\s+${id}_pdf\\s*\\(`).test(d.glsl), `${id}_pdf`).toBe(true);
            expect(new RegExp(`Spectrum\\s+${id}_emission\\s*\\(`).test(d.glsl), `${id}_emission`).toBe(true);
        });
    }
});

// A derived field has a host form (`fn`) and may declare a per-hit form (`glsl`), used when an
// input varies over the surface. The two are one function in two languages: the per-hit form,
// read as a JavaScript expression over the GLSL builtins it uses, must agree with `fn`. It
// reads its inputs' struct fields, so each input must be a field row of the model. A name
// shared by several models is one declaration.
describe('derived material fields', () => {
    const glslBuiltins: Record<string, (...a: number[]) => number> = {
        max: Math.max, min: Math.min, clamp: (x, a, b) => Math.min(Math.max(x, a), b),
    };
    const grid = [0, 1e-4, 0.01, 0.0316, 0.05, 0.1, 0.3, 0.5, 0.77, 1, 1.5];
    for (const d of Object.values(MATERIAL_MODELS)) {
        for (const spec of d?.derived ?? []) {
            if (!hasPerHitForm(spec)) continue;
            const perHit = spec.glsl;
            it(`${d!.id}.${spec.name}: the per-hit form reads field rows and agrees with fn`, () => {
                for (const src of spec.inputs) {
                    expect(d!.properties.find((r) => r.source === src)?.storage, `input '${src}'`).toBe('field');
                }
                const names = spec.inputs.map((_, i) => `in${i}`);
                const source = perHit(Object.fromEntries(spec.inputs.map((src, i) => [src, names[i]])));
                const evaluate = new Function(...Object.keys(glslBuiltins), ...names, `return ${source};`) as (...a: unknown[]) => number;
                const cases = spec.inputs.reduce<number[][]>((acc) => acc.flatMap((c) => grid.map((x) => [...c, x])), [[]]);
                for (const c of cases) {
                    const values = Object.fromEntries(spec.inputs.map((src, i) => [src, c[i]]));
                    expect(evaluate(...Object.values(glslBuiltins), ...c), JSON.stringify(values)).toBe(spec.fn(values));
                }
            });
        }
    }

    it('a derived name shared by several models is one declaration', () => {
        const byName = new Map<string, unknown>();
        for (const d of Object.values(MATERIAL_MODELS)) {
            for (const spec of d?.derived ?? []) {
                if (byName.has(spec.name)) expect(spec, `${d!.id}.${spec.name}`).toBe(byName.get(spec.name));
                else byName.set(spec.name, spec);
            }
        }
    });
});
