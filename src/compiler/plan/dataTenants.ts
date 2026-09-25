// compiler/plan/dataTenants.ts — THE scene→ledger adapter (fable-data-rail §4/§7).
//
// One function turns a SceneDescription into the ledger's tenant counts — called by the
// Planner (to bake region bases) AND the App (to pack payloads), so the two sides feed
// planDataLayout identical inputs by construction. Lives compiler-side because it needs
// compiler predicates (the samplable-emitter test); the ledger itself stays pure in
// components/data. Geometry-slot convention (encoded HERE, nowhere else): standalone
// meshes in sceneMeshes order, THEN mesh prototypes in batch-ordinal order.

import type { SceneDescription, MeshObject, PrimitiveObject, InstancedObject, ValueParam, BlackbodyValue, DataReads, LightEmission } from '../types.js';
import type { ProgramDescription } from './types.js';
import { isMeshObject, isPrimitiveObject, hasConstantNonzeroEmission, isGlslExpression, isValueParam, isBlackbody } from '../types.js';
import { isDrivenTransform, isIdentityRotation, similarityFromTransform } from '../../components/geometry/similarity.js';
import { PRIMITIVES, paramsRecordFloats, primitiveIsBounded, resolveBackend, foldPlacementIntoParameters } from '../../components/geometry/index.js';
import { LIGHT_KINDS, applyAuthoredDefaults } from '../../components/lights/index.js';
import { foldBlackbody } from '../../components/lights/blackbody.js';
import { meshWorldArea } from '../../components/lights/mesh/mesh.js';
import { lightTableLayout } from '../../components/lights/table.js';
import { MATERIAL_MODELS, EMISSION_KEY } from '../../components/materials/index.js';
import { sceneMeshes } from '../../components/intersection/mesh/mesh.js';
import { sceneInstanceBatches, instanceAttributeRows, placementCount } from '../../components/intersection/instancing/instancing.js';
import { cwbvhNodeTexelBound } from '../../components/accel/cwbvh/cwbvh.js';
import { ANALYTIC_RECORD_TEXELS, LEAF_ANALYTIC, LEAF_MESH, LEAF_BATCH, LEAF_SDF } from '../../components/intersection/index.js';
import type { DataTenants } from '../../components/data/ledger.js';

/** Which optional data structures a program reads — read off its decisions, which are the
 *  only thing that determines it. Each flag names the one decision that consumes it. */
export function dataReadsOf(program: ProgramDescription): DataReads {
    return {
        cwbvh: program.intersection.classes.instanced && program.intersection.instanceAccel === 'cwbvh',
        lightTree: program.estimator.lighting?.selection === 'bvh',
        sceneTable: program.intersection.objectDispatch === 'table',
    };
}

/** What a set of programs sharing one scene reads: a structure is needed if ANY reads it. */
export function unionDataReads(reads: readonly DataReads[]): DataReads {
    return {
        cwbvh: reads.some((r) => r.cwbvh),
        lightTree: reads.some((r) => r.lightTree),
        sceneTable: reads.some((r) => r.sceneTable),
    };
}

/** Every optional structure. Used only to plan a program's DECISIONS before its data
 *  needs are known (the decisions do not depend on the layout — tested). */
export const READS_EVERYTHING: DataReads = { cwbvh: true, lightTree: true, sceneTable: true };

/** Does material `name` read Hit.uv? — i.e. is it a PROCEDURAL material: the checker model
 *  (readsUv capability) OR any material carrying a GLSL formula (fable-imagery P2 expression
 *  materials). COARSE by choice (owner Jul 21): a formula reading only `p` counts too, matching
 *  the materialsReadUv gate — correctness-safe, slightly over-eager. THE ONE "reads uv" notion,
 *  shared by the chart-EMISSION gate (materialsReadUv) and the rotation-tracking gate
 *  (keepsLocalFrame), so a uv-formula on a ROTATED shape can never silently fall back to an
 *  axis-aligned chart. Precise per-formula uv-detection is the noted follow-up. */
export function materialReadsUv(name: string, scene: SceneDescription): boolean {
    const mat = scene.materials[name];
    if (mat === undefined) return false;
    return (MATERIAL_MODELS[mat.model ?? '']?.capabilities.readsUv ?? false)
        || Object.values(mat).some(isGlslExpression);
}

/** A PATTERNED + rotated analytic shape keeps its own LOCAL frame (fable-imagery P1b): its
 *  material reads Hit.uv and it carries a rotation, so it is NOT folded (the chart needs the
 *  frame the fold would dissolve). Like a driven object it therefore cannot be TABLED (records
 *  assume folded params) and stays in the unrolled wrapper arm. THE ONE predicate both the
 *  table adapter (exclude) and the Planner (retain the similarity) read — so the two decisions
 *  cannot drift. */
export function keepsLocalFrame(obj: PrimitiveObject, scene: SceneDescription): boolean {
    if (PRIMITIVES[obj.type]?.uvChart !== true) return false;
    return materialReadsUv(obj.material, scene) && !isIdentityRotation(similarityFromTransform(obj.transform).rotation);
}

/** One scene-TLAS leaf (canonical pre-TLAS order; the App reorders by the tree). */
export interface SceneTableLeaf {
    /** LEAF_ANALYTIC | LEAF_MESH | LEAF_BATCH | LEAF_SDF. */
    kind: number;
    /** analytic → record slot; mesh → mesh ordinal; batch → batch ordinal;
     *  sdf → index into table.sdf (record slot = analytic.length + ref). */
    ref: number;
}

/** The scene table's ONE truth (fable-object-tables): which objects join, in what
 *  record order (SOLIDS FIRST — the containment loop iterates [0, solidCount)), with
 *  which primitive kind codes. Planner (baked literals + generated dispatch) and App
 *  (record packing + leaf boxes) both read THIS. */
export interface SceneTable {
    leaves: SceneTableLeaf[];
    /** Analytic table objects in RECORD order (solids first). sceneIndex = position in
     *  scene.objects ( ≡ the region id the Planner assigns). */
    analytic: Array<{ sceneIndex: number; type: string; solid: boolean }>;
    solidCount: number;
    /** Primitive kind → the record header's kind code (registry order over present kinds). */
    kindCodes: Map<string, number>;
    /** Boxed-SDF table objects (fable-sdf-accel T2), record slots AFTER the analytic
     *  block in the same region (slot = analytic.length + i). Rotation is ALLOWED here
     *  (the record's rigid tail carries it — unlike the analytic arm, whose folded
     *  record cannot). */
    sdf: Array<{ sceneIndex: number; type: string; solid: boolean }>;
    /** Kind → header code for the SDF ARM, offset past the analytic codes (globally
     *  unique headers; a box may be BOTH an analytic and an SDF record in one scene). */
    sdfKindCodes: Map<string, number>;
}

export interface SceneDataTenants {
    tenants: DataTenants;
    /** Geometry-slot index per BATCH ordinal (null = analytic/SDF prototype, no slot). */
    batchGeometrySlot: Array<number | null>;
    /** Placement-record tier per BATCH ordinal (impl-plan-placement-fold stage 3 — the
     *  §6.1 stride amendment): 'params' = 1-texel folded-parameters record (world-space
     *  intersect, no conjugation), 'frame' = the 2-texel rigid record. THE ONE tier
     *  truth — Planner (prototype decision + ledger stride) and App (record packing)
     *  both read this array, so stride and payload cannot drift. */
    batchPlacementRecord: Array<'frame' | 'params'>;
    /** The scene table, or null when no eligible objects exist. */
    table: SceneTable | null;
    /** Light-eligible batches (fable-light-bvh §7 stage 2), by BATCH ordinal with
     *  instance counts — the eligibility truth's output, consumed by the Planner's
     *  instanceLights slot and the App's tree pack. Empty when none. */
    lightBatches: Array<{ ordinal: number; count: number }>;
}

/** The params-tier decision for one batch: shape facts (paramsRecordFloats — closed ∧
 *  analytic ∧ one texel) ∧ the scene-side uv gate (a uv-reading material's chart is
 *  genuinely rotated by per-instance orientations, so those batches keep the local
 *  frame — keepsLocalFrame's instancing sibling) ∧ no authored 'frame' pin. Decided
 *  from SHAPE and MATERIAL only, never from placement data — retune (repack) can
 *  never change the compiled stride. */
export function batchPlacementRecordOf(b: InstancedObject, scene: SceneDescription): 'frame' | 'params' {
    if (isMeshObject(b.prototype) || b.placementRecord === 'frame') return 'frame';
    // A MARCHED prototype (impl-plan-sdf-as-shape T7) conjugates the ray into its own
    // frame — the bound test and the march both live there — so it takes the frame tier.
    if (resolveBackend(b.prototype.type, b.prototype.backend) === 'sdf') return 'frame';
    if (paramsRecordFloats(b.prototype.type) === null) return 'frame';
    return materialReadsUv(b.prototype.material, scene) ? 'frame' : 'params';
}

/** The ONE samplable-mesh-emitter predicate (fable-mesh-lights): shared by the ledger's
 *  light regions, the Planner's light route, and the App's light-table packing. */
export function meshIsSamplableEmitter(scene: SceneDescription, mesh: MeshObject): boolean {
    const mat = scene.materials[mesh.material];
    return mat !== undefined && mat.sampleAsLight !== false
        && hasConstantNonzeroEmission(mat.emission) && !isDrivenTransform(mesh.transform);
}

/** The light kind an emissive OBJECT of primitive `type` becomes, or undefined if none.
 *  Only kinds that declare the inverse map `valuesFromRegion` qualify: softbeam also backs
 *  onto a 'disk' region, but an emissive disk object is a disk light. */
export function regionLightKind(type: string): string | undefined {
    return Object.values(LIGHT_KINDS).find((k) => k.region?.primitive === type && k.valuesFromRegion !== undefined)?.kind;
}

/** A scene object that enters the light registry as a samplable emitter. */
export interface EmitterObject {
    /** Index into scene.objects (≡ the object's region id). */
    index: number;
    /** The registry light kind it becomes. */
    kind: string;
}

/**
 * THE answer to "which scene OBJECTS are lights" — the object half of the light roster,
 * identity only (no values), in roster order: emissive analytic objects in scene order,
 * then emissive meshes in scene order. An object qualifies when its shape can be sampled
 * as a light (analytic, samplableAsLight, constant placement, no retained local frame)
 * and its material has CONSTANT nonzero emission and has not opted out (sampleAsLight:
 * false). Authored `lights` are the other half of the roster.
 *
 * Everything that needs this fact reads it here — the Analyzer's light count, the
 * Validator's light rules, and lightRosterOf (hence the data layout and the App). Before
 * this, four modules each re-derived it from the raw scene and disagreed at the edges
 * (a blackbody emission, an omitted sampleAsLight flag). Safe on unvalidated scenes: it
 * computes no values, and the cheap material guards run before any placement math.
 */
export function samplableEmitterObjects(scene: SceneDescription): EmitterObject[] {
    const out: EmitterObject[] = [];
    scene.objects.forEach((o, index) => {
        if (!isPrimitiveObject(o)) return;
        if (PRIMITIVES[o.type]?.samplableAsLight !== true) return;
        const mat = scene.materials[o.material];
        if (mat === undefined || mat.sampleAsLight === false) return;
        if (!hasConstantNonzeroEmission(mat.emission)) return;
        if (resolveBackend(o.type, o.backend) !== 'analytic') return;
        if (isDrivenTransform(o.transform) || keepsLocalFrame(o, scene)) return;
        const kind = regionLightKind(o.type);
        if (kind !== undefined) out.push({ index, kind });
    });
    scene.objects.forEach((o, index) => {
        if (isMeshObject(o) && meshIsSamplableEmitter(scene, o)) out.push({ index, kind: 'mesh' });
    });
    return out;
}

/** One light-roster entry: the kind, its UNRESOLVED registry values (driven rows stay
 *  ValueParam/Blackbody; consumers resolve), and where it came from — an authored light
 *  (index into scene.lights) or an emissive object (index into scene.objects, which is also
 *  its region id). */
export interface LightRosterEntry {
    kind: string;
    values: Record<string, number | number[] | ValueParam<number> | ValueParam<number[]> | BlackbodyValue>;
    source: { authored: number } | { object: number };
}

/** An authored light's emission as the light and its backing material use it: a {param}
 *  passes through (the same uniform drives both), a constant blackbody folds to a spectrum,
 *  a scalar broadcasts. One function, so the light's values and its region's emission can
 *  never differ (pt ≡ pt-nee). */
export function authoredLightEmission(e: LightEmission): number[] | ValueParam<number> | ValueParam<number[]> | BlackbodyValue {
    return isValueParam(e) ? e
        : isBlackbody(e) ? foldBlackbody(e)
        : (typeof e === 'number' ? [e, e, e] : e);
}

/** THE light registry, in light-id order (= selection-CDF order): authored lights (scene
 *  order), then emissive analytic objects, then emissive meshes (samplableEmitterObjects'
 *  order). The Planner builds its lights from this list, and the data layout sizes the light
 *  table and tree from it — one list, so they cannot disagree. */
export function lightRosterOf(scene: SceneDescription): LightRosterEntry[] {
    const roster: LightRosterEntry[] = [];

    // Authored lights (unregistered kinds are Validator-rejected, and skipped here).
    scene.lights.forEach((light, lightIndex) => {
        const d = LIGHT_KINDS[light.kind];
        if (d === undefined) return;
        const authored = applyAuthoredDefaults(d, light as unknown as Record<string, unknown>);
        roster.push({ kind: light.kind, values: d.toValues(authored, authoredLightEmission(light.emission)), source: { authored: lightIndex } });
    });

    // Routes 2 and 3 — emissive OBJECTS, from the one census (samplableEmitterObjects),
    // in its order: analytic objects, then meshes. The material emission is constant by
    // the census predicate; a blackbody spelling folds to its constant spectrum here,
    // exactly as the Planner's resolved material value does.
    for (const { index, kind } of samplableEmitterObjects(scene)) {
        const o = scene.objects[index] as PrimitiveObject | MeshObject;
        const raw = scene.materials[o.material]!.emission;
        const em = isBlackbody(raw) ? foldBlackbody(raw) : raw;
        const Le = (typeof em === 'number' ? [em, em, em] : em) as number[];
        if (isMeshObject(o)) {
            // Real values (the mesh kind is tree-eligible — its table row and power read
            // them): radiance, and the s²-folded WORLD area. Only the BOX is pack-side.
            roster.push({
                kind,
                values: { radiance: Le, area: meshWorldArea(o.positions, o.indices, similarityFromTransform(o.transform).scale) },
                source: { object: index },
            });
        } else {
            roster.push({
                kind,
                values: LIGHT_KINDS[kind].valuesFromRegion!(
                    foldPlacementIntoParameters(o.type, o.parameters, similarityFromTransform(o.transform)), Le),
                source: { object: index },
            });
        }
    }

    return roster;
}

/** Every roster kind declares treeBounds → the scene can carry a light tree.
 *  (lightSelection 'bvh' Validator-rejects scenes where this is false.) */
export function lightRosterTreeEligible(roster: readonly LightRosterEntry[]): boolean {
    return roster.every((l) => LIGHT_KINDS[l.kind]?.treeBounds !== undefined);
}

/** Stage-2 batch light-eligibility — THE ONE predicate (fable-light-bvh §7), shared by
 *  the tenant counts, the Planner's decisions, the Validator's warnings, and the App
 *  pack: an instanced batch whose instances become individual tree lights. Analytic
 *  SPHERE prototype on the params tier (the record (center.xyz, r) IS the light row)
 *  with a constant nonzero emissive material that hasn't opted out. Blackbody folds
 *  before the C3 predicate, mirroring the sampleAsLight route. */
export function batchLightEligible(b: InstancedObject, scene: SceneDescription): boolean {
    if (isMeshObject(b.prototype) || b.prototype.type !== 'sphere') return false;
    if (batchPlacementRecordOf(b, scene) !== 'params') return false;
    const mat = scene.materials[b.prototype.material];
    if (mat === undefined || mat.sampleAsLight === false) return false;
    // PER-INSTANCE emission (fable-light-bvh §7.1): an emission attribute on the batch
    // makes every instance an individually-colored light — the tree's per-instance Φ
    // is exactly the selection structure the old attribute deferral was waiting for.
    if (b.attributes !== undefined && EMISSION_KEY in b.attributes
        && (MATERIAL_MODELS[mat.model ?? '']?.properties ?? []).some((f) => f.source === EMISSION_KEY && f.storage === 'field')) {
        return true;
    }
    const em = isBlackbody(mat.emission) ? foldBlackbody(mat.emission) : mat.emission;
    return hasConstantNonzeroEmission(em);
}

/** THE instanced-containment predicate (impl-plan-instanced-containment §2), shared by
 *  the Planner's thin-set decision, the generator's arm emission, and the Validator —
 *  `batchLightEligible`'s sibling, same one-spelling discipline.
 *
 *  Two halves, deliberately separate: WANTS an interior (the prototype material is
 *  transmissive or carries a medium — without one of those, containment would be a
 *  cost nothing reads, so exact linkage says don't emit it) and CAN answer containment
 *  (a mesh prototype must be `closed: true` — the Validator-proven watertightness that
 *  makes first-hit-facing correct; a primitive must not be thin, since zero thickness
 *  never claims containment). A batch that wants but cannot stays in the thin set and
 *  keeps the existing η = 1 warning, which is exactly the right diagnostic. */
export function batchNeedsInterior(b: InstancedObject, scene: SceneDescription): boolean {
    const mat = scene.materials[b.prototype.material];
    if (mat === undefined) return false;
    const wants = MATERIAL_MODELS[mat.model ?? '']?.capabilities.transmission === true
        || mat.medium !== undefined;
    if (!wants) return false;
    return isMeshObject(b.prototype)
        ? b.prototype.closed === true
        : PRIMITIVES[b.prototype.type]?.thin !== true;
}

/** The number of regions: one per scene object (every kind takes exactly one region id,
 *  in scene order), plus one per authored light that desugars to a hittable region. The
 *  ids themselves are the Planner's assignment (RenderPlan objects/meshes/instanceBatches). */
export function regionCountOf(scene: SceneDescription): number {
    return scene.objects.length + scene.lights.filter((l) => LIGHT_KINDS[l.kind]?.region !== undefined).length;
}

/** The scene's data tenants, laid out for exactly the optional structures in `reads` (the
 *  union of what the scene's programs read — `unionDataReads`). The Planner and the App must
 *  pass the SAME reads, so the offsets the Planner bakes are where the App packs. */
export function dataTenantsOf(scene: SceneDescription, reads: DataReads): SceneDataTenants {
    const meshes = sceneMeshes(scene.objects);
    const batches = sceneInstanceBatches(scene.objects);

    const geo = meshes.map((m) => ({ vertexCount: m.positions.length / 3, triCount: m.indices.length / 3 }));
    const batchGeometrySlot: Array<number | null> = [];
    for (const b of batches) {
        if (isMeshObject(b.prototype)) {
            batchGeometrySlot.push(geo.length);
            geo.push({ vertexCount: b.prototype.positions.length / 3, triCount: b.prototype.indices.length / 3 });
        } else {
            batchGeometrySlot.push(null);
        }
    }

    const batchPlacementRecord = batches.map((b) => batchPlacementRecordOf(b, scene));
    // CWBVH regions: only when some program reads the CWBVH, and only for the batches it
    // can serve (params-tier analytic batches WITHOUT attributes — fable-accel-cwbvh §6).
    const batchTenants = batches.map((b, i) => {
        const n = placementCount(b.placements);
        const attrTexels = instanceAttributeRows(scene.materials[b.prototype.material]?.model ?? '', b.attributes ?? {}).length * n;
        const cwbvhEligible = reads.cwbvh && batchPlacementRecord[i] === 'params' && attrTexels === 0;
        return {
            instanceCount: n,
            placementTexels: (batchPlacementRecord[i] === 'params' ? 1 : 2) as 1 | 2,
            attrTexels,
            cwbvhNodeTexels: cwbvhEligible ? cwbvhNodeTexelBound(n) : 0,
            cwbvhRecordTexels: cwbvhEligible ? n : 0,
        };
    });

    const meshLights = meshes
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => meshIsSamplableEmitter(scene, m))
        .map(({ m, i }) => ({ meshOrdinal: i, vertexCount: m.positions.length / 3, triCount: m.indices.length / 3 }));

    // ── The scene TABLE (fable-object-tables): eligible = bounded, CONSTANT-placement
    // analytic objects + constant meshes + every batch. Driven/unbounded objects stay in
    // the residual unrolled arm; SDF objects stay in the marcher arm. Analytic records
    // order SOLIDS FIRST (the containment loop's range). Built only when some program uses
    // table dispatch (reads.sceneTable).
    const analyticEligible: Array<{ sceneIndex: number; type: string; solid: boolean }> = [];
    scene.objects.forEach((o, i) => {
        if (!isPrimitiveObject(o)) return;
        if (isDrivenTransform(o.transform) || keepsLocalFrame(o, scene)) return;   // not folded → residual, never tabled
        if (resolveBackend(o.type, o.backend) !== 'analytic') return;
        const d = PRIMITIVES[o.type];
        if (!primitiveIsBounded(o.type)) return;   // unbounded (plane) → residual (derived bounds count — primitiveIsBounded)
        // A NON-closed analytic shape (box/cylinder — placement-fold stage 4) tables
        // only under IDENTITY rotation: the analytic record is FOLDED params, and the
        // fold cannot absorb R (foldPlacementIntoParameters throws on rotated
        // non-closed). Rotated ones stay in the residual rigid arm — their tabled
        // form is the quat-carrying record the boxed-SDF design defers
        // (fable-sdf-accel §2.1).
        if (d.similarityClosed !== true && !isIdentityRotation(similarityFromTransform(o.transform).rotation)) return;
        analyticEligible.push({ sceneIndex: i, type: o.type, solid: d.thin !== true });
    });
    const analytic = [...analyticEligible.filter((a) => a.solid), ...analyticEligible.filter((a) => !a.solid)];
    const kindCodes = new Map<string, number>();
    for (const t of Object.keys(PRIMITIVES)) {
        if (analytic.some((a) => a.type === t)) kindCodes.set(t, kindCodes.size);
    }
    // ── Boxed-SDF leaves (fable-sdf-accel / impl-plan-sdf-accel T2): eligible =
    // bounded, CONSTANT-placement, frame-free SDF-backend objects — ROTATION allowed
    // (the record's §6.1 rigid tail carries it; the interval march conjugates once
    // per leaf). Driven/unbounded/frame-retained stay in the residual global marcher
    // (the analytic rule verbatim). Solids first, mirroring the analytic block.
    const sdfEligible: Array<{ sceneIndex: number; type: string; solid: boolean }> = [];
    scene.objects.forEach((o, i) => {
        if (!isPrimitiveObject(o)) return;
        if (isDrivenTransform(o.transform) || keepsLocalFrame(o, scene)) return;
        if (resolveBackend(o.type, o.backend) !== 'sdf') return;
        const d = PRIMITIVES[o.type];
        if (!primitiveIsBounded(o.type)) return;   // unbounded (plane) → residual (derived bounds count — primitiveIsBounded)
        // The record budget: texel-padded params + derived + the 2-texel rigid tail
        // must fit the shared stride (sdfRecordPack throws past it; degrade-to-residual
        // here so an exotic pinned type renders through the global marcher instead of
        // erroring). Mirrors sdfTailTexel's alignment.
        const rowFloats = [...d.params, ...(d.derivedFields ?? [])].reduce((acc, r) => acc + (r.shape === 'vec3' ? 3 : 1), 0);
        if (1 + Math.ceil(rowFloats / 4) + 2 > ANALYTIC_RECORD_TEXELS) return;
        sdfEligible.push({ sceneIndex: i, type: o.type, solid: d.thin !== true });
    });
    const sdf = [...sdfEligible.filter((s) => s.solid), ...sdfEligible.filter((s) => !s.solid)];
    const sdfKindCodes = new Map<string, number>();
    for (const t of Object.keys(PRIMITIVES)) {
        if (sdf.some((s) => s.type === t)) sdfKindCodes.set(t, kindCodes.size + sdfKindCodes.size);
    }
    const leaves: SceneTableLeaf[] = [
        ...analytic.map((_, slot) => ({ kind: LEAF_ANALYTIC, ref: slot })),
        ...meshes.map((m, i) => ({ m, i })).filter(({ m }) => !isDrivenTransform(m.transform)).map(({ i }) => ({ kind: LEAF_MESH, ref: i })),
        ...batches.map((_, i) => ({ kind: LEAF_BATCH, ref: i })),
        ...sdf.map((_, i) => ({ kind: LEAF_SDF, ref: i })),
    ];
    const table: SceneTable | null = reads.sceneTable && leaves.length > 0
        ? { leaves, analytic, solidCount: analytic.filter((a) => a.solid).length, kindCodes, sdf, sdfKindCodes }
        : null;

    // The light tree (fable-light-bvh §5/§7): leaves = the registry roster PLUS every
    // light-eligible batch's instances (the global light-index space). Built only when some
    // program selects lights with it (reads.lightTree), the total is non-empty and every
    // roster kind has treeBounds. Table rows exist ONLY for the roster (batch lights read
    // their placement records); trails cover the total. `lightBatches` is returned either
    // way: which instances are lights is a scene fact the Planner's decisions use.
    const roster = lightRosterOf(scene);
    const lightBatches = batches
        .map((b, ordinal) => ({ ordinal, count: placementCount(b.placements), eligible: batchLightEligible(b, scene) }))
        .filter((b) => b.eligible)
        .map(({ ordinal, count }) => ({ ordinal, count }));
    const totalLights = roster.length + lightBatches.reduce((a, b) => a + b.count, 0);
    const lightTree = reads.lightTree && totalLights > 0 && lightRosterTreeEligible(roster)
        ? { count: totalLights, tableTexels: roster.length * (roster.length > 0 ? lightTableLayout(roster.map((l) => l.kind)).strideTexels : 0) }
        : null;

    return {
        tenants: {
            meshes: geo, batches: batchTenants, meshLights,
            sceneTable: table !== null
                // analyticTexels covers BOTH record families since T2 — analytic AND
                // boxed-SDF entries share the region and the 5-texel stride.
                ? { leafCount: table.leaves.length, analyticTexels: (table.analytic.length + table.sdf.length) * ANALYTIC_RECORD_TEXELS }
                : null,
            lightTree,
            // Allocated with the table (only 'table' programs read the data form of
            // material_of); count covers EVERY region incl. desugared light regions.
            regionMaterials: table !== null ? { count: regionCountOf(scene) } : null,
        },
        batchGeometrySlot,
        batchPlacementRecord,
        table,
        lightBatches,
    };
}
