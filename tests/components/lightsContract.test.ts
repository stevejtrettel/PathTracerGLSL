// Split from materialsContract.test.ts (D5: a family's door regression fails a file
// named for that family).

import { describe, it, expect } from 'vitest';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';
import { PRIMITIVES } from '../../src/components/geometry/index.js';

describe('light kind GLSL contract (struct-alignment batch — the _light_ infix is deliberate)', () => {
    for (const [kind, d] of Object.entries(LIGHT_KINDS)) {
        const sn = kind[0].toUpperCase() + kind.slice(1) + 'Light';
        describe(kind, () => {
            it(`glsl does NOT declare struct ${sn} (generated from the rows — A1)`, () => {
                expect(new RegExp(`struct\\s+${sn}\\s*\\{`).test(d.glsl)).toBe(false);
            });

            it('geometric rows declare a kind (drives the generated typedef + future Value<T> rules)', () => {
                for (const p of d.params) {
                    if (p.semantic === 'geometric') expect(p.kind, `${kind}.${p.name}`).toBeDefined();
                }
            });

            it('derivedFields declarations match derivedCtorFields output (count + shapes)', () => {
                const resolved = Object.fromEntries(d.params.map((p) => [p.name, p.shape === 'vec3' ? [1, 0, 0] : 1]));
                const values = d.derivedCtorFields?.(resolved) ?? [];
                const specs = d.derivedFields ?? [];
                expect(values.length, 'derivedFields ↔ derivedCtorFields length').toBe(specs.length);
                values.forEach((v, j) => {
                    expect(Array.isArray(v) ? 'vec3' : 'number', `derived '${specs[j].name}'`).toBe(specs[j].shape);
                });
            });

            it(`provides LightSample ${kind}_light_sample(${sn}, Point, vec2)`, () => {
                expect(new RegExp(`LightSample\\s+${kind}_light_sample\\s*\\(\\s*${sn}\\b`).test(d.glsl)).toBe(true);
            });

            it(`provides float ${kind}_light_pdf(${sn}, ...) iff hittable (the adjacent §6.1 mirror)`, () => {
                expect(new RegExp(`float\\s+${kind}_light_pdf\\s*\\(\\s*${sn}\\b`).test(d.glsl)).toBe(!d.delta);
            });
        });
    }
});

// ============================================================================
// Desugar totality (W2): authoredParams and the desugar functions describe the SAME
// input language, but nothing in the type system connects a declared row name to the
// `a.<field>` reads inside toValues/region.parameters — this test closes both drift
// directions mechanically. Direction 1 (read-but-undeclared): a complete declared
// record must produce COMPLETE registry values (an undeclared-but-read field surfaces
// as undefined). Direction 2 (declared-but-unread): omitting any required declared
// field must make SOME output undefined — if nothing changes, the field is unread.
// ============================================================================

describe('light kind registry invariants', () => {
    it('no two INVERSE-declaring kinds share a backing region primitive (the sampleAsLight inverse lookup is scoped to valuesFromRegion-bearing kinds — softbeam backs onto disk without joining the inverse)', () => {
        // Planner.ts resolves an emissive object's kind via find(k => k.region?.primitive
        // === shape && k.valuesFromRegion !== undefined) — FIRST match wins over kinds
        // that DECLARE the inverse. Two such kinds backing one primitive would silently
        // mis-route the sampleAsLight authoring path; when that day comes (two-sided
        // quads?), the inverse lookup needs a real disambiguation design, not a dedupe.
        // Kinds WITHOUT valuesFromRegion (softbeam) may share a primitive freely — the
        // explicit-light route is their only door, keyed by authored kind.
        const byPrimitive = new Map<string, string>();
        for (const [kind, d] of Object.entries(LIGHT_KINDS)) {
            if (d.region === undefined || d.valuesFromRegion === undefined) continue;
            const prior = byPrimitive.get(d.region.primitive);
            expect(prior, `kinds '${prior}' and '${kind}' both back onto primitive '${d.region.primitive}'`).toBeUndefined();
            byPrimitive.set(d.region.primitive, kind);
        }
    });
});

describe('light kind desugar totality (authoredParams ↔ toValues/region/power)', () => {
    // Non-collinear vec3 dummies (index-varied) so cross-product math stays regular.
    const dummy = (shape: 'number' | 'vec3', i: number): number | number[] =>
        shape === 'vec3' ? [1 + i, 0.5 * i, 2 - 0.25 * i] : 0.7 + i;
    const PRODUCT = [5, 5, 5];

    for (const [kind, d] of Object.entries(LIGHT_KINDS)) {
        const fullAuthored = (): Record<string, unknown> => ({
            kind,
            emission: PRODUCT,
            ...Object.fromEntries(d.authoredParams.map((p, i) => [p.name, dummy(p.shape, i)])),
        });

        describe(kind, () => {
            if (d.authoredParams.length === 0) {
                // sampleAsLight-route-ONLY kinds (mesh — fable-mesh-lights): never authored
                // as light records, so the desugar legs don't apply; the totality contract
                // is instead "validateAuthored rejects every attempt".
                it('an unauthorable kind rejects every authored record', () => {
                    expect(d.validateAuthored, 'unauthorable kinds must declare validateAuthored').toBeDefined();
                    expect(d.validateAuthored!(fullAuthored()).length).toBeGreaterThan(0);
                });
                return;
            }
            it('a complete declared record produces complete, well-shaped registry values', () => {
                const values = d.toValues(fullAuthored(), PRODUCT);
                for (const row of d.params) {
                    const v = values[row.name];
                    expect(v, `values.${row.name}`).toBeDefined();
                    if (row.shape === 'vec3') expect(Array.isArray(v), `values.${row.name} shape`).toBe(true);
                    else expect(typeof v, `values.${row.name} shape`).toBe('number');
                }
                // PRODUCT is a constant Vec3 → every row is resolved (no ValueParam); power's
                // resolved-values contract holds. (Driven-lights Stage A widened toValues.)
                expect(Number.isFinite(d.power(values as Record<string, number | number[]>)), 'power over complete values').toBe(true);
                if (d.region !== undefined) {
                    const prim = PRIMITIVES[d.region.primitive];
                    expect(prim, `backing primitive '${d.region.primitive}' is registered`).toBeDefined();
                    const rp = d.region.parameters(fullAuthored());
                    for (const p of prim.params) {
                        if (p.required) expect(rp[p.name], `region.${p.name}`).toBeDefined();
                    }
                    if (d.valuesFromRegion !== undefined) {
                        const back = d.valuesFromRegion(rp, PRODUCT);
                        for (const row of d.params) {
                            expect(back[row.name], `valuesFromRegion.${row.name}`).toBeDefined();
                        }
                    }
                }
            });

            it('every declared-required field is actually read (omit ⇒ some output corrupted)', () => {
                // "Corrupted" = undefined OR NaN: a desugar that COMPUTES on the field
                // (spot's cos(angle)) turns an omitted input into NaN, not undefined —
                // both prove the field is read (the output depends on it).
                const corrupted = (v: unknown): boolean =>
                    v === undefined
                    || (typeof v === 'number' && Number.isNaN(v))
                    || (Array.isArray(v) && v.some((c) => typeof c === 'number' && Number.isNaN(c)));
                for (const p of d.authoredParams.filter((p) => p.required)) {
                    const omitted = fullAuthored();
                    delete omitted[p.name];
                    let outputs: unknown[];
                    try {
                        const values = d.toValues(omitted, PRODUCT);
                        const regionVals = d.region !== undefined ? d.region.parameters(omitted) : {};
                        outputs = [
                            ...d.params.map((row) => values[row.name]),
                            ...Object.values(regionVals),
                        ];
                    } catch {
                        continue;   // a THROW on the omitted field is the strongest proof of dependence
                    }
                    expect(outputs.some(corrupted),
                        `authoredParams declares required '${p.name}' but no desugar output depends on it`).toBe(true);
                }
            });
        });
    }
});
