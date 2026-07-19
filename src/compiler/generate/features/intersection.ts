// compiler/generate/features/intersection.ts
// Geometry backends + the generated scene_intersect dispatcher.
//
// A scene may use the SDF backend (marching), the analytic backend (closed-form), or both.
// scene_intersect / scene_intersect_any are GENERATED to combine only the backends present —
// so "swapping the details of intersect" is exactly what the codegen does. Region ids are
// globally unique across both backends (§2.3), so material_of() spans them.

import type { RenderPlan, PlannedSDFObject, PlannedAnalyticObject, PlannedMesh, PlannedMaterial, DrivenPlacement, PlannedPlacement } from '../../plan/types.js';
import { isDrivenPlacement } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution, type PlannedTexture } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatMat3, formatVec3 } from '../../../components/glsl-format.js';
import { emitValue, type ParamValue } from '../values.js';
import { MATERIAL_MODELS, modelTransmission } from '../../../components/materials/index.js';
import {
    PRIMITIVES,
    primitive,
    structName,
    emitCtor,
    emitSdfCall,
    emitAnalyticTest,
    emitSignedDistance,
} from '../../../components/geometry/index.js';
import {
    classifySimilarity,
    isIdentityRotation,
    isIdentityScale,
    isIdentityTranslation,
    quatConjugate,
    quatToMat3,
    type Similarity,
} from '../../../components/geometry/similarity.js';

import raymarchGLSL from '../../../components/intersection/raymarch/raymarch.glsl?raw';
import meshGLSL from '../../../components/intersection/mesh/mesh.glsl?raw';
import { MESH_TEX_WIDTH, meshExternNames } from '../../../components/intersection/mesh/mesh.js';
import placementGLSL from '../../../glsl/core/placement.glsl?raw';
import { structFromRows } from '../schema.js';

export function contributeIntersection(plan: RenderPlan): FeatureContribution {
    // Backend presence is a link-map decision (ProgramDescription.intersection.backends) —
    // no scene with geometry is empty, but a fully-empty scene contributes nothing.
    const { sdf: hasSDF, analytic: hasAnalytic, mesh: hasMesh } = plan.program.intersection.backends;
    if (!hasSDF && !hasAnalytic && !hasMesh) {
        return emptyContribution('intersection');
    }
    const ids = objectGlslIds(plan.objects, plan.analyticObjects);
    const blocks: ShaderBlock[] = [];
    const defines: FeatureContribution['defines'] = {};
    const textures: PlannedTexture[] = [];

    // Driven placement (fable-transforms §6/§6.1): the rigid-frame query helpers +
    // per-object uniform pairs + slider metadata. Gated on the Planner's decision —
    // constant-only scenes carry ZERO placement machinery (exact linkage).
    const drivenRecords: DrivenPlacement[] = [
        ...plan.objects.map((o) => o.placement).filter(isDrivenPlacement),
        ...plan.analyticObjects.map((o) => o.placement).filter((p): p is DrivenPlacement => p !== undefined),
        ...plan.meshes.map((m) => m.placement).filter(isDrivenPlacement),
    ];
    const uniforms: FeatureContribution['uniforms'] = [];
    const parameters: FeatureContribution['parameters'] = {};
    if (plan.program.intersection.drivenPlacement) {
        blocks.push({ origin: 'glsl/core/placement.glsl', source: placementGLSL });
        for (const rec of drivenRecords) {
            uniforms.push(...rec.uniforms);
            Object.assign(parameters, rec.parameters);
        }
    }

    // Primitive math for exactly the primitives PRESENT (registry order): each is one
    // wholesale file carrying BOTH backends' functions for that primitive (§2.12 —
    // <type>_sdf also serves the analytic backend's containment classification).
    // The STRUCTS are generated from the descriptor rows first (A1: one declaration —
    // the row is the single source for struct, ctor, resolution, and validation).
    const presentTypes = new Set<string>([
        ...plan.objects.map((o) => o.sdfType as string),
        ...plan.analyticObjects.map((o) => o.shapeType as string),
    ]);
    const present = Object.values(PRIMITIVES).filter((d) => presentTypes.has(d.type));
    if (present.length > 0) {
        blocks.push({
            origin: 'generated:primitive-structs',
            source: ['// Generated primitive structs (rows are the single source — A1)',
                ...present.map((d) => structFromRows(structName(d), [...d.params, ...(d.derivedFields ?? [])]))].join('\n'),
        });
    }
    for (const d of present) {
        blocks.push({ origin: `components/geometry/${d.type}/${d.type}.glsl`, source: d.glsl });
    }

    // Named shapes (naming batch N5): each NAMED, CONSTANT-placed object's struct is
    // hoisted to one named const — emitted source reads like the scene, machine code
    // identical (the driver folds either form). Unnamed objects keep inline ctors.
    const namedShapes = generateNamedShapes(plan.objects, plan.analyticObjects, ids);
    if (namedShapes !== null) {
        blocks.push({ origin: 'generated:named-shapes', source: namedShapes });
    }

    // SDF backend: per-scene march-bound dispatch + the marcher (sdf_intersect*).
    if (hasSDF) {
        blocks.push({ origin: 'generated:sdf-dispatch', source: generateSDFDispatch(plan.objects, ids) });
        blocks.push({ origin: 'components/intersection/raymarch/raymarch.glsl', source: raymarchGLSL });
    }

    // The occlusion query chain is a seam decision (impl-plan-exact-linkage): the opaque
    // shadow fast path is its only caller. The generated walkers (analytic_intersect_any,
    // scene_intersect_any) are gated together; sdf_intersect_any rides inside raymarch.glsl
    // regardless (whole-component inclusion — the declared cost).
    const anyQuery = plan.program.intersection.anyQuery;

    // Analytic backend: per-scene analytic_intersect* dispatch over the closed forms.
    if (hasAnalytic) {
        blocks.push({ origin: 'generated:analytic-dispatch', source: generateAnalyticDispatch(plan.analyticObjects, anyQuery, ids) });
    }

    // Mesh backend (impl-plan-meshes): the wholesale triangle leaf (mesh.glsl) + generated
    // per-mesh wrappers that conjugate the world ray into each mesh's LOCAL frame (ray-into-
    // local; vertices stay object-local). The vertex/triangle DATA arrives as extern data
    // textures (RGBA32F, incl. the index texture — indices ≤ 16M are exact in f32) the app
    // uploads; the loop bound (triCount) is baked (the compiler has the mesh data). v0 is a
    // brute-force scan — the leaf is BVH-ready (the BVH wraps a node walk around it, v1).
    if (hasMesh) {
        defines.MESH_TEX_WIDTH = String(MESH_TEX_WIDTH);
        for (const m of plan.meshes) {
            const n = meshExternNames(m.ordinal);
            textures.push(
                { name: `u_mesh_${m.ordinal}_position`, source: `extern:${n.position}` },
                { name: `u_mesh_${m.ordinal}_index`, source: `extern:${n.index}` },
                { name: `u_mesh_${m.ordinal}_normal`, source: `extern:${n.normal}` },
                { name: `u_mesh_${m.ordinal}_uv`, source: `extern:${n.uv}` },
            );
        }
        blocks.push({ origin: 'components/intersection/mesh/mesh.glsl', source: meshGLSL });
        blocks.push({ origin: 'generated:mesh-dispatch', source: generateMeshDispatch(plan.meshes, anyQuery) });
    }

    // region → material table spans ALL backends (regions are globally unique).
    blocks.push({ origin: 'generated:material-of', source: generateMaterialOf(plan.objects, plan.analyticObjects, plan.meshes, plan.ambientMedium) });

    // region → IOR table (§2.3 generated-tables family) — only when a transmissive model
    // reads it (capability-driven, R1a — the far side's IOR has no shading point).
    if (plan.materials.some((m) => modelTransmission(m.model))) {
        blocks.push({ origin: 'generated:ior-of', source: generateIorOf(plan.objects, plan.analyticObjects, plan.materials) });
    }

    // Point classification (§2.7 innermost-wins) — consumed by the dispatcher's §4.2 step.
    blocks.push({ origin: 'generated:scene-region-at', source: generateSceneRegionAt(plan.objects, plan.analyticObjects, ids) });

    // The top-level dispatcher, combining only the backends present (declared after all).
    // Zero-thickness regions (descriptor `thin` fact): they never claim containment, so
    // the dispatcher's owner-covers-own-side shortcut is invalid for them (audit H2). Meshes
    // are thin-like in v0 (surface-only, excluded from scene_region_at — impl-plan-meshes §3),
    // so their regions join the thin set: a back-face mesh hit probes the entering side.
    const thinRegions = [
        ...plan.analyticObjects.filter((o) => primitive(o.shapeType).thin).map((o) => o.index),
        ...plan.meshes.map((m) => m.index),
    ];
    blocks.push({ origin: 'generated:scene-intersect', source: generateSceneIntersect(hasSDF, hasAnalytic, hasMesh, thinRegions, anyQuery) });

    // T4 seams: the geometry/region contract surface (§2.3 tables + the trace-loop queries).
    const provides = [
        { name: 'scene_intersect', signature: 'bool scene_intersect(Ray ray, out Hit hit)' },
        { name: 'scene_region_at', signature: 'int scene_region_at(vec3 p)' },
        { name: 'material_of', signature: 'int material_of(int region)' },
    ];
    if (anyQuery) {
        provides.push({ name: 'scene_intersect_any', signature: 'bool scene_intersect_any(Ray ray, float maxDist)' });
    }
    if (plan.materials.some((m) => modelTransmission(m.model))) {
        provides.push({ name: 'ior_of', signature: 'float ior_of(int region)' });
    }

    // Self-require: the generated scene_intersect classifies its boundary through
    // scene_region_at (§4.2) — honest linkage for the seam-unused check. The placement
    // helpers follow the same pattern: provided by the included core file, consumed by
    // the generated wrappers/arms of this same feature.
    const requires = ['scene_region_at'];
    if (plan.program.intersection.drivenPlacement) {
        // Only the helpers the EMITTED code calls (dir/normal are analytic-arm
        // vocabulary; a driven-SDF-only program leaves them as unlisted wholesale
        // residue of the core file, like sdf_intersect_any inside raymarch.glsl).
        const anaDriven = plan.analyticObjects.some((o) => o.placement !== undefined);
        const meshDriven = plan.meshes.some((m) => isDrivenPlacement(m.placement));
        const used = ['placement_rigid', 'placement_scale', ...((anaDriven || meshDriven) ? ['placement_dir', 'placement_normal'] : [])];
        const sigs: Record<string, string> = {
            placement_rigid: 'vec3 placement_rigid(vec4 q, vec4 ts, vec3 p)',
            placement_dir: 'vec3 placement_dir(vec4 q, vec3 d)',
            placement_normal: 'vec3 placement_normal(vec4 q, vec3 n)',
            placement_scale: 'float placement_scale(vec4 ts)',
        };
        provides.push(...used.map((name) => ({ name, signature: sigs[name] })));
        requires.push(...used);
    }
    return { ...emptyContribution('intersection'), blocks, defines, uniforms, parameters, textures, provides, requires };
}

// ============================================================================
// Per-object GLSL identity (naming batch N5)
// ============================================================================
// Authored names flow into emitted symbols: `sdf_<name>` wrappers and hoisted
// `shape_<name>` consts. Names are provenance and collision-LEGAL (fable-transforms
// §7.6), so identifiers are sanitized then deduped; unnamed objects keep the
// `object_<i>` scheme. The map spans BOTH backends (one identifier space).

function objectGlslIds(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[]): Map<number, string> {
    const used = new Set<string>();
    const map = new Map<number, string>();
    for (const o of [...sdf, ...analytic].sort((a, b) => a.index - b.index)) {
        const base = o.name !== undefined ? sanitizeIdent(o.name) : `object_${o.index}`;
        let id = base;
        let n = 2;
        while (used.has(id)) id = `${base}_${n++}`;
        used.add(id);
        map.set(o.index, id);
    }
    return map;
}

function sanitizeIdent(name: string): string {
    // Collapse underscore RUNS: GLSL ES reserves any identifier containing `__`, and
    // ANGLE enforces it while glslang does NOT (the known dialect gap) — flatten
    // provenance paths like 'ball/#0' map char-by-char to 'ball__0' and killed the
    // flatten-tree witness at ANGLE compile (July 17 sweep). Dedup below still
    // disambiguates collapsed collisions.
    let s = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
    if (/^[0-9]/.test(s)) s = 'o_' + s;
    return s;
}

/** A named, CONSTANT-placed object hoists its struct to `const <Type> shape_<id>`
 *  (the `shape_` prefix keeps authored names clear of locals/params in the generated
 *  functions). Driven objects construct in-function (uniforms cannot initialize a
 *  global); unnamed objects keep inline ctors — zero churn where nothing is named. */
function hoistedShapeName(obj: PlannedSDFObject | PlannedAnalyticObject, ids: Map<number, string>): string | null {
    if (obj.name === undefined) return null;
    const driven = 'sdfType' in obj ? isDrivenPlacement(obj.placement) : obj.placement !== undefined;
    if (driven) return null;
    return `shape_${ids.get(obj.index)!}`;
}

function generateNamedShapes(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], ids: Map<number, string>): string | null {
    const lines: string[] = [];
    for (const obj of [...sdf, ...analytic].sort((a, b) => a.index - b.index)) {
        const constName = hoistedShapeName(obj, ids);
        if (constName === null) continue;
        const d = primitive('sdfType' in obj ? obj.sdfType : obj.shapeType);
        lines.push(`const ${structName(d)} ${constName} = ${emitCtor(d, obj.parameters)};`);
    }
    if (lines.length === 0) return null;
    return ['// Generated named shapes (authored names, constant placement — compile-time data)', ...lines].join('\n');
}

// ============================================================================
// SDF backend dispatch (per-scene)
// ============================================================================

function generateSDFDispatch(objects: PlannedSDFObject[], ids: Map<number, string>): string {
    const lines: string[] = [];
    lines.push('// Generated SDF dispatch');

    for (const obj of objects) {
        lines.push(`float sdf_${ids.get(obj.index)!}(vec3 p) {`);
        if (isDrivenPlacement(obj.placement)) {
            // Driven (§6.1): query in the RIGID frame; the similarity-closed primitive
            // params absorb s in-shader — distances stay exact WORLD values, so the
            // marcher's stepping and every epsilon guard hold under live scale.
            const g = obj.placement;
            lines.push(`    p = placement_rigid(${g.uniformQ}, ${g.uniformTS}, p);`);
            lines.push(`    float s = placement_scale(${g.uniformTS});`);
            lines.push(`    return ${generateSDFCall(obj, ids, 's')};`);
        } else {
            lines.push(...emitPlacementQuery(obj.placement));
            // s·d_local keeps the wrapper a WORLD-SPACE distance field — what keeps the
            // marcher's stepping and the epsilon discipline (march_epsilon/EPS_INTERFACE/
            // ray_spawn) valid unchanged (fable-transforms §5.2). s > 0 by Validator pin.
            const scalePrefix = isIdentityScale(obj.placement.scale) ? '' : `${formatFloat(obj.placement.scale)} * `;
            lines.push(`    return ${scalePrefix}${generateSDFCall(obj, ids)};`);
        }
        lines.push(`}`);
        lines.push('');
    }

    // scene_march_bound — UNSIGNED nearest-surface bound min|sdf_i| + its owner (§2.3, arg-min).
    // Unsigned (not the signed min) so marching works from object interiors and, inside a big
    // region, steps stay bounded by nested inner surfaces (|signed min| would overshoot them).
    lines.push('float scene_march_bound(vec3 p, out int region) {');
    lines.push(`    float d = 1e20;`);
    lines.push(`    float d_obj;`);
    lines.push(`    region = -1;`);
    for (const obj of objects) {
        lines.push(`    d_obj = abs(sdf_${ids.get(obj.index)!}(p));`);
        lines.push(`    if (d_obj < d) { d = d_obj; region = ${obj.index}; }`);
    }
    lines.push(`    return d;`);
    lines.push(`}`);
    lines.push('');

    // Per-owner signed SDF — scene_normal takes the gradient of the HIT OBJECT's own field.
    // The global signed min is hijacked by containers: on a nested surface (glass sphere inside
    // a water pool) the pool's deeply-negative sdf wins the min everywhere inside, and its
    // gradient points at the nearest POOL face — cube-quantized normals on the sphere
    // (found by the R-SUBMERGED witness).
    lines.push('float scene_object_sdf(vec3 p, int region) {');
    for (const obj of objects) {
        lines.push(`    if (region == ${obj.index}) return sdf_${ids.get(obj.index)!}(p);`);
    }
    lines.push('    return 1e20;');
    lines.push('}');

    return lines.join('\n');
}

/**
 * World→local query-point lines for one placement (fable-transforms §5.2 tiers).
 * Emits ONLY what the authored transform needs: identity = nothing (byte gate),
 * translation = the historical subtraction (byte gate), rigid = a folded mat3
 * constant (Rᵀ), similarity = Rᵀ/s folded into one mat3 (or a plain division when
 * the rotation is trivial). The caller applies the matching s·d distance correction.
 */
function emitPlacementQuery(g: Similarity): string[] {
    const kind = classifySimilarity(g);
    if (kind === 'identity') return [];
    const t = g.translation;
    const centered = isIdentityTranslation(t) ? 'p' : `(p - ${formatVec3(t)})`;
    if (kind === 'translation') {
        return [`    p = p - ${formatVec3(t)};`];
    }
    if (kind === 'rigid') {
        return [`    p = ${formatMat3(quatToMat3(quatConjugate(g.rotation)))} * ${centered};`];
    }
    // similarity: fold 1/s into the constant so the query costs one mat3-multiply.
    if (isIdentityRotation(g.rotation)) {
        return [`    p = ${centered} / ${formatFloat(g.scale)};`];
    }
    const m = quatToMat3(quatConjugate(g.rotation)).map((v) => v / g.scale);
    return [`    p = ${formatMat3(m)} * ${centered};`];
}

/** The primitive call — DERIVED from the descriptor's schema row (impl-plan-geometry-
 *  descriptors): row order = signature order; kind≠direction params × s under the
 *  driven tier. Named constant objects reference their hoisted shape const; everyone
 *  else gets the inline ctor (literals as folded, or s-scaled expressions). */
function generateSDFCall(obj: PlannedSDFObject, ids: Map<number, string>, scaleExpr?: string): string {
    const constName = hoistedShapeName(obj, ids);
    if (constName !== null) {
        return `${obj.sdfType}_sdf(p, ${constName})`;
    }
    return emitSdfCall(primitive(obj.sdfType), obj.parameters, { point: 'p', scale: scaleExpr });
}

// ============================================================================
// Analytic backend dispatch (per-scene)
// ============================================================================
// Nearest-hit over the analytic objects, and a first-blocker any-hit. p and the shading frame
// come from ambient_geodesic/ambient_frame so they agree with the SDF path (cross-method match).

function generateAnalyticDispatch(objects: PlannedAnalyticObject[], anyQuery: boolean, ids: Map<number, string>): string {
    const lines: string[] = ['// Generated analytic dispatch'];

    // Nearest-hit bounded by the incoming hit.t (the running nearest — set by the caller / a prior
    // backend). Fills the hit's GEOMETRY + owner and shrinks hit.t on a closer object; leaves hit
    // untouched otherwise. region_from/to are classified once by the dispatcher (§4.2).
    lines.push('bool analytic_intersect(Ray ray, inout Hit hit) {');
    lines.push('    bool found = false;');
    lines.push('    float t;');
    for (const obj of objects) {
        const d = primitive(obj.shapeType);
        const sn = structName(d);
        if (obj.placement !== undefined) {
            // Driven (§6.1): conjugate into the RIGID frame once; the struct's
            // length-like fields absorb s in-shader, so t is a WORLD value —
            // comparable on hit.t unchanged, and the primitives' internal EPSILON
            // guards stay world-correct.
            const g = obj.placement;
            lines.push(`    {`);
            lines.push(`        Ray lray = make_ray(placement_rigid(${g.uniformQ}, ${g.uniformTS}, ray.origin), placement_dir(${g.uniformQ}, ray.direction));`);
            lines.push(`        float s = placement_scale(${g.uniformTS});`);
            lines.push(`        ${sn} shape = ${emitCtor(d, obj.parameters, 's')};`);
            lines.push(`        if (${d.type}_intersect(lray, shape, t) && t < hit.t) {`);
            lines.push(`            hit.t = t; found = true;`);
            lines.push(`            hit.p = ambient_geodesic(ray.origin, ray.direction, t);`);
            lines.push(`            hit.frame = ambient_frame(hit.p, placement_normal(${g.uniformQ}, ${d.type}_normal(lray.origin + t * lray.direction, shape)));`);
            lines.push(`            hit.region_owner = ${obj.index};`);
            lines.push(`            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);`);
            lines.push(`        }`);
            lines.push(`    }`);
            continue;
        }
        const constName = hoistedShapeName(obj, ids);
        const shapeRef = constName ?? 'shape';
        lines.push(`    {`);
        if (constName === null) {
            lines.push(`        ${sn} shape = ${emitCtor(d, obj.parameters)};`);
        }
        lines.push(`        if (${d.type}_intersect(ray, ${shapeRef}, t) && t < hit.t) {`);
        lines.push(`            hit.t = t; found = true;`);
        lines.push(`            hit.p = ambient_geodesic(ray.origin, ray.direction, t);`);
        lines.push(`            hit.frame = ambient_frame(hit.p, ${d.type}_normal(hit.p, ${shapeRef}));`);
        lines.push(`            hit.region_owner = ${obj.index};`);
        lines.push(`            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);`);
        lines.push(`        }`);
        lines.push(`    }`);
    }
    lines.push('    return found;');
    lines.push('}');
    lines.push('');

    if (anyQuery) {
        lines.push('bool analytic_intersect_any(Ray ray, float maxDist) {');
        lines.push('    float t;');
        for (const obj of objects) {
            if (obj.placement !== undefined) {
                const g = obj.placement;
                lines.push(`    {`);
                lines.push(`        Ray lray = make_ray(placement_rigid(${g.uniformQ}, ${g.uniformTS}, ray.origin), placement_dir(${g.uniformQ}, ray.direction));`);
                lines.push(`        float s = placement_scale(${g.uniformTS});`);
                lines.push(`        if (${analyticTest(obj, 'lray', ids, 's')} && t < maxDist) return true;`);
                lines.push(`    }`);
                continue;
            }
            lines.push(`    if (${analyticTest(obj, 'ray', ids)} && t < maxDist) return true;`);
        }
        lines.push('    return false;');
        lines.push('}');
    }

    return lines.join('\n');
}

/** GLSL boolean test call that writes `t` — DERIVED from the descriptor row (quad's
 *  precomputed one-sided normal is a derived struct field). Named constant objects
 *  reference their hoisted const; with `scaleExpr` (driven §6.1), the length-like
 *  constructor args are multiplied by s in-shader. */
function analyticTest(obj: PlannedAnalyticObject, rayVar: string, ids: Map<number, string>, scaleExpr?: string): string {
    const constName = hoistedShapeName(obj, ids);
    if (constName !== null) {
        return `${obj.shapeType}_intersect(${rayVar}, ${constName}, t)`;
    }
    return emitAnalyticTest(primitive(obj.shapeType), obj.parameters, rayVar, scaleExpr);
}

/** GLSL expr for the SIGNED distance to `obj` at point `p` (analytic backend) —
 *  derived: thin primitives never claim containment; everyone else reuses their own
 *  <type>_sdf body, so both backends share ONE distance truth per primitive. Named
 *  constant objects reference their hoisted const. */
function analyticSignedDistance(obj: PlannedAnalyticObject, ids: Map<number, string>): string {
    const d = primitive(obj.shapeType);
    if (d.thin) return '1.0e20';
    const constName = hoistedShapeName(obj, ids);
    if (constName !== null) {
        return `${obj.shapeType}_sdf(p, ${constName})`;
    }
    return emitSignedDistance(d, obj.parameters, { point: 'p' });
}

// ============================================================================
// Mesh backend dispatch (per-scene) — impl-plan-meshes
// ============================================================================
// One wholesale triangle leaf (mesh.glsl) shared by every mesh; a generated per-mesh wrapper
// conjugates the world ray into the mesh's LOCAL frame (ray-into-local, t-preserving — the
// local direction is NOT re-normalized, so the local parameter t equals the world t) and
// assembles the world-space Hit. v0 brute force; the leaf is BVH-ready (§5.3).

/** World→local ray conjugation for one mesh placement. Returns the local origin/direction
 *  expressions (t preserved), any setup lines (driven scale), and the local→world normal map
 *  (rotation only — uniform scale never tilts a normal). Constant tiers mirror emitPlacementQuery;
 *  driven reuses the §6.1 placement helpers (rigid/dir/normal + scale), like the analytic arm. */
function emitMeshPlacement(pl: PlannedPlacement): { setup: string[]; ro: string; rd: string; nWorld: (n: string) => string } {
    if (isDrivenPlacement(pl)) {
        return {
            setup: [`float s = placement_scale(${pl.uniformTS});`],
            ro: `placement_rigid(${pl.uniformQ}, ${pl.uniformTS}, ray.origin) / s`,
            rd: `placement_dir(${pl.uniformQ}, ray.direction) / s`,
            nWorld: (n) => `placement_normal(${pl.uniformQ}, ${n})`,
        };
    }
    const g = pl as Similarity;
    const kind = classifySimilarity(g);
    if (kind === 'identity') return { setup: [], ro: 'ray.origin', rd: 'ray.direction', nWorld: (n) => n };
    const t = g.translation;
    if (kind === 'translation') {
        return { setup: [], ro: `ray.origin - ${formatVec3(t)}`, rd: 'ray.direction', nWorld: (n) => n };
    }
    // rigid or similarity: M = Rᵀ (÷ s) folded into one constant mat3 for the inverse map.
    const Rt = quatToMat3(quatConjugate(g.rotation));
    const M = kind === 'rigid' ? Rt : Rt.map((v) => v / g.scale);
    const centered = isIdentityTranslation(t) ? 'ray.origin' : `(ray.origin - ${formatVec3(t)})`;
    const R = quatToMat3(g.rotation);
    const nWorld = isIdentityRotation(g.rotation) ? (n: string) => n : (n: string) => `${formatMat3(R)} * ${n}`;
    return { setup: [], ro: `${formatMat3(M)} * ${centered}`, rd: `${formatMat3(M)} * ray.direction`, nWorld };
}

function generateMeshDispatch(meshes: PlannedMesh[], anyQuery: boolean): string {
    const lines: string[] = ['// Generated mesh dispatch (ray-into-local; brute-force v0)'];

    for (const m of meshes) {
        const o = m.ordinal;
        const pl = emitMeshPlacement(m.placement);
        lines.push(`bool mesh_intersect_${o}(Ray ray, inout Hit hit) {`);
        lines.push(...pl.setup.map((s) => `    ${s}`));
        lines.push(`    vec3 nLocal; vec2 uv;`);
        lines.push(`    if (mesh_nearest_local(u_mesh_${o}_position, u_mesh_${o}_index, u_mesh_${o}_normal, u_mesh_${o}_uv,`);
        lines.push(`            ${m.triCount}u, ${m.smooth}, ${pl.ro}, ${pl.rd}, hit.t, nLocal, uv)) {`);
        // hit.t was shrunk to the local (== world) t inside the leaf; the world point is the
        // world ray at that t (ray-into-local preserves the parameter, impl-plan-meshes §6).
        lines.push(`        hit.p = ambient_geodesic(ray.origin, ray.direction, hit.t);`);
        lines.push(`        hit.frame = ambient_frame(hit.p, normalize(${pl.nWorld('nLocal')}));`);
        lines.push(`        hit.region_owner = ${m.index};`);
        lines.push(`        hit.uv = uv;`);
        lines.push(`        return true;`);
        lines.push(`    }`);
        lines.push(`    return false;`);
        lines.push(`}`);
        lines.push('');
    }

    lines.push('bool mesh_intersect(Ray ray, inout Hit hit) {');
    lines.push('    bool found = false;');
    for (const m of meshes) lines.push(`    if (mesh_intersect_${m.ordinal}(ray, hit)) found = true;`);   // bounded by hit.t
    lines.push('    return found;');
    lines.push('}');

    if (anyQuery) {
        lines.push('');
        for (const m of meshes) {
            const o = m.ordinal;
            const pl = emitMeshPlacement(m.placement);
            lines.push(`bool mesh_intersect_any_${o}(Ray ray, float maxDist) {`);
            lines.push(...pl.setup.map((s) => `    ${s}`));
            // maxDist is a WORLD distance; local t == world t (rd unnormalized), so compare directly.
            lines.push(`    return mesh_any_local(u_mesh_${o}_position, u_mesh_${o}_index, ${m.triCount}u, ${pl.ro}, ${pl.rd}, maxDist);`);
            lines.push(`}`);
        }
        lines.push('bool mesh_intersect_any(Ray ray, float maxDist) {');
        for (const m of meshes) lines.push(`    if (mesh_intersect_any_${m.ordinal}(ray, maxDist)) return true;`);
        lines.push('    return false;');
        lines.push('}');
    }

    return lines.join('\n');
}

// ============================================================================
// Point classification — scene_region_at (§2.7 innermost-wins, §4.2)
// ============================================================================
// Among regions containing p (sdf < 0), the LEAST negative wins (innermost). The bug is one
// flipped inequality away: `d > best` among negatives — deepest-wins made a submerged sphere
// invisible (verification T2 / R-SUBMERGED). Spans both backends.

function generateSceneRegionAt(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], ids: Map<number, string>): string {
    const lines: string[] = ['// Generated point classification (§2.7 innermost-wins)'];
    lines.push('int scene_region_at(vec3 p) {');
    lines.push('    int region = -1;');
    lines.push('    float best = -1.0e20;   // best = least-negative inside distance so far');
    lines.push('    float d;');
    for (const obj of sdf) {
        lines.push(`    d = sdf_${ids.get(obj.index)!}(p);`);
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${obj.index}; }`);
    }
    for (const obj of analytic) {
        if (obj.placement !== undefined && !primitive(obj.shapeType).thin) {
            // Driven (§6.1): classify in the rigid frame with s-scaled params — d stays
            // an exact WORLD signed distance, so innermost-wins compares correctly
            // across constant and driven objects. (Driven THIN primitives fall through:
            // zero thickness never claims containment, placement irrelevant.)
            const g = obj.placement;
            lines.push(`    { vec3 lp = placement_rigid(${g.uniformQ}, ${g.uniformTS}, p); float s = placement_scale(${g.uniformTS});`);
            lines.push(`      d = ${emitSignedDistance(primitive(obj.shapeType), obj.parameters, { point: 'lp', scale: 's' })}; }`);
        } else {
            lines.push(`    d = ${analyticSignedDistance(obj, ids)};`);
        }
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${obj.index}; }`);
    }
    lines.push('    return region;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// region → material table (both backends)
// ============================================================================

function generateMaterialOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], meshes: PlannedMesh[], ambientMedium: number): string {
    const lines: string[] = ['// Generated region -> material table (§2.3), across both backends'];
    lines.push('int material_of(int region) {');
    const all: Array<{ index: number; materialId: number }> = [...sdf, ...analytic, ...meshes];
    for (const obj of all.sort((a, b) => a.index - b.index)) {
        lines.push(`    if (region == ${obj.index}) return ${obj.materialId};`);
    }
    // Default arm covers region -1: the ambientMedium's material id, or -1 = vacuum (§2.4).
    lines.push(`    return ${ambientMedium};`);
    lines.push('}');
    return lines.join('\n');
}

// region → IOR of the region's interior (reference-implementations §2: dielectrics read the far
// side's IOR without a full material-properties fetch). Non-dielectric materials are 1.0
// (vacuum-like — pinned in the Planner), ior_of(-1) = 1.0 (ambient; ambientMedium is a media-era
// concern, §2.4). Value<T>-driven ior reads its uniform (declared via the materials {param} scan).
function generateIorOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], materials: PlannedMaterial[]): string {
    const byId = new Map(materials.map((m) => [m.id, m]));
    const lines: string[] = ['// Generated region -> IOR table (§2.3 family)'];
    lines.push('float ior_of(int region) {');
    for (const obj of [...sdf, ...analytic].sort((a, b) => a.index - b.index)) {
        const mat = byId.get(obj.materialId);
        // Non-transmissive materials are PINNED to 1.0 (fall through to the default), even if the
        // author set an ior on them — an authored lambert ior leaking into the table silently
        // yields η = 1 at adjacent dielectric boundaries (review finding). The Validator warns.
        if (!mat || !modelTransmission(mat.model)) continue;
        // No property name here (materials-§7): the transmission capability implies a
        // region-table row on the declaring model's schema — found structurally.
        const row = MATERIAL_MODELS[mat.model]?.properties.find((p) => p.storage === 'region-table');
        const ior = row !== undefined ? mat.values[row.source] : undefined;
        if (ior === undefined) continue;   // registry-test-enforced; unreachable backstop
        // The constant/driven split is emitValue's — ior_of is a region-indexed SCENE_VALUE
        // (no shading point, so it can't ride scene_material_properties, but the read obeys the
        // same one split point). An expression is rejected (the Validator already diagnosed it).
        const expr = emitValue(ior as ParamValue, formatFloat as (x: never) => string, () => {
            throw new Error(`intersection: material '${mat.name}': ior cannot be a GLSL expression (ior_of is region-indexed, no shading point)`);
        });
        lines.push(`    if (region == ${obj.index}) return ${expr};`);
    }
    lines.push('    return 1.0;'); // ambient / vacuum / non-transmissive regions
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Combined scene_intersect / scene_intersect_any dispatcher
// ============================================================================
// Emitted for exactly the backends present. The running nearest lives on hit.t (initialized to the
// far clip); each backend takes (Ray, inout Hit) and updates hit only if it finds something closer,
// so nearest-hit + bound-shrinking fall out with the Ray read-only (multi-tracing.md §5). Occlusion
// takes an explicit maxDist. See docs/trace-loop-contract.md.
// After the nearest hit is final, the dispatcher classifies the boundary ONCE (§4.2 "never per
// march step"): the owner covers its own side, so a single probe classifies the outside. The probe
// runs along the GEOMETRIC NORMAL, not the ray — the marcher stops MARCH_EPSILON shy of the
// surface, so ray-direction probes fail at grazing incidence; normal probes always clear the
// residual (EPS_INTERFACE = 10× MARCH_EPSILON). Entering ⇒ region_to = owner; exiting ⇒
// region_from = owner and the frame flips so n faces region_from (§4.1).

function generateSceneIntersect(hasSDF: boolean, hasAnalytic: boolean, hasMesh: boolean, thinRegions: number[], anyQuery: boolean): string {
    const lines: string[] = ['// Generated scene_intersect dispatcher'];

    // Zero-thickness owners (quads) never claim containment in scene_region_at, so
    // "owner covers its own side" is FALSE for them: a back-face hit must probe the entering
    // side instead of fabricating region_from = owner — the fabricated value feeds the §4.4
    // self-heal and drops one segment of medium attenuation behind the quad (audit H2).
    if (thinRegions.length > 0) {
        lines.push('bool scene_region_thin(int region) {');
        lines.push(`    return ${thinRegions.map((r) => `region == ${r}`).join(' || ')};`);
        lines.push('}');
        lines.push('');
    }

    // scene_intersect — hit.t is the running nearest (a Hit is valid only when this returns true).
    lines.push('bool scene_intersect(Ray ray, out Hit hit) {');
    lines.push('    hit.t = MAX_DIST;   // running nearest = far clip; rest of hit undefined until a backend fills it');
    lines.push('    bool found = false;');
    if (hasAnalytic) lines.push('    if (analytic_intersect(ray, hit)) found = true;');
    if (hasSDF) lines.push('    if (sdf_intersect(ray, hit)) found = true;');   // bounded by hit.t → only closer
    if (hasMesh) lines.push('    if (mesh_intersect(ray, hit)) found = true;');   // bounded by hit.t → only closer
    lines.push('    if (found) {');
    lines.push('        // §4.2/§4.3: one outside-probe along the outward normal; owner covers its own side.');
    lines.push('        int outside = scene_region_at(ambient_geodesic(hit.p, hit.frame.n, EPS_INTERFACE));');
    lines.push('        if (ambient_dot(ray.direction, hit.frame.n, hit.p) < 0.0) {');
    lines.push('            hit.region_from = outside;              // entering the owner');
    lines.push('            hit.region_to   = hit.region_owner;');
    lines.push('        } else {');
    if (thinRegions.length > 0) {
        lines.push('            // Back-face hit on a zero-thickness owner: probe the entering (-n) side.');
        lines.push('            hit.region_from = scene_region_thin(hit.region_owner)');
        lines.push('                ? scene_region_at(ambient_geodesic(hit.p, hit.frame.n, -EPS_INTERFACE))');
        lines.push('                : hit.region_owner;             // solid owners cover their own side');
    } else {
        lines.push('            hit.region_from = hit.region_owner;     // exiting the owner');
    }
    lines.push('            hit.region_to   = outside;');
    lines.push('            hit.frame = ambient_frame(hit.p, -hit.frame.n);   // §4.1: n faces region_from');
    lines.push('        }');
    lines.push('    }');
    lines.push('    return found;');
    lines.push('}');
    lines.push('');

    // scene_intersect_any — occlusion within maxDist (only when the opaque shadow
    // fast path links it; the media shadow walker re-spawns scene_intersect instead).
    if (anyQuery) {
        lines.push('bool scene_intersect_any(Ray ray, float maxDist) {');
        if (hasAnalytic) lines.push('    if (analytic_intersect_any(ray, maxDist)) return true;');
        if (hasSDF) lines.push('    if (sdf_intersect_any(ray, maxDist)) return true;');
        if (hasMesh) lines.push('    if (mesh_intersect_any(ray, maxDist)) return true;');
        lines.push('    return false;');
        lines.push('}');
    }

    return lines.join('\n');
}
