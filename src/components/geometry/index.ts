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
    IDENTITY_QUAT,
    IDENTITY_SIMILARITY,
    isIdentityRotation,
    isIdentityTranslation,
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
import { torusDescriptor } from './torus/torus.js';
import { bottleDescriptor } from './bottle/bottle.js';
import { knobDescriptor } from './knob/knob.js';
import { mengerDescriptor } from './menger/menger.js';
import { apollonianDescriptor } from './apollonian/apollonian.js';

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
    torus: torusDescriptor,
    bottle: bottleDescriptor,
    knob: knobDescriptor,
    menger: mengerDescriptor,
    apollonian: apollonianDescriptor,
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
 *  (impl-plan-tlas). null = unbounded (no bound exists, e.g. plane) → not an instance
 *  prototype (Validator-rejected).
 *
 *  Resolves internally (idempotent), so the resolved-values contract is self-enforcing
 *  at the AABB door. A shape with no authored `bounds` but a CROSS-TYPE `marchBound`
 *  gets its AABB DERIVED: the bound primitive's own box at the mapped values
 *  (fable-sdf-contract §3 — the same numbers expressed twice is how a bound silently
 *  starts clipping; menger/apollonian/bottle restated theirs verbatim before this). */
/** Values-free boundedness probe — TRUE iff primitiveBounds can produce a box
 *  (authored `bounds` OR a derivable cross-type `marchBound`). The ONE presence
 *  predicate for eligibility checks (instance prototypes, table membership) — a
 *  direct `d.bounds === undefined` test silently excludes every derived-bound shape
 *  (found when the first instanced scene-local gyroid was rejected). */
export function primitiveIsBounded(type: string): boolean {
    const d = PRIMITIVES[type];
    if (d === undefined) return false;
    if (d.bounds !== undefined) return true;
    const mb = d.marchBound;
    return mb !== undefined && mb !== 'self' && mb !== 'unbounded';
}

export function primitiveBounds(type: string, values: PrimitiveValues): AABB | null {
    const d = PRIMITIVES[type];
    if (d === undefined) return null;
    const v = resolvePrimitiveValues(d, values);
    if (d.bounds) return d.bounds(v);
    const mb = d.marchBound;
    if (mb !== undefined && mb !== 'self' && mb !== 'unbounded') {
        return primitiveBounds(mb.type, mb.values(v));
    }
    return null;
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
        if (f.kind === 'direction' || f.kind === 'angle' || f.kind === 'scalar') return lit;   // invariant kinds
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

// ============================================================================
// Generated marching boilerplate (fable-sdf-contract §4) — an SDF occupant authors
// its FIELD; the loop and the gradient are POLICY over it and are emitted here,
// once, for exactly the types a program marches. Before the contract these were
// hand-transcribed 9× byte-identical per shape file, with nothing keeping the
// epsilon/stall rules in sync.
// ============================================================================

/**
 * The generated marching intersect — same signature shape as `<type>_intersect`,
 * plus the [t0, t1] interval its bound handed us. Nothing here knows about the
 * scene — no minimum over other objects, no region ids.
 *
 * The rules (transcribed from the verified leaf marcher, fable-sdf-accel §3 —
 * formerly documented in sphere.glsl, now stated at their ONE author):
 *   · step by |sdf| (unsigned) so a ray INSIDE the shape marches to its exit —
 *     the field must never OVERESTIMATE true distance (the sdf clauses; a field
 *     built from a value/gradient estimate applies its own safety factor
 *     in-field, where it can depend on the parameters);
 *   · accept when the field falls under march_epsilon(t), then REFINE (below);
 *   · the far end is dilated by march_epsilon(t1) — a surface may sit exactly ON
 *     the bound's wall, and a tight bound would otherwise clip silhouettes;
 *   · exhaustion still inside the interval commits the graze (the stall rule: a
 *     ray pinned at a silhouette must report the surface, not paint the background
 *     through it); exhaustion past it is a miss and the caller resumes.
 * The caller applies its own nearest-hit test (t < hit.t), exactly as it does for
 * the closed-form intersects — this returns the nearest hit WITHIN the interval.
 *
 * THE REFINEMENT (`<type>_sdf_refine` — owner-ordered after the tangle's ring
 * banding; NEED-DECLARED via the `refine` fact after it made the fractals pay for
 * nothing): acceptance tests the ESTIMATE, so for a conservative field (a /L
 * divide) the accepted point's TRUE residual can be up to ~L× march_epsilon —
 * larger than EPS_INTERFACE, which breaks the §4.2 classification band and reads
 * as contour-following rings and wrong-side speckle in interiors. The polish uses
 * only the field's SIGN (exact even when the magnitude is crushed): DOUBLING steps
 * find a bracket across the surface — the step COUNT derives from the DECLARED
 * factor (cover ~2·refine acceptance radii, no more: an unbounded search would
 * walk through a fine-featured field's holes and commit a FARTHER surface), then
 * a fixed BISECTION nails the crossing to bracket/2⁸. The committed t is the
 * STARTING-side end of the bracket — deterministically on the approach side (the
 * old tracer's landing-offset lesson: an exact-surface landing makes
 * inside/outside a float-noise coin flip). No bracket = a graze/tangent: the
 * accepted point stands, which is exactly the stall behavior. A shape with NO
 * `refine` fact gets no polish and no cost — a true distance field's accepted
 * residual is already ≤ march_epsilon.
 */
export function emitSdfIntersect(d: PrimitiveDescriptor): string {
    const steps = d.stepBudget !== undefined ? String(d.stepBudget) : 'MAX_MARCH_STEPS';
    const f = (at: string) => `${d.type}_sdf(ray.origin + ${at} * ray.direction, s)`;
    // With `refine`: acceptance must be CONFIRMED BY A SIGN CROSSING (the glass-lab
    // ring finding, Aug 11 round 3 — exact normals + refinement both exonerated the
    // artifact): a near-tangent ray can dip inside the acceptance shell and MISS,
    // and committing that point manufactures a phantom surface along the near-miss
    // locus — on a curved lobe at the critical angle, a thin concentric ring. An
    // exact intersector only reports true crossings; a confirmed marcher matches its
    // topology. A failed confirmation advances ONE acceptance radius and resumes
    // (never the searched span — the doubling samples don't exclude a thin feature
    // between them). Exhaustion keeps the unconditional stall-commit (the silhouette
    // pin: a pinned PRIMARY ray must report the surface, not the background).
    // Refined shapes: a failed crossing-confirmation NUDGES one acceptance radius and
    // falls through to the normal step+resample (never `continue` — the loop head
    // would re-test a stale bound and spin).
    const accept = d.refine !== undefined
        ? `{ if (${d.type}_sdf_refine(ray, s, t, t)) return true; bound = march_epsilon(t); }`
        : 'return true;';
    const stall = d.refine !== undefined
        ? `    if (bound < 16.0 * march_epsilon(t) && t <= t_stop) { ${d.type}_sdf_refine(ray, s, t, t); return true; }\n    return false;`
        : `    return bound < 16.0 * march_epsilon(t) && t <= t_stop;`;
    const refine = d.refine === undefined ? [] : [
        `bool ${d.type}_sdf_refine(Ray ray, ${structName(d)} s, float t, out float tc) {`,
        `    bool neg0 = ${f('t')} < 0.0;`,
        `    float a = t, b = t, w = march_epsilon(t);`,
        `    bool crossed = false;`,
        //   Bracket span derives from the declared factor: 2^k − 1 ≥ 2·refine.
        `    for (int i = 0; i < ${Math.min(12, Math.max(2, Math.ceil(Math.log2(2 * d.refine + 1))))}; i++) {`,
        `        if (crossed) break;`,
        `        b = a + w;`,
        `        if ((${f('b')} < 0.0) != neg0) crossed = true;`,
        `        else { a = b; w *= 2.0; }`,
        `    }`,
        `    if (!crossed) { tc = t; return false; }`,
        //   14 bisections, not 8: the bracket width is octave-quantized (the doubling
        //   search), so the residual bracket/2^k JUMPS by powers of two across a
        //   surface — at k = 8 those octave boundaries render as nested contour rings
        //   seen through refraction (the glass-lab bullseye, Aug 11 round 3). At
        //   k = 14 the worst residual is ~eps/128: octaves fall below visibility.
        `    for (int i = 0; i < 14; i++) {`,
        `        float m = 0.5 * (a + b);`,
        `        if ((${f('m')} < 0.0) == neg0) a = m; else b = m;`,
        `    }`,
        `    tc = a;`,
        `    return true;`,
        `}`,
    ];
    // SIGN-TRACKED marching (the overestimation tripwire — glass-lab, Aug 11): a
    // sign flip between consecutive samples PROVES the field overestimated and the
    // ray stepped across a wall (a conservative field can never cross zero by its
    // own step). The two samples bracket the crossing — 12 bisections snap the hit
    // back onto the wall, committed on the STARTING side. Honest fields never take
    // this branch and pay only the un-abs'd compare; lying fields get correct
    // geometry instead of silently displaced walls (thin features jumped clean
    // over in one step remain the conservativeness gate's job).
    return [
        ...refine,
        `bool ${d.type}_sdf_intersect(Ray ray, ${structName(d)} s, float t0, float t1, out float t) {`,
        //  The restart floor is the marched tier's OWN clearance (impl-plan-epsilon-
        //  discipline): it is the second half of the self-intersection escape — the spawn
        //  offset (hit.eps = MARCH_CLEARANCE) and this floor reinforce each other, and the
        //  first acceptance test below sits at a 5× margin only because BOTH hold. Never
        //  re-spell either from a smaller tier.
        `    t = max(t0, MARCH_CLEARANCE);`,
        `    float t_stop = t1 + march_epsilon(t1);`,
        //  Guard the FIRST acceptance too: mid-loop iterations are bounded by the
        //  step-then-check below, but the restart floor can already exceed a sliver
        //  interval's dilated end — without this line the first acceptance could commit a
        //  hit OUTSIDE the shape's own interval (previously papered over by the interval
        //  producers clipping tf ≤ clearance; those clips are now the pure geometric
        //  behind-the-ray test, and this guard is the honest home of the bound).
        `    if (t > t_stop) return false;`,
        `    float t_prev = t;`,
        `    float dv = ${f('t')};`,
        `    float bound = abs(dv);`,
        `    for (int i = 0; i < ${steps}; i++) {`,
        `        if (bound < march_epsilon(t)) ${accept}`,
        `        t_prev = t;`,
        `        t += bound;`,
        `        if (t > t_stop) return false;`,
        `        float dn = ${f('t')};`,
        `        if ((dn < 0.0) != (dv < 0.0)) {`,
        `            float a = t_prev, b = t;`,
        `            bool negA = dv < 0.0;`,
        `            for (int j = 0; j < 12; j++) {`,
        `                float m = 0.5 * (a + b);`,
        `                if ((${f('m')} < 0.0) == negA) a = m; else b = m;`,
        `            }`,
        `            t = a;`,
        `            return true;`,
        `        }`,
        `        dv = dn;`,
        `        bound = abs(dv);`,
        `    }`,
        stall,
        `}`,
    ].join('\n');
}

/** The generated gradient normal — the 4-tap tetrahedral finite difference of THIS
 *  field (a field-defined shape has no other normal), tap radius NORMAL_EPSILON
 *  (0.5773 = 1/√3 normalizes the corner directions), in the shape's own frame; the
 *  caller rotates it to world. Replaces the hand-written 6-tap: one fewer field
 *  evaluation per axis pair, same order of accuracy. */
export function emitSdfNormal(d: PrimitiveDescriptor): string {
    const call = (sw: string) => `${sw} * ${d.type}_sdf(p + ${sw} * NORMAL_EPSILON, s)`;
    return [
        `vec3 ${d.type}_sdf_normal(vec3 p, ${structName(d)} s) {`,
        `    vec2 k = vec2(0.5773, -0.5773);`,
        `    return normalize(${call('k.xyy')}`,
        `                   + ${call('k.yyx')}`,
        `                   + ${call('k.yxy')}`,
        `                   + ${call('k.xxx')});`,
        `}`,
    ].join('\n');
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
            case 'scalar':
                break;   // similarity-invariant: no rotation or scale changes an angle or a ratio
            case 'area':
                out[f.name] = g.scale * g.scale * (value as number);   // surface measure: ×s²
                break;
        }
    }
    return out;
}

/** Can a translation fold into this primitive's rows? Point rows absorb T directly;
 *  a coupled `fold` override (plane: offset absorbs T through the normal) also can.
 *  A CANONICAL shape (fable-sdf-contract §2 — the marched shapes, whose position is
 *  placement's alone) has neither: translation rides the residual, never the params. */
function foldsTranslation(d: PrimitiveDescriptor): boolean {
    return d.fold !== undefined || d.params.some((p) => p.kind === 'point');
}

/** RESOLUTION + canonicalization at a Planner entry point (the plane/disk unit-normal
 *  rule) — replaces the old per-type name branches. This is THE resolve site
 *  (fable-sdf-contract §3's pin): every Planner path passes through it, so every
 *  downstream descriptor function — `marchBound.values`, `bounds`, `fold`,
 *  `validateValues` — receives COMPLETE values per its documented contract. Before
 *  this, the driven and retained-frame paths shipped unresolved values: a driven
 *  bottle with defaulted optional rows got NaN extents and silently disappeared.
 *  The framework's single-application guarantee: each parameter set passes through
 *  EXACTLY ONE of the Planner entry points (constant-analytic fold below,
 *  driven-analytic, SDF placement), each of which resolves + canonicalizes once
 *  (both idempotent). */
export function canonicalizePrimitiveParameters(type: string, parameters: PrimitiveValues): PrimitiveValues {
    const d = PRIMITIVES[type];
    if (d === undefined) return parameters;
    const resolved = resolvePrimitiveValues(d, parameters);
    return d.canonicalize !== undefined ? d.canonicalize(resolved) : resolved;
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
    if (!foldsTranslation(d) && !isIdentityTranslation(g.translation)) {
        throw new Error(`geometry: '${type}' is CANONICAL (no position row — fable-sdf-contract §2) — a translated placement cannot fold into its parameters (route through classifyPlacement)`);
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
    if ((d.similarityClosed || isIdentityRotation(g.rotation))
        && (foldsTranslation(d) || isIdentityTranslation(g.translation))) {
        return { parameters: foldPlacementIntoParameters(type, parameters, g), residual: IDENTITY_SIMILARITY };
    }
    const resolved = resolvePrimitiveValues(d, parameters);
    const canonical = d.canonicalize !== undefined ? d.canonicalize(resolved) : resolved;
    const pointRows = d.params.filter((p) => p.kind === 'point');
    const orientationRows = d.params.some((p) => p.kind === 'direction' || p.kind === 'vector');
    if (pointRows.length === 0 && !orientationRows && d.fold === undefined) {
        // CANONICAL shapes (fable-sdf-contract §2): no row carries position, so scale
        // folds through the length/area rows and R,T ride the residual as ONE RIGID
        // motion — g·Shape₀(v) = {sR·u + T : u ∈ Shape₀(v)} = {R·w + T : w ∈ Shape₀(s·v)}
        // exactly. A pure translation lands on the wrapper's cheapest tier (one
        // subtract), which is the declared cost of losing the center row.
        const folded = derivedFold(d, canonical, { rotation: IDENTITY_QUAT, translation: [0, 0, 0], scale: g.scale });
        return { parameters: folded, residual: { rotation: g.rotation, translation: g.translation, scale: 1 } };
    }
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
