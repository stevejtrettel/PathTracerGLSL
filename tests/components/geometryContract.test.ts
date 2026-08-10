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

            it('kinds imply shapes: point/vector/direction are vec3; angle/area are scalars', () => {
                for (const p of d.params) {
                    if (p.kind === 'angle' || p.kind === 'area') {
                        expect(p.shape, `${key}.${p.name} (kind '${p.kind}')`).toBe('number');
                    } else if (p.kind !== 'length') {
                        expect(p.shape, `${key}.${p.name} (kind '${p.kind}')`).toBe('vec3');
                    }
                }
            });

            it(`glsl does NOT declare struct ${sn} (generated from the rows — A1)`, () => {
                expect(new RegExp(`struct\\s+${sn}\\s*\\{`).test(d.glsl)).toBe(false);
            });

            it('derivedFields declarations match derivedCtorFields output (count + shapes)', () => {
                const resolved = Object.fromEntries(
                    d.params.map((p) => [p.name, p.default ?? (p.shape === 'vec3' ? [1, 0, 0] : 1)]),
                );
                const values = d.derivedCtorFields?.(resolved) ?? [];
                const specs = d.derivedFields ?? [];
                expect(values.length, 'derivedFields ↔ derivedCtorFields length').toBe(specs.length);
                values.forEach((v, j) => {
                    expect(Array.isArray(v) ? 'vec3' : 'number', `derived '${specs[j].name}'`).toBe(specs[j].shape);
                });
            });

            it(`defines ${key}_sdf(vec3, ${sn}) iff provides.sdf`, () => {
                expect(new RegExp(`float\\s+${key}_sdf\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${sn}\\b`).test(d.glsl))
                    .toBe(d.provides.sdf);
            });

            // ---- the march bound + the marching half (impl-plan-sdf-as-shape T1/T2) ----
            // An SDF object is a shape whose intersect ITERATES, so a shape that marches
            // owes three things: the iterating intersect, its gradient normal, and an
            // explicit statement of what BOUNDS it. The bound is never inferred — a
            // marchable shape that declares nothing fails here, which is the "you must
            // say" rule (§2.3) in its enforceable form.
            it(`declares marchBound iff provides.sdf`, () => {
                expect(d.marchBound !== undefined, `${key}: provides.sdf ⇒ declare marchBound ('self' | 'unbounded' | { type, values })`)
                    .toBe(d.provides.sdf);
            });

            it(`defines ${key}_sdf_intersect(Ray, ${sn}, float, float, out float) iff provides.sdf`, () => {
                expect(new RegExp(`bool\\s+${key}_sdf_intersect\\s*\\(\\s*Ray\\s+\\w+\\s*,\\s*${sn}\\b[^)]*out\\s+float`).test(d.glsl))
                    .toBe(d.provides.sdf);
            });

            it(`defines ${key}_sdf_normal(vec3, ${sn}) iff provides.sdf`, () => {
                expect(new RegExp(`vec3\\s+${key}_sdf_normal\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${sn}\\b`).test(d.glsl))
                    .toBe(d.provides.sdf);
            });

            it(`the march bound resolves to an analytic primitive with an interval form`, () => {
                const b = d.marchBound;
                if (b === undefined || b === 'unbounded') return;
                // 'self' means this shape's own analytic form; otherwise a named one.
                const boundType = b === 'self' ? d.type : b.type;
                const bd = PRIMITIVES[boundType];
                expect(bd, `${key}: marchBound names unregistered primitive '${boundType}'`).toBeDefined();
                expect(bd.provides.analytic, `${key}: bound '${boundType}' must be analytic`).toBe(true);
                const bsn = structName(bd);
                expect(new RegExp(`bool\\s+${boundType}_interval\\s*\\(\\s*Ray\\s+\\w+\\s*,\\s*${bsn}\\b[^)]*out\\s+float\\s+\\w+\\s*,\\s*out\\s+float`).test(bd.glsl),
                    `${boundType}: used as a march bound, so it owes ${boundType}_interval(Ray, ${bsn}, out float t0, out float t1)`).toBe(true);
            });

            it(`defines ${key}_intersect(Ray, ${sn}, out float t) iff provides.analytic`, () => {
                expect(new RegExp(`bool\\s+${key}_intersect\\s*\\(\\s*Ray\\s+\\w+\\s*,\\s*${sn}\\b[^)]*out\\s+float`).test(d.glsl))
                    .toBe(d.provides.analytic);
            });

            it(`defines ${key}_normal(vec3, ${sn}) iff provides.analytic`, () => {
                expect(new RegExp(`vec3\\s+${key}_normal\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${sn}\\b`).test(d.glsl))
                    .toBe(d.provides.analytic);
            });

            it(`defines ${key}_uv(vec3, ${sn}) iff uvChart (fable-imagery P1)`, () => {
                expect(new RegExp(`vec2\\s+${key}_uv\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${sn}\\b`).test(d.glsl))
                    .toBe(d.uvChart === true);
            });

            it('rows are well-formed (names unique, defaults shape-consistent, required XOR default)', () => {
                const names = d.params.map((p) => p.name);
                expect(new Set(names).size).toBe(names.length);
                for (const p of d.params) {
                    expect(p.shape === 'number' || p.shape === 'vec3').toBe(true);
                    if (p.default !== undefined) {
                        expect(Array.isArray(p.default) ? p.shape === 'vec3' : p.shape === 'number').toBe(true);
                    }
                    // REQUIRED XOR DEFAULT: a default on a required row is dead on the
                    // validated path (the Validator errors first) and a silent value on
                    // any path that bypasses validation — one semantics per row.
                    expect(p.required ? p.default === undefined : p.default !== undefined,
                        `${key}.${p.name}: required rows carry no default; optional rows must have one`).toBe(true);
                }
            });
        });
    }
});
