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
    IDENTITY_SIMILARITY,
    isIdentityRotation,
    quatRotate,
    similarityApplyDirection,
    similarityApplyPoint,
    similarityApplyVector,
    type Similarity,
    type Vec3Tuple,
} from './similarity.js';
import { formatFloat, formatVec3 } from '../glsl-format.js';
import type { AABB } from '../accel/bvh/bvh.js';
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

/** Local-space AABB of a primitive given (canonical) values — the prototype box for instancing
 *  (impl-plan-tlas). null = unbounded (no `bounds` declared, e.g. plane) → not an instance
 *  prototype (Validator-rejected). */
export function primitiveBounds(type: string, values: PrimitiveValues): AABB | null {
    const d = PRIMITIVES[type];
    return d?.bounds ? d.bounds(values) : null;
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
        if (!scale) return lit;
        if (f.kind === 'direction' || f.kind === 'angle') return lit;          // invariant kinds
        if (f.kind === 'area') return `${scale} * ${scale} * ${lit}`;          // surface measure: ×s²
        return `${scale} * ${lit}`;
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
 *  (plane's offset) declares a descriptor `fold` override instead. Exported for the
 *  closure contract test (which must show a non-closed shape's kind-fold genuinely
 *  drops R) and for classifyPlacement's partial-fold arm; production folds go
 *  through foldPlacementIntoParameters, which guards closure. */
export function derivedFold(d: PrimitiveDescriptor, v: PrimitiveValues, g: Similarity): PrimitiveValues {
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
            case 'area':
                out[f.name] = g.scale * g.scale * (value as number);   // surface measure: ×s²
                break;
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
 * Constant-placement lowering into canonical parameters (fable-transforms §5.1/§5.2 —
 * BACKEND-NEUTRAL since impl-plan-placement-fold: folding is a property of the
 * placement↔params relationship, not of any intersection method). Total for
 * `similarityClosed` primitives; for non-closed primitives it is exact ONLY when the
 * rotation is identity (T,s always fold through the kind rows) — a rotated non-closed
 * placement THROWS here, making derivedFold's silent rotation-drop structurally
 * unreachable (callers route those through classifyPlacement's residual instead).
 * Kind-derived unless the descriptor declares a coupled override (plane). Identity
 * placements pass through exactly (IEEE: +0 adds, ×1 are exact). Values resolved and
 * CANONICALIZED before the fold (folds assume canonical input; direction kinds stay
 * unit under R, so folding preserves it).
 */
export function foldPlacementIntoParameters(
    type: string,
    parameters: PrimitiveValues,
    g: Similarity,
): PrimitiveValues {
    const d = primitive(type);
    if (!d.similarityClosed && !isIdentityRotation(g.rotation)) {
        throw new Error(`geometry: '${type}' is not similarityClosed — a rotated placement cannot fold into its parameters (route through classifyPlacement)`);
    }
    const resolved = resolvePrimitiveValues(d, parameters);
    const canonical = d.canonicalize !== undefined ? d.canonicalize(resolved) : resolved;
    return d.fold ? d.fold(canonical, g) : derivedFold(d, canonical, g);
}

/** Params-tier record width in FLOATS (impl-plan-placement-fold stage 3, the §6.1
 *  stride amendment), or null when the shape cannot take the params tier. A params-tier
 *  instance record is the shape's FOLDED canonical parameters — one texel, intersected
 *  in world space with no conjugation — so the shape must be similarityClosed (the fold
 *  is total), analytic (the leaf calls <type>_intersect), free of derived ctor fields
 *  (nothing to bake beyond the rows), fold-generic rows only (point/length — what the
 *  flat per-instance pack fold implements), and ≤ 4 floats wide. Sphere (3+1) is the
 *  selected set today; disk (7 floats) is the deferred 2-texel arm. The uv gate
 *  (materialReadsUv — orientation genuinely rotates a chart) is scene knowledge and
 *  lives with the batch decision in the dataTenants adapter, not here. */
export function paramsRecordFloats(type: string): number | null {
    const d = PRIMITIVES[type];
    if (d === undefined || !d.similarityClosed || !d.provides.analytic) return null;
    if (d.derivedCtorFields !== undefined || (d.derivedFields?.length ?? 0) > 0) return null;
    if (d.params.some((p) => p.kind !== 'point' && p.kind !== 'length')) return null;
    let n = 0;
    for (const p of d.params) n += p.shape === 'vec3' ? 3 : 1;
    return n <= 4 ? n : null;
}

/** A maximally-folded constant placement: canonical parameters with everything the
 *  rows can absorb folded in, plus the residual similarity the emitted wrapper must
 *  still apply (fable-transforms §5.2 as built — impl-plan-placement-fold stage 2). */
export interface ClassifiedPlacement {
    parameters: PrimitiveValues;
    /** Identity (closed shapes / rotation-free placements — no wrapper at all) or a
     *  PURE ROTATION about the folded center (scale 1 — the `s·d` correction is dead
     *  for constants; the existing rigid query tier serves the residual). */
    residual: Similarity;
}

/**
 * The maximal constant fold, both backends (ONE truth for Planner and App):
 * `g·Shape(v) = residual · Shape(parameters)` exactly.
 *
 * - closed, or rotation-free g → total fold, identity residual;
 * - non-closed + rotation, one point row, no orientation rows → fold everything the
 *   kinds absorb (center takes the full g·center; lengths ×s) and keep the rotation
 *   as a residual about the folded center: derivation in the plan doc —
 *   g·Shape(c,ℓ) = {g(c) + sR·u} = {c′ + R·v : v ∈ Shape₀(s·ℓ)}, so
 *   residual = (1, R, c′ − R·c′), which the rigid query tier emits unchanged;
 * - anything else (no current primitive) → untouched canonical params, residual = g —
 *   today's behavior as the safe fallback. A non-closed shape with direction/vector
 *   rows must NOT take the partial fold (the kind-fold would rotate those rows while
 *   the residual rotates them again).
 */
export function classifyPlacement(type: string, parameters: PrimitiveValues, g: Similarity): ClassifiedPlacement {
    const d = primitive(type);
    if (d.similarityClosed || isIdentityRotation(g.rotation)) {
        return { parameters: foldPlacementIntoParameters(type, parameters, g), residual: IDENTITY_SIMILARITY };
    }
    const resolved = resolvePrimitiveValues(d, parameters);
    const canonical = d.canonicalize !== undefined ? d.canonicalize(resolved) : resolved;
    const pointRows = d.params.filter((p) => p.kind === 'point');
    const orientationRows = d.params.some((p) => p.kind === 'direction' || p.kind === 'vector');
    if (pointRows.length !== 1 || orientationRows) {
        return { parameters: canonical, residual: g };
    }
    const folded = derivedFold(d, canonical, g);
    const c = folded[pointRows[0].name] as Vec3Tuple;
    const rc = quatRotate(g.rotation, c);
    return {
        parameters: folded,
        residual: { rotation: g.rotation, translation: [c[0] - rc[0], c[1] - rc[1], c[2] - rc[2]], scale: 1 },
    };
}
