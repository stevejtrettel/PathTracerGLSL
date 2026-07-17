// The geometry symbol contract, enforced (impl-plan-geometry-descriptors §2.6 + the
// T1–T5 kinds batch; fable-naming-audit P4's first instance). GLSL is struct-shaped
// (owner-decided — the MaterialProperties house pattern): each primitive declares
// `struct <Type>` whose FIELDS (name, type, order) = the schema row (+
// derivedCtorFields), and the uniform function surface over it — declared by
// `provides` and verified BOTH directions (a declared symbol must exist; an
// undeclared one must not). Constructors are emitted positionally from the row, so
// name/type/order agreement is load-bearing (a silent same-typed field swap is the
// hazard this test kills — pre-T4 it only counted fields).
//
// THE DICHOTOMY (owner, Jul 16 2026): every primitive provides sdf XOR declares
// thin — sdf is the sole containment provider (region_T slot cut; approximate SDFs
// legal under the three sdf clauses), so a primitive without one must be
// zero-thickness, and silent-thin is impossible.

import { describe, it, expect } from 'vitest';
import { PRIMITIVES, structName } from '../../src/components/geometry/index.js';

/** Struct body → ordered (glslType, name) pairs, comments stripped. */
function parseStructFields(glsl: string, sn: string): Array<{ glslType: string; name: string }> {
    const m = glsl.match(new RegExp(`struct\\s+${sn}\\s*\\{([^}]*)\\}`));
    expect(m, `struct ${sn} declaration`).toBeTruthy();
    const body = m![1].replace(/\/\/[^\n]*/g, '');
    return body
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((decl) => {
            const fm = decl.match(/^(\w+)\s+(\w+)$/);
            expect(fm, `well-formed field declaration '${decl}' in struct ${sn}`).toBeTruthy();
            return { glslType: fm![1], name: fm![2] };
        });
}

const shapeToGlsl = { number: 'float', vec3: 'vec3' } as const;

describe('geometry primitive descriptors (struct + symbol contract)', () => {
    for (const [key, d] of Object.entries(PRIMITIVES)) {
        const sn = structName(d);
        describe(key, () => {
            it('registry key matches descriptor type', () => {
                expect(d.type).toBe(key);
            });

            it('declares at least one backend', () => {
                expect(d.provides.sdf || d.provides.analytic).toBe(true);
            });

            it('the dichotomy: provides sdf XOR declares thin', () => {
                expect(d.provides.sdf !== (d.thin === true)).toBe(true);
            });

            it('thin primitives are analytic (they must be intersectable somehow)', () => {
                if (d.thin === true) expect(d.provides.analytic).toBe(true);
            });

            it('kinds imply shapes: point/vector/direction are vec3', () => {
                for (const p of d.params) {
                    if (p.kind !== 'length') {
                        expect(p.shape, `${key}.${p.name} (kind '${p.kind}')`).toBe('vec3');
                    }
                }
            });

            it(`struct ${sn} fields match the row — names, types, AND order`, () => {
                const fields = parseStructFields(d.glsl, sn);
                const resolved = Object.fromEntries(
                    d.params.map((p) => [p.name, p.default ?? (p.shape === 'vec3' ? [1, 0, 0] : 1)]),
                );
                const derived = d.derivedCtorFields?.(resolved) ?? [];
                expect(fields.length).toBe(d.params.length + derived.length);
                // Row fields: positional emission makes name+type+order all load-bearing.
                d.params.forEach((p, i) => {
                    expect(fields[i].name, `field ${i} of ${sn}`).toBe(p.name);
                    expect(fields[i].glslType, `field '${p.name}' of ${sn}`).toBe(shapeToGlsl[p.shape]);
                });
                // Derived fields: appended after the row; types inferred from the values.
                derived.forEach((v, j) => {
                    const expected = Array.isArray(v) ? 'vec3' : 'float';
                    expect(fields[d.params.length + j].glslType, `derived field ${j} of ${sn}`).toBe(expected);
                });
            });

            it(`defines ${key}_sdf(vec3, ${sn}) iff provides.sdf`, () => {
                expect(new RegExp(`float\\s+${key}_sdf\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${sn}\\b`).test(d.glsl))
                    .toBe(d.provides.sdf);
            });

            it(`defines ${key}_intersect(Ray, ${sn}, out float t) iff provides.analytic`, () => {
                expect(new RegExp(`bool\\s+${key}_intersect\\s*\\(\\s*Ray\\s+\\w+\\s*,\\s*${sn}\\b[^)]*out\\s+float`).test(d.glsl))
                    .toBe(d.provides.analytic);
            });

            it(`defines ${key}_normal(vec3, ${sn}) iff provides.analytic`, () => {
                expect(new RegExp(`vec3\\s+${key}_normal\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${sn}\\b`).test(d.glsl))
                    .toBe(d.provides.analytic);
            });

            it('rows are well-formed (names unique, defaults shape-consistent)', () => {
                const names = d.params.map((p) => p.name);
                expect(new Set(names).size).toBe(names.length);
                for (const p of d.params) {
                    expect(p.shape === 'number' || p.shape === 'vec3').toBe(true);
                    if (p.default !== undefined) {
                        expect(Array.isArray(p.default) ? p.shape === 'vec3' : p.shape === 'number').toBe(true);
                    }
                }
            });
        });
    }
});
