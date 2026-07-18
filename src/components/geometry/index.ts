// Geometry primitive registry (impl-plan-geometry-descriptors) — one descriptor per
// primitive, both backends' facts together. Adding a primitive = one folder + one
// registry line, NOTHING else (B1: object `type` is a string; this registry + the
// Validator gatekeep — no type union exists).
//
// GLSL is STRUCT-SHAPED (owner-decided; the MaterialProperties house pattern): each
// primitive declares `struct <Type>` and the uniform function surface over it —
// <type>_sdf(p, X), <type>_intersect(ray, X, out t), <type>_normal(p, X) — type-first,
// the ONE symbol convention across families (lambert_eval). Everything
// mechanical DERIVES from the descriptor's schema row: the framework resolves row
// defaults, formats values, scales length-like constructor args under driven
// placement, and splices constructors in row order. Descriptors declare facts and
// return numbers — they never build GLSL strings. Composition — dispatch loops,
// placement tiers, region tables — stays in the intersection feature ("descriptors
// declare facts; generators decide").

import type { PrimitiveDescriptor, PrimitiveEmitCtx, PrimitiveValues } from '../descriptors.js';
import {
    similarityApplyDirection,
    similarityApplyPoint,
    similarityApplyVector,
    type Similarity,
    type Vec3Tuple,
} from './similarity.js';
import { formatFloat, formatVec3 } from '../glsl-format.js';
import { sphereDescriptor } from './sphere/sphere.js';
import { planeDescriptor } from './plane/plane.js';
import { boxDescriptor } from './box/box.js';
import { quadDescriptor } from './quad/quad.js';
import { cylinderDescriptor } from './cylinder/cylinder.js';
import { diskDescriptor } from './disk/disk.js';

export type { PrimitiveDescriptor, PrimitiveEmitCtx, PrimitiveValues, PrimitiveParamSpec } from '../descriptors.js';
export { canonicalPlane } from './plane/plane.js';
export { quadCross, quadNormal } from './quad/quad.js';
export { unitVec3 } from './disk/disk.js';

/** Registry insertion order = deterministic emission order for primitive includes. */
export const PRIMITIVES: Record<string, PrimitiveDescriptor> = {
    sphere: sphereDescriptor,
    plane: planeDescriptor,
    box: boxDescriptor,
    quad: quadDescriptor,
    cylinder: cylinderDescriptor,
    disk: diskDescriptor,
};

/** Lookup that throws on unregistered types — the Planner/Validator diagnose them
 *  upstream (reject-not-remove), so this is an unreachable backstop. */
export function primitive(type: string): PrimitiveDescriptor {
    const d = PRIMITIVES[type];
    if (!d) throw new Error(`geometry: primitive '${type}' has no descriptor (Planner/Validator should have rejected it)`);
    return d;
}

/** GLSL struct name — the capitalized type ('sphere' → 'Sphere'). */
export function structName(d: PrimitiveDescriptor): string {
    return d.type[0].toUpperCase() + d.type.slice(1);
}

/** Backend resolution (B1 — shape, not backend): auto = analytic if provided, else
 *  sdf; an explicit pin wins (the Validator rejects pins the primitive can't honor).
 *  undefined = unregistered type or unhonorable pin — callers diagnose. */
export function resolveBackend(type: string, pin?: 'sdf' | 'analytic'): 'sdf' | 'analytic' | undefined {
    const d = PRIMITIVES[type];
    if (d === undefined) return undefined;
    if (pin !== undefined) {
        return (pin === 'sdf' ? d.provides.sdf : d.provides.analytic) ? pin : undefined;
    }
    return d.provides.analytic ? 'analytic' : 'sdf';
}

// ============================================================================
// Derived emission (the schema row IS the struct)
// ============================================================================

/** Row defaults applied once — descriptor functions and emitters receive COMPLETE
 *  values and never re-apply `?? default` themselves. */
export function resolvePrimitiveValues(d: PrimitiveDescriptor, values: PrimitiveValues): PrimitiveValues {
    const out: PrimitiveValues = { ...values };
    for (const f of d.params) {
        if (out[f.name] === undefined && f.default !== undefined) out[f.name] = f.default;
    }
    return out;
}

const formatValue = (v: number | number[]): string =>
    Array.isArray(v) ? formatVec3(v) : formatFloat(v);

/** `<Type>(…row[, …derived])` — the struct constructor: row values formatted by
 *  shape, ×scale under driven placement for every kind EXCEPT the invariants
 *  (direction, angle — fable-transforms §6.1: the rigid-frame query scales the
 *  PARAMS, never distances; derived from the kind, same table as the fold),
 *  derived compile-time fields (quad's baked normal) appended unscaled. */
export function emitCtor(d: PrimitiveDescriptor, values: PrimitiveValues, scale?: string): string {
    const v = resolvePrimitiveValues(d, values);
    const args = d.params.map((f) => {
        const lit = formatValue(v[f.name]!);
        const invariant = f.kind === 'direction' || f.kind === 'angle';
        return !invariant && scale ? `${scale} * ${lit}` : lit;
    });
    const derived = (d.derivedCtorFields?.(v) ?? []).map(formatValue);
    return `${structName(d)}(${[...args, ...derived].join(', ')})`;
}

/** `<type>_sdf(<point>, <ctor>)` — the signed-distance call (world-exact under
 *  driven scale: params absorb s, distances stay world values). */
export function emitSdfCall(d: PrimitiveDescriptor, values: PrimitiveValues, ctx: PrimitiveEmitCtx): string {
    return `${d.type}_sdf(${ctx.point}, ${emitCtor(d, values, ctx.scale)})`;
}

/** `<type>_intersect(<ray>, <ctor>, t)` — the closed-form intersection test. */
export function emitAnalyticTest(d: PrimitiveDescriptor, values: PrimitiveValues, rayVar: string, scale?: string): string {
    return `${d.type}_intersect(${rayVar}, ${emitCtor(d, values, scale)}, t)`;
}

/** `<type>_normal(<point>, <ctor>)` — the outward surface normal. */
export function emitNormalCall(d: PrimitiveDescriptor, values: PrimitiveValues, ctx: PrimitiveEmitCtx): string {
    return `${d.type}_normal(${ctx.point}, ${emitCtor(d, values, ctx.scale)})`;
}

/** Signed distance for point classification (§2.7): thin primitives never claim
 *  containment; everyone else reuses their own SDF body — one distance truth per
 *  primitive, shared by both backends. */
export function emitSignedDistance(d: PrimitiveDescriptor, values: PrimitiveValues, ctx: PrimitiveEmitCtx): string {
    if (d.thin) return '1.0e20';
    return emitSdfCall(d, values, ctx);
}

/** The kind-derived fold (T2): each row transforms independently by its declared
 *  geometric kind. Correct exactly for SEPARABLE parameter sets — a coupled rule
 *  (plane's offset) declares a descriptor `fold` override instead. */
function derivedFold(d: PrimitiveDescriptor, v: PrimitiveValues, g: Similarity): PrimitiveValues {
    const out: PrimitiveValues = { ...v };
    for (const f of d.params) {
        const value = v[f.name];
        if (value === undefined) continue;
        switch (f.kind) {
            case 'point':
                out[f.name] = similarityApplyPoint(g, value as Vec3Tuple);
                break;
            case 'vector':
                out[f.name] = similarityApplyVector(g, value as Vec3Tuple);
                break;
            case 'direction':
                out[f.name] = similarityApplyDirection(g, value as Vec3Tuple);
                break;
            case 'length':
                out[f.name] = Array.isArray(value)
                    ? value.map((x) => g.scale * x)
                    : g.scale * (value as number);
                break;
            case 'angle':
                break;   // similarity-invariant: no rotation or scale changes an angle
        }
    }
    return out;
}

/** Descriptor canonicalization at a Planner entry point (the plane/disk unit-normal
 *  rule) — replaces the old per-type name branches. Identity for primitives that
 *  declare none. The framework's single-application guarantee: each parameter set
 *  passes through EXACTLY ONE of the Planner entry points (constant-analytic fold
 *  below, driven-analytic, SDF placement), each of which canonicalizes once. */
export function canonicalizePrimitiveParameters(type: string, parameters: PrimitiveValues): PrimitiveValues {
    const d = PRIMITIVES[type];
    return d?.canonicalize !== undefined ? d.canonicalize(parameters) : parameters;
}

/**
 * Constant-transform lowering for the analytic backend (fable-transforms §5.1): the
 * analytic primitive set is CLOSED under similarities, so a constant placement folds
 * entirely into canonical parameters at plan time. Kind-derived unless the descriptor
 * declares a coupled override (plane). Identity placements pass through exactly
 * (IEEE: +0 adds, ×1 are exact). Takes any registered type — the `primitive()` lookup
 * is the throwing backstop (Planner/Validator diagnose unknown types upstream), so a
 * new analytic primitive never touches this signature. Values resolved and
 * CANONICALIZED before the fold (folds assume canonical input; direction kinds stay
 * unit under R, so folding preserves it).
 */
export function foldAnalyticParameters(
    type: string,
    parameters: PrimitiveValues,
    g: Similarity,
): PrimitiveValues {
    const d = primitive(type);
    const resolved = resolvePrimitiveValues(d, parameters);
    const canonical = d.canonicalize !== undefined ? d.canonicalize(resolved) : resolved;
    return d.fold ? d.fold(canonical, g) : derivedFold(d, canonical, g);
}
