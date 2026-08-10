// compiler/generate/features/intersection.ts
// Geometry backends + the generated scene_intersect dispatcher.
//
// A scene may use the SDF backend (marching), the analytic backend (closed-form), or both.
// scene_intersect / scene_intersect_any are GENERATED to combine only the backends present —
// so "swapping the details of intersect" is exactly what the codegen does. Region ids are
// globally unique across both backends (§2.3), so material_of() spans them.

import type { RenderPlan, PlannedSDFObject, PlannedAnalyticObject, PlannedMesh, PlannedInstanceBatch, PlannedMaterial, PlannedSceneTable, DrivenPlacement, PlannedPlacement } from '../../plan/types.js';
import { isDrivenPlacement } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution, type PlannedTexture } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatMat3, formatVec3, formatVec4 } from '../../../components/glsl-format.js';
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
    rigidInverse,
    type Similarity,
} from '../../../components/geometry/similarity.js';

import raymarchGLSL from '../../../components/intersection/raymarch/raymarch.glsl?raw';
import bvhWalkGLSL from '../../../components/accel/bvh/bvh.glsl?raw';
import cwbvhWalkGLSL from '../../../components/accel/cwbvh/cwbvh.glsl?raw';
import { CWBVH_STACK_DEPTH } from '../../../components/accel/cwbvh/cwbvh.js';
import { NODESQ_EXTERN, NODESQ_UNIFORM } from '../../../components/data/channels.js';
import meshGLSL from '../../../components/intersection/mesh/mesh.glsl?raw';
import { MESH_TRAVERSALS, INSTANCE_ACCELS, ANALYTIC_RECORD_TEXELS, LEAF_ANALYTIC, LEAF_MESH, LEAF_SDF } from '../../../components/intersection/index.js';
import { generateRecordReader, sdfTailTexel } from '../records.js';
import { DATA_TEX_WIDTH } from '../../../components/data/pack.js';
import { BVH_STACK_DEPTH, BVH_TFAR_PAD, bvhWalkLines } from '../../../components/accel/bvh/bvh.js';
import placementGLSL from '../../../glsl/core/placement.glsl?raw';
import dataTextureGLSL from '../../../glsl/core/data_texture.glsl?raw';
import { structFromRows } from '../schema.js';

export function contributeIntersection(plan: RenderPlan): FeatureContribution {
    // Backend presence is a link-map decision (ProgramDescription.intersection.backends) —
    // no scene with geometry is empty, but a fully-empty scene contributes nothing.
    const { sdf: hasSDF, analytic: hasAnalytic, mesh: hasMesh, instanced: hasInstanced } = plan.program.intersection.backends;
    if (!hasSDF && !hasAnalytic && !hasMesh && !hasInstanced) {
        return emptyContribution('intersection');
    }
    // The data rail (data_texel1d) + the accel walk support (bvh_aabb_hit/BVH_STACK_DEPTH)
    // are needed by any BVH walk — the mesh BLAS AND every instance TLAS (analytic-only
    // included: placement reads use data_texel1d). The triangle LEAF (mesh.glsl) is needed
    // only for actual triangle geometry.
    // Table dispatch (fable-object-tables): the SCALE regime — tabled objects leave the
    // unrolled arms for the scene-TLAS walk; driven/unbounded objects stay in the
    // RESIDUAL unrolled arms beside it (plus the SDF arm, unchanged).
    const tableMode = plan.program.intersection.objectDispatch === 'table' && plan.sceneTable !== undefined;
    const table = tableMode ? plan.sceneTable : undefined;
    // Boxed-SDF leaves present (impl-plan-sdf-accel T3): gates placement.glsl (the
    // leaf march conjugates by the record's rigid tail) ahead of the dispatch blocks.
    const tabledSdfPresent = tableMode && (table?.sdfRecords.length ?? 0) > 0;
    // Light-tree selection (fable-light-bvh §5): the lighting feature's generated walks
    // read nodes/records through the rail — this feature owns the addressing
    // (data_texel1d + DATA_TEX_WIDTH), so a rail-free scene under 'bvh' still gets it.
    const bvhLighting = plan.program.estimator.lighting?.selection === 'bvh'
        && plan.lights.length > 0 && plan.lightTree !== undefined;
    const needDataRail = hasMesh || hasInstanced || tableMode || bvhLighting;
    const needMeshLeaf = hasMesh || plan.instanceBatches.some((b) => b.prototype.backend === 'mesh');
    const ids = objectGlslIds(plan.objects, plan.analyticObjects, plan.meshes, plan.instanceBatches);
    const blocks: ShaderBlock[] = [];
    const defines: FeatureContribution['defines'] = {};
    const textures: PlannedTexture[] = [];

    // Driven placement (fable-transforms §6/§6.1): the rigid-frame query helpers +
    // per-object uniform pairs + slider metadata. Gated on the Planner's decision —
    // constant-only scenes carry ZERO placement machinery (exact linkage).
    const drivenRecords: DrivenPlacement[] = [
        ...plan.objects.map((o) => o.placement).filter(isDrivenPlacement),
        ...plan.analyticObjects.map((o) => o.placement).filter((p): p is DrivenPlacement => p !== undefined && isDrivenPlacement(p)),
        ...plan.meshes.map((m) => m.placement).filter(isDrivenPlacement),
    ];
    // A patterned + rotated constant analytic shape keeps a similarity placement (P1b) and
    // calls the SAME placement_* helpers as a driven object — but bakes constant vec4s, so it
    // needs the ABI block WITHOUT being authored-driven (no uniforms). Broaden the placement
    // gate to any PLACED analytic object; the driven-uniform machinery above stays uniform-only.
    const placedAnalytic = plan.analyticObjects.some((o) => o.placement !== undefined);
    const uniforms: FeatureContribution['uniforms'] = [];
    const parameters: FeatureContribution['parameters'] = {};
    // placement.glsl (the rigid-frame ABI) is needed by driven placement AND by every instance
    // batch (the loop conjugates the ray with placement_rigid/dir/normal/scale).
    if (plan.program.intersection.drivenPlacement || hasInstanced || placedAnalytic || tabledSdfPresent) {
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
        // Instanced analytic prototypes contribute their primitive's struct + glsl too.
        ...plan.instanceBatches.flatMap((b) => b.prototype.backend === 'analytic' ? [b.prototype.shapeType] : []),
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

    // Real uv charts (fable-imagery P1) emit only when some scene material reads uv — else
    // every hit-fill keeps the cheap planar placeholder (no wasted chart trig).
    const chartUv = plan.program.materials.materialsReadUv;

    // SDF backend: per-scene march-bound dispatch + the marcher (sdf_intersect*).
    // Boxed-SDF leaves (impl-plan-sdf-accel T3): under table dispatch the GLOBAL
    // marcher shrinks to the RESIDUAL subset (driven/unbounded/frame-retained —
    // residualAnalytic's mirror); tabled objects march per leaf in the scene-table
    // block, and their region-keyed queries (scene_object_sdf/uv — normals,
    // containment, interior) route through the per-TYPE record-driven field helpers
    // (prototyped here, defined with the table).
    const residualSdf = tableMode ? plan.objects.filter((o) => o.tabled !== true) : plan.objects;
    const tabledSdf: SdfLeafArm[] = tableMode && table !== undefined && plan.sceneTable !== undefined
        ? plan.sceneTable.sdfRecords.map((s, i) => ({
            region: s.region, type: s.type,
            rbase: plan.sceneTable!.slot.analyticBase + (plan.sceneTable!.analyticCount + i) * ANALYTIC_RECORD_TEXELS,
        }))
        : [];
    if (hasSDF) {
        blocks.push({ origin: 'generated:sdf-dispatch', source: generateSDFDispatch(residualSdf, tabledSdf, ids, chartUv) });
        blocks.push({ origin: 'components/intersection/raymarch/raymarch.glsl', source: raymarchGLSL });
    }

    // The occlusion query chain is a seam decision (impl-plan-exact-linkage): the opaque
    // shadow fast path is its only caller. The generated walkers (analytic_intersect_any,
    // scene_intersect_any) are gated together; sdf_intersect_any rides inside raymarch.glsl
    // regardless (whole-component inclusion — the declared cost).
    const anyQuery = plan.program.intersection.anyQuery;

    // Analytic backend: per-scene analytic_intersect* dispatch over the closed forms —
    // under table dispatch, only the RESIDUAL subset (driven/unbounded) unrolls here.
    const residualAnalytic = tableMode ? plan.analyticObjects.filter((o) => o.tabled !== true) : plan.analyticObjects;
    if (hasAnalytic && residualAnalytic.length > 0) {
        blocks.push({ origin: 'generated:analytic-dispatch', source: generateAnalyticDispatch(residualAnalytic, anyQuery, ids, chartUv) });
    }

    // The rail's addressing (glsl/core/data_texture.glsl: data_texel1d at DATA_TEX_WIDTH)
    // + accel's ray-walk support (accel/bvh/bvh.glsl: bvh_aabb_hit, BVH_STACK_DEPTH) —
    // needed by ANY BVH walk: the mesh BLAS AND every instance TLAS (incl. analytic-only,
    // whose placement reads use data_texel1d). Included once, addressing first, before the
    // triangle leaf + the dispatch blocks that call them. The triangle LEAF (mesh.glsl) is
    // pulled ONLY when real triangle geometry exists (a mesh object or a mesh-prototype
    // instance) — an analytic-only instanced scene drags no dead triangle code.
    if (needDataRail) {
        defines.DATA_TEX_WIDTH = String(DATA_TEX_WIDTH);
        defines.BVH_STACK_DEPTH = String(BVH_STACK_DEPTH);
        defines.BVH_TFAR_PAD = String(BVH_TFAR_PAD);
        blocks.push({ origin: 'glsl/core/data_texture.glsl', source: dataTextureGLSL });
        blocks.push({ origin: 'components/accel/bvh/bvh.glsl', source: bvhWalkGLSL });
    }
    // The CWBVH occupant (fable-accel-cwbvh): scalar helpers + the integer node
    // channel + its stack depth — exact-linkage gated on the SELECTED engine.
    const cwbvhMode = hasInstanced && plan.program.intersection.instanceAccel === 'cwbvh';
    if (cwbvhMode) {
        defines.CWBVH_STACK_DEPTH = String(CWBVH_STACK_DEPTH);
        blocks.push({ origin: 'components/accel/cwbvh/cwbvh.glsl', source: cwbvhWalkGLSL });
        textures.push({ name: NODESQ_UNIFORM, source: `extern:${NODESQ_EXTERN}`, samplerType: 'usampler2D' });
    }
    if (needMeshLeaf) {
        blocks.push({ origin: 'components/intersection/mesh/mesh.glsl', source: meshGLSL });
    }

    // Rail v2 channel declarations (fable-data-rail §3) — role-shaped, tenant-count-free.
    // The vertex-ish quartet declares together whenever triangle geometry exists (the
    // leaf's fixed sampler signature — the v0 "all four present" pin). The nodes channel
    // is exact-linkage gated: bvh traversal, containment queries, mesh prototypes (always
    // BLAS-walked), or a live TLAS. The records channel serves the instance reads.
    if (needMeshLeaf) {
        textures.push(
            { name: 'u_data_vertices', source: 'extern:data_vertices' },
            { name: 'u_data_indices', source: 'extern:data_indices' },
            { name: 'u_data_normals', source: 'extern:data_normals' },
            { name: 'u_data_uvs', source: 'extern:data_uvs' },
        );
    }
    const meshEngine = MESH_TRAVERSALS[plan.program.intersection.meshTraversal];
    const instAccel = INSTANCE_ACCELS[plan.program.intersection.instanceAccel];
    const needNodes = (hasMesh && meshEngine.nodeTexture)
        || plan.meshes.some((m) => m.closed)
        || plan.instanceBatches.some((b) => b.prototype.backend === 'mesh')
        || (hasInstanced && instAccel.tlasTexture)
        || tableMode;   // the scene TLAS
    if (needNodes) textures.push({ name: 'u_data_nodes', source: 'extern:data_nodes' });
    if (hasInstanced || tableMode) textures.push({ name: 'u_data_records', source: 'extern:data_records' });

    const residualMeshes = tableMode
        ? plan.meshes.filter((m) => !table!.tabledMeshOrdinals.includes(m.ordinal))
        : plan.meshes;
    if (hasMesh) {
        blocks.push({ origin: 'generated:mesh-dispatch', source: generateMeshDispatch(plan.meshes, anyQuery, plan.program.intersection.meshTraversal, ids, residualMeshes) });
    }

    // Instanced batches (impl-plan-instancing): one prototype × N placements = the driven wrapper
    // looped over a placement texture. Mesh prototypes traverse their shared BLAS (bvh); analytic
    // prototypes intersect the closed form with s-scaled params. One region per batch.
    if (hasInstanced) {
        blocks.push({ origin: 'generated:instance-dispatch', source: generateInstanceDispatch(plan.instanceBatches, anyQuery, plan.program.intersection.instanceAccel, ids, !tableMode, chartUv) });
    }

    // The scene table (fable-object-tables): record readers + leaf dispatch + the scene
    // TLAS walk. Emitted AFTER the mesh/batch wrappers it dispatches into.
    if (tableMode) {
        blocks.push({ origin: 'generated:scene-table', source: generateSceneTable(table!, plan, ids, anyQuery) });
    }

    // region → material table spans ALL backends (regions are globally unique).
    blocks.push({ origin: 'generated:material-of', source: generateMaterialOf(plan.objects, plan.analyticObjects, plan.meshes, plan.instanceBatches, plan.ambientMedium) });

    // region → IOR table (§2.3 generated-tables family) — only when a transmissive model
    // reads it (capability-driven, R1a; both readers — dielectric_sample and the walk's
    // eta_scale site — pass the hit point since the GRIN-interface unification).
    if (plan.materials.some((m) => modelTransmission(m.model))) {
        blocks.push({ origin: 'generated:ior-of', source: generateIorOf(plan.objects, plan.analyticObjects, plan.meshes, plan.materials) });
    }

    // Point classification (§2.7 innermost-wins) — consumed by the dispatcher's §4.2 step.
    blocks.push({ origin: 'generated:scene-region-at', source: generateSceneRegionAt(plan.objects, plan.analyticObjects, plan.meshes, ids, table) });

    // The top-level dispatcher, combining only the backends present (declared after all).
    // Zero-thickness regions (descriptor `thin` fact): they never claim containment, so
    // the dispatcher's owner-covers-own-side shortcut is invalid for them (audit H2). Meshes
    // are thin-like in v0 (surface-only, excluded from scene_region_at — impl-plan-meshes §3),
    // so their regions join the thin set: a back-face mesh hit probes the entering side.
    const thinRegions = [
        ...plan.analyticObjects.filter((o) => primitive(o.shapeType).thin).map((o) => o.index),
        // Open meshes are thin; CLOSED meshes have a proven interior (fable-mesh-containment)
        // and claim containment in scene_region_at instead.
        ...plan.meshes.filter((m) => !m.closed).map((m) => m.index),
        // Instanced batches are opaque surface-only in v1 (like meshes) → thin-like.
        ...plan.instanceBatches.map((b) => b.index),
    ];
    blocks.push({
        origin: 'generated:scene-intersect',
        source: generateSceneIntersect({
            analytic: hasAnalytic && residualAnalytic.length > 0,
            // The GLOBAL marcher arm serves the residual subset only (T3) — an
            // all-tabled scene's sdf_intersect is never called (raymarch.glsl rides
            // wholesale regardless: march_epsilon/raymarch_commit serve the leaves).
            sdf: hasSDF && residualSdf.length > 0,
            mesh: hasMesh && residualMeshes.length > 0,
            instanced: hasInstanced && !tableMode,
            table: tableMode,
        }, thinRegions, anyQuery),
    });

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
        provides.push({ name: 'ior_of', signature: 'float ior_of(int region, vec3 p)' });
    }

    // Self-require: the generated scene_intersect classifies its boundary through
    // scene_region_at (§4.2) — honest linkage for the seam-unused check. The placement
    // helpers follow the same pattern: provided by the included core file, consumed by
    // the generated wrappers/arms of this same feature.
    const requires = ['scene_region_at'];
    if (needDataRail) {
        // The rail's addressing: provided by the included glsl/core/data_texture.glsl,
        // consumed by this feature's generated walks AND (cross-feature) by the materials
        // fill's attribute fetches — declared so the interface header forward-declares it
        // (order-independence) and seam-unused stays honest.
        provides.push({ name: 'data_texel1d', signature: 'ivec2 data_texel1d(uint i)' });
        requires.push('data_texel1d');
    }
    if (plan.program.intersection.drivenPlacement || hasInstanced || placedAnalytic || tabledSdfPresent) {
        // Only the helpers the EMITTED code calls (dir/normal are analytic-arm
        // vocabulary; a driven-SDF-only program leaves them as unlisted wholesale
        // residue of the core file, like sdf_intersect_any inside raymarch.glsl).
        // Instance batches always use all four (rigid/dir/normal/scale) in the loop;
        // the SDF leaf march uses rigid + dir (normals come from the conjugated
        // field's gradient — no placement_normal).
        const meshDriven = plan.meshes.some((m) => isDrivenPlacement(m.placement));
        const used = ['placement_rigid', 'placement_scale', ...((placedAnalytic || meshDriven || hasInstanced || tabledSdfPresent) ? ['placement_dir', 'placement_normal'] : [])];
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
// Authored names flow into emitted symbols: `sdf_<name>`/`mesh_<name>`/`instance_<name>`
// wrappers and hoisted `shape_<name>` consts. Names are provenance and collision-LEGAL
// (fable-transforms §7.6), so identifiers are sanitized then deduped; unnamed objects
// keep the `object_<i>` scheme. The map spans ALL backends (one identifier space,
// keyed by the shared region index).

function objectGlslIds(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], meshes: PlannedMesh[], batches: PlannedInstanceBatch[]): Map<number, string> {
    const used = new Set<string>();
    const map = new Map<number, string>();
    for (const o of [...sdf, ...analytic, ...meshes, ...batches].sort((a, b) => a.index - b.index)) {
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

/** One tabled SDF object's leaf arm (impl-plan-sdf-accel T3): region id + kind + the
 *  BAKED record base texel. Slot order = plan.sceneTable.sdfRecords order. */
interface SdfLeafArm { region: number; type: string; rbase: number }

function generateSDFDispatch(objects: PlannedSDFObject[], tabled: SdfLeafArm[], ids: Map<number, string>, chartUv: boolean): string {
    const lines: string[] = [];
    lines.push('// Generated SDF dispatch');

    // Per-TYPE record-driven field helpers for TABLED objects — PROTOTYPES here
    // (the definitions live with the scene table, after the data rail + record
    // readers they need): the region-keyed queries below call them, so normals,
    // containment, and interior marching for tabled owners work off the SAME record
    // the leaf march reads.
    const tabledTypes = [...new Set(tabled.map((s) => s.type))];
    for (const t of tabledTypes) {
        lines.push(`float sdf_leaf_field_${t}(vec3 p, uint rbase);`);
        if (chartUv && primitive(t).uvChart) lines.push(`vec2 uv_leaf_${t}(vec3 p, uint rbase);`);
    }
    if (tabledTypes.length > 0) lines.push('');

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

    // Per-owner UV chart helpers (fable-imagery P1) — mirror sdf_<id>: the SAME world→local
    // placement wrapper (so the chart inherits the placement's rotation — an SDF sphere gets an
    // oriented chart for free, unlike the constant-folded analytic path, P1b), but NO scale
    // prefix (uv is dimensionless; the shape ctor still absorbs s so (p−center)/radius is
    // consistent). Only charted owners emit one; the dispatch below falls back to planar.
    for (const obj of objects) {
        const d = primitive(obj.sdfType);
        if (!d.uvChart || !chartUv) continue;
        lines.push(`vec2 uv_${ids.get(obj.index)!}(vec3 p) {`);
        if (isDrivenPlacement(obj.placement)) {
            const g = obj.placement;
            lines.push(`    p = placement_rigid(${g.uniformQ}, ${g.uniformTS}, p);`);
            lines.push(`    float s = placement_scale(${g.uniformTS});`);
            lines.push(`    return ${d.type}_uv(p, ${uvShapeRef(obj, ids, 's')});`);
        } else {
            lines.push(...emitPlacementQuery(obj.placement));
            lines.push(`    return ${d.type}_uv(p, ${uvShapeRef(obj, ids)});`);
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
    // Tabled owners (T3): one-line arms through the per-type record helpers — the
    // gradient of a conjugated field IS the world gradient (chain rule through the
    // rigid map), so scene_normal needs no placement_normal here.
    for (const s of tabled) {
        lines.push(`    if (region == ${s.region}) return sdf_leaf_field_${s.type}(p, ${s.rbase}u);`);
    }
    lines.push('    return 1e20;');
    lines.push('}');
    lines.push('');

    // Per-owner UV chart dispatch (fable-imagery P1) — scene_object_sdf's sibling: the marcher's
    // hit-fill dispatches on the hit owner. Charted owners route to uv_<id>; the rest keep the
    // planar placeholder. Always emitted alongside scene_object_sdf (the static marcher calls it
    // unconditionally, same as scene_object_sdf).
    lines.push('vec2 scene_object_uv(vec3 p, int region) {');
    for (const obj of objects) {
        if (chartUv && primitive(obj.sdfType).uvChart) {
            lines.push(`    if (region == ${obj.index}) return uv_${ids.get(obj.index)!}(p);`);
        }
    }
    for (const s of tabled) {
        if (chartUv && primitive(s.type).uvChart) {
            lines.push(`    if (region == ${s.region}) return uv_leaf_${s.type}(p, ${s.rbase}u);`);
        }
    }
    lines.push('    return vec2(p.x * UV_PLANAR_SCALE, p.z * UV_PLANAR_SCALE);');
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

/** Hit.uv fill for an analytic hit-fill site (fable-imagery P1). The primitive's real chart
 *  when it declares `uvChart` AND some scene material reads uv (`chartUv` = the scene-level
 *  materialsReadUv gate — no chart trig when nothing consumes it); the planar-placeholder
 *  (world xz) fallback otherwise. `chartPoint` is the point in the primitive's OWN frame —
 *  world `hit.p` for the folded constant arm, the rigid-frame local point for the placed
 *  arm (driven or a patterned shape's retained constant placement, P1b) so the chart tracks
 *  the placement's rotation. */
function uvFill(d: ReturnType<typeof primitive>, chartPoint: string, shapeRef: string, chartUv: boolean): string {
    return d.uvChart && chartUv
        ? `hit.uv = ${d.type}_uv(${chartPoint}, ${shapeRef});`
        : `hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);`;
}

/** The rigid-frame ABI (§6.1) references for a placed analytic object — driven OR constant.
 *  Driven objects forward their two uniform names; a CONSTANT placement retained for a
 *  patterned shape (fable-imagery P1b) bakes the SAME `rigidInverse` payloads as compile-time
 *  vec4 literals, so the ONE wrapper arm serves both — a patterned shape is a movable shape
 *  with constant numbers. `placement_scale`/`_rigid`/`_dir`/`_normal` accept const args
 *  identically, so the arm body below is untouched. */
function placementRefs(p: PlannedPlacement): { q: string; ts: string } {
    if (isDrivenPlacement(p)) return { q: p.uniformQ, ts: p.uniformTS };
    const inv = rigidInverse(p);
    return { q: formatVec4(inv.q), ts: formatVec4(inv.ts) };
}

/** The shape reference for a per-owner `uv_<id>` helper (SDF marcher path): the hoisted const
 *  for a named constant object, else the inline ctor (s-scaled under the driven tier — the
 *  same ctor sdf_<id> uses, so chart and distance field read one shape). */
function uvShapeRef(obj: PlannedSDFObject, ids: Map<number, string>, scaleExpr?: string): string {
    return hoistedShapeName(obj, ids) ?? emitCtor(primitive(obj.sdfType), obj.parameters, scaleExpr);
}

// ============================================================================
// Analytic backend dispatch (per-scene)
// ============================================================================
// Nearest-hit over the analytic objects, and a first-blocker any-hit. p and the shading frame
// come from ambient_geodesic/ambient_frame so they agree with the SDF path (cross-method match).

function generateAnalyticDispatch(objects: PlannedAnalyticObject[], anyQuery: boolean, ids: Map<number, string>, chartUv: boolean): string {
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
            // Placed arm — DRIVEN (§6.1) or a CONSTANT placement retained for a patterned
            // shape (fable-imagery P1b): conjugate into the RIGID frame once, so hit-finding
            // AND the uv chart both run in the shape's own frame. The struct's length-like
            // fields absorb s in-shader, so t is a WORLD value — comparable on hit.t unchanged,
            // and the primitives' internal EPSILON guards stay world-correct. The chart inherits
            // the placement's rotation for free (no rotation-dissolution — that only bites the
            // FOLDED constant arm below).
            const { q, ts } = placementRefs(obj.placement);
            lines.push(`    {`);
            lines.push(`        Ray lray = make_ray(placement_rigid(${q}, ${ts}, ray.origin), placement_dir(${q}, ray.direction));`);
            lines.push(`        float s = placement_scale(${ts});`);
            lines.push(`        ${sn} shape = ${emitCtor(d, obj.parameters, 's')};`);
            lines.push(`        if (${d.type}_intersect(lray, shape, t) && t < hit.t) {`);
            lines.push(`            hit.t = t; found = true;`);
            lines.push(`            hit.p = ambient_geodesic(ray.origin, ray.direction, t);`);
            lines.push(`            hit.frame = ambient_frame(hit.p, placement_normal(${q}, ${d.type}_normal(lray.origin + t * lray.direction, shape)));`);
            lines.push(`            hit.region_owner = ${obj.index};`);
            lines.push(`            hit.element = 0;`);
            lines.push(`            ${uvFill(d, 'lray.origin + t * lray.direction', 'shape', chartUv)}`);
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
        lines.push(`            hit.element = 0;`);
        lines.push(`            ${uvFill(d, 'hit.p', shapeRef, chartUv)}`);
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
                const { q, ts } = placementRefs(obj.placement);
                lines.push(`    {`);
                lines.push(`        Ray lray = make_ray(placement_rigid(${q}, ${ts}, ray.origin), placement_dir(${q}, ray.direction));`);
                lines.push(`        float s = placement_scale(${ts});`);
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

function generateMeshDispatch(meshes: PlannedMesh[], anyQuery: boolean, meshTraversal: string, ids: Map<number, string>, aggregateOver: PlannedMesh[]): string {
    const lines: string[] = [`// Generated mesh dispatch (ray-into-local; ${meshTraversal} engine)`];
    const engine = MESH_TRAVERSALS[meshTraversal];

    for (const m of meshes) {
        const pl = emitMeshPlacement(m.placement);
        // The traversal call comes from the registry occupant (bvh walks the node tree,
        // no triCount; brute scans the whole soup).
        const nearest = engine.nearestCall(m.slot, { smooth: m.smooth, triCount: m.triCount, ro: pl.ro, rd: pl.rd });
        lines.push(`bool mesh_${ids.get(m.index)!}(Ray ray, inout Hit hit) {`);
        lines.push(...pl.setup.map((s) => `    ${s}`));
        lines.push(`    vec3 nLocal; vec2 uv;`);
        lines.push(`    if (${nearest}) {`);
        // hit.t was shrunk to the local (== world) t inside the leaf; the world point is the
        // world ray at that t (ray-into-local preserves the parameter, impl-plan-meshes §6).
        lines.push(`        hit.p = ambient_geodesic(ray.origin, ray.direction, hit.t);`);
        lines.push(`        hit.frame = ambient_frame(hit.p, normalize(${pl.nWorld('nLocal')}));`);
        lines.push(`        hit.region_owner = ${m.index};`);
        lines.push(`        hit.element = 0;   // per-triangle refs are a future tenant`);
        lines.push(`        hit.uv = uv;`);
        lines.push(`        return true;`);
        lines.push(`    }`);
        lines.push(`    return false;`);
        lines.push(`}`);
        lines.push('');
    }

    // The aggregator spans only the RESIDUAL subset under table dispatch (tabled meshes
    // are reached through the scene-TLAS leaf switch instead); empty → no aggregator.
    if (aggregateOver.length > 0) {
        lines.push('bool mesh_intersect(Ray ray, inout Hit hit) {');
        lines.push('    bool found = false;');
        for (const m of aggregateOver) lines.push(`    if (mesh_${ids.get(m.index)!}(ray, hit)) found = true;`);   // bounded by hit.t
        lines.push('    return found;');
        lines.push('}');
    }

    if (anyQuery) {
        lines.push('');
        for (const m of meshes) {
            const pl = emitMeshPlacement(m.placement);
            // maxDist is a WORLD distance; local t == world t (rd unnormalized), so compare directly.
            const any = engine.anyCall(m.slot, { triCount: m.triCount, ro: pl.ro, rd: pl.rd });
            lines.push(`bool mesh_any_${ids.get(m.index)!}(Ray ray, float maxDist) {`);
            lines.push(...pl.setup.map((s) => `    ${s}`));
            lines.push(`    return ${any};`);
            lines.push(`}`);
        }
        if (aggregateOver.length > 0) {
            lines.push('bool mesh_intersect_any(Ray ray, float maxDist) {');
            for (const m of aggregateOver) lines.push(`    if (mesh_any_${ids.get(m.index)!}(ray, maxDist)) return true;`);
            lines.push('    return false;');
            lines.push('}');
        }
    }

    return lines.join('\n');
}

// ============================================================================
// Instance dispatch (per-scene) — impl-plan-instancing + impl-plan-tlas
// ============================================================================
// One prototype × N placements, accelerated by a per-batch TLAS (a BVH over the instance WORLD
// boxes). The walk descends the TLAS with the WORLD ray (pruned by hit.t); at a leaf it loops the
// leaf's placement range and, for each, reads the placement, conjugates the ray into that instance's
// local frame, and intersects the shared prototype (mesh BLAS / analytic closed form). The leaf-item
// body is the driven-mesh / driven-analytic arm. mesh uses ÷s conjugation (Möller–Trumbore is
// non-unit-safe) + unscaled BLAS; analytic uses rigid conjugation (unit rd) + s-scaled params.

/** Params-tier ctor from one record texel: schema rows in order, mapped onto the
 *  texel's components (the pack writes them in the same order — instanceAttributeRows'
 *  one-order-truth pattern applied to the placement record). Sphere: `Sphere(rec.xyz, rec.w)`. */
function paramsCtorFromTexel(d: ReturnType<typeof primitive>, recVar: string): string {
    const comps = 'xyzw';
    let off = 0;
    const args = d.params.map((p) => {
        const w = p.shape === 'vec3' ? 3 : 1;
        const swizzle = comps.slice(off, off + w);
        off += w;
        return `${recVar}.${swizzle}`;
    });
    return `${structName(d)}(${args.join(', ')})`;
}

/** The per-placement leaf body for placement index `i` (reads texture → conjugate → intersect →
 *  record into hit / return-true for the any variant). Lines are at RELATIVE indent (0 = leaf
 *  scope); the accel occupant's walk() pads them to its own nesting depth.
 *  Params-tier analytic batches (impl-plan-placement-fold stage 3) skip conjugation
 *  entirely: ONE texel = the folded world-space parameters, intersected with the WORLD
 *  ray — no placement fetch, no ray transform, no normal back-rotation. */
function instanceLeafItem(b: PlannedInstanceBatch, forAny: boolean, chartUv: boolean, pbOverride?: number): string[] {
    // pbOverride: the cwbvh occupant's records-TWIN base (its leaf order differs from
    // the binary TLAS's — fable-accel-cwbvh §6); default = the binary-order region.
    const pb = pbOverride ?? b.slot.placementsBase;
    if (b.prototype.backend === 'analytic' && b.prototype.record === 'params') {
        const d = primitive(b.prototype.shapeType);
        const read = [
            `vec4 rec = texelFetch(u_data_records, data_texel1d(uint(${pb} + i)), 0);`,
            `${structName(d)} shape = ${paramsCtorFromTexel(d, 'rec')};`,
            'float t;',
        ];
        if (forAny) return [...read,
            `if (${b.prototype.shapeType}_intersect(ray, shape, t) && t < maxDist) return true;`];
        return [...read,
            `if (${b.prototype.shapeType}_intersect(ray, shape, t) && t < hit.t) {`,
            '    hit.t = t; found = true;',
            '    hit.element = i;   // the leaf-order placement index (attribute rows read it)',
            '    hit.p = ambient_geodesic(ray.origin, ray.direction, t);',
            `    hit.frame = ambient_frame(hit.p, normalize(${b.prototype.shapeType}_normal(hit.p, shape)));`,
            `    hit.region_owner = ${b.index};`,
            `    ${uvFill(d, 'hit.p', 'shape', chartUv)}`,
            '}'];
    }
    const read = [
        `vec4 q  = texelFetch(u_data_records, data_texel1d(uint(${pb} + 2 * i)), 0);`,
        `vec4 ts = texelFetch(u_data_records, data_texel1d(uint(${pb} + 2 * i + 1)), 0);`,
        `float s = placement_scale(ts);`,
    ];
    if (b.prototype.backend === 'mesh') {
        const g = b.prototype.geometrySlot;
        const conj = [
            'vec3 ro = placement_rigid(q, ts, ray.origin) / s;',
            'vec3 rd = placement_dir(q, ray.direction) / s;',
        ];
        if (forAny) return [...read, ...conj,
            `if (mesh_any_bvh(u_data_vertices, u_data_indices, u_data_nodes, ${g.vbase}u, ${g.tbase}u, ${g.nbase}u, ro, rd, maxDist)) return true;`];
        return [...read, ...conj,
            'vec3 nLocal; vec2 uv;',
            `if (mesh_nearest_bvh(u_data_vertices, u_data_indices, u_data_normals, u_data_uvs, u_data_nodes, ${g.vbase}u, ${g.tbase}u, ${g.nbase}u, ${b.prototype.smooth}, ro, rd, hit.t, nLocal, uv)) {`,
            '    found = true;',
            '    hit.element = i;   // the leaf-order placement index (attribute rows read it)',
            '    hit.p = ambient_geodesic(ray.origin, ray.direction, hit.t);',
            '    hit.frame = ambient_frame(hit.p, normalize(placement_normal(q, nLocal)));',
            `    hit.region_owner = ${b.index};`,
            '    hit.uv = uv;',
            '}'];
    }
    const d = primitive(b.prototype.shapeType);
    const conj = [
        'vec3 ro = placement_rigid(q, ts, ray.origin);',
        'vec3 rd = placement_dir(q, ray.direction);   // unit — <type>_intersect assumes it',
        'Ray lray = make_ray(ro, rd);',
        `${structName(d)} shape = ${emitCtor(d, b.prototype.parameters, 's')};`,
        'float t;',
    ];
    if (forAny) return [...read, ...conj,
        `if (${b.prototype.shapeType}_intersect(lray, shape, t) && t < maxDist) return true;`];
    return [...read, ...conj,
        `if (${b.prototype.shapeType}_intersect(lray, shape, t) && t < hit.t) {`,
        '    hit.t = t; found = true;',
        '    hit.element = i;   // the leaf-order placement index (attribute rows read it)',
        '    hit.p = ambient_geodesic(ray.origin, ray.direction, t);',
        `    hit.frame = ambient_frame(hit.p, normalize(placement_normal(q, ${b.prototype.shapeType}_normal(lray.origin + t * lray.direction, shape))));`,
        `    hit.region_owner = ${b.index};`,
        `    ${uvFill(d, 'lray.origin + t * lray.direction', 'shape', chartUv)}`,
        '}'];
}

function generateInstanceDispatch(batches: PlannedInstanceBatch[], anyQuery: boolean, instanceAccel: string, ids: Map<number, string>, emitAggregator: boolean, chartUv: boolean): string {
    const lines: string[] = [`// Generated instance dispatch (${instanceAccel} — impl-plan-tlas)`];
    // The walk skeleton comes from the registry occupant (components/intersection
    // INSTANCE_ACCELS: tlas = stack-DFS over the batch's node texture, linear = the
    // baseline count-bounded scan); the per-placement leaf body is emitted here.
    const accel = INSTANCE_ACCELS[instanceAccel];

    const pbOf = (b: PlannedInstanceBatch): number | undefined =>
        instanceAccel === 'cwbvh' ? b.slot.cwbvhRecordsBase : undefined;
    for (const b of batches) {
        lines.push(`bool instance_${ids.get(b.index)!}(Ray ray, inout Hit hit) {`);
        lines.push('    bool found = false;');
        lines.push(...accel.walk(b.slot, b.instanceCount, 'hit.t', instanceLeafItem(b, false, chartUv, pbOf(b))));
        lines.push('    return found;');
        lines.push('}');
        lines.push('');
    }

    // Under table dispatch every batch is a scene-TLAS leaf — no linear aggregator.
    if (emitAggregator) {
        lines.push('bool instanced_intersect(Ray ray, inout Hit hit) {');
        lines.push('    bool found = false;');
        for (const b of batches) lines.push(`    if (instance_${ids.get(b.index)!}(ray, hit)) found = true;`);
        lines.push('    return found;');
        lines.push('}');
    }

    if (anyQuery) {
        lines.push('');
        for (const b of batches) {
            lines.push(`bool instance_any_${ids.get(b.index)!}(Ray ray, float maxDist) {`);
            lines.push(...accel.walk(b.slot, b.instanceCount, 'maxDist', instanceLeafItem(b, true, chartUv, pbOf(b))));
            lines.push('    return false;');
            lines.push('}');
        }
        if (emitAggregator) {
            lines.push('bool instanced_intersect_any(Ray ray, float maxDist) {');
            for (const b of batches) lines.push(`    if (instance_any_${ids.get(b.index)!}(ray, maxDist)) return true;`);
            lines.push('    return false;');
            lines.push('}');
        }
    }

    return lines.join('\n');
}

// ============================================================================
// Point classification — scene_region_at (§2.7 innermost-wins, §4.2)
// ============================================================================
// Among regions containing p (sdf < 0), the LEAST negative wins (innermost). The bug is one
// flipped inequality away: `d > best` among negatives — deepest-wins made a submerged sphere
// invisible (verification T2 / R-SUBMERGED). Spans both backends.

function generateSceneRegionAt(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], meshes: PlannedMesh[], ids: Map<number, string>, table?: PlannedSceneTable): string {
    const lines: string[] = ['// Generated point classification (§2.7 innermost-wins)'];
    lines.push('int scene_region_at(vec3 p) {');
    lines.push('    int region = -1;');
    lines.push('    float best = -1.0e20;   // best = least-negative inside distance so far');
    lines.push('    float d;');
    for (const obj of sdf) {
        if (table !== undefined && obj.tabled === true) continue;   // containment via the SDF record loop below
        lines.push(`    d = sdf_${ids.get(obj.index)!}(p);`);
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${obj.index}; }`);
    }
    for (const obj of analytic) {
        if (table !== undefined && obj.tabled === true) continue;   // containment via the record loop below
        if (obj.placement !== undefined && !primitive(obj.shapeType).thin) {
            // Placed (§6.1) — driven OR a patterned-shape's retained constant placement (P1b):
            // classify in the rigid frame with s-scaled params — d stays an exact WORLD signed
            // distance, so innermost-wins compares correctly across constant and placed objects.
            // (THIN primitives fall through: zero thickness never claims containment, placement
            // irrelevant.)
            const { q, ts } = placementRefs(obj.placement);
            lines.push(`    { vec3 lp = placement_rigid(${q}, ${ts}, p); float s = placement_scale(${ts});`);
            lines.push(`      d = ${emitSignedDistance(primitive(obj.shapeType), obj.parameters, { point: 'lp', scale: 's' })}; }`);
        } else {
            lines.push(`    d = ${analyticSignedDistance(obj, ids)};`);
        }
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${obj.index}; }`);
    }
    // Tabled SOLIDS (fable-object-tables §4 — ONE param truth): a generated loop over
    // the record range [0, solidCount), reading each solid's struct from its record and
    // ranking its signed distance in the SAME innermost-wins comparison. O(1) code size
    // regardless of object count; the region id rides the record header.
    if (table !== undefined && table.solidCount > 0) {
        const solidKinds = table.kinds.filter((k) => primitive(k.type).thin !== true);
        lines.push(`    for (uint ri = 0u; ri < ${table.solidCount}u; ri++) {`);
        lines.push(`        uint rbase = ${table.slot.analyticBase}u + ri * ${ANALYTIC_RECORD_TEXELS}u;`);
        lines.push('        vec4 hdr = texelFetch(u_data_records, data_texel1d(rbase), 0);');
        lines.push('        float ds = 1.0e20;');
        for (const k of solidKinds) {
            const d = primitive(k.type);
            lines.push(`        if (int(hdr.x) == ${k.code}) { ${structName(d)} shape = ${k.type}_from_record(u_data_records, rbase); ds = ${k.type}_sdf(p, shape); }`);
        }
        lines.push('        if (ds < 0.0 && ds > best) { best = ds; region = int(hdr.y); }');
        lines.push('    }');
    }
    // Tabled SDF SOLIDS (impl-plan-sdf-accel T4): the same record-loop shape over the
    // SDF block's solids-first range, through the per-type record field (conjugation
    // inside — d stays an exact WORLD signed distance; s = 1 on the rigid tail). No
    // point-in-box early-out: for PRIMITIVE fields the signed-distance eval costs
    // about a box test — the early-out becomes worthwhile only when expression fields
    // arrive (fable-sdf-accel §2.2's deferred half).
    if (table !== undefined && table.sdfRecords.some((s) => s.solid)) {
        const sdfSolidCount = table.sdfRecords.filter((s) => s.solid).length;
        const sdfSolidKinds = table.sdfKinds.filter((k) => primitive(k.type).thin !== true);
        lines.push(`    for (uint ri = ${table.analyticCount}u; ri < ${table.analyticCount + sdfSolidCount}u; ri++) {`);
        lines.push(`        uint rbase = ${table.slot.analyticBase}u + ri * ${ANALYTIC_RECORD_TEXELS}u;`);
        lines.push('        vec4 hdr = texelFetch(u_data_records, data_texel1d(rbase), 0);');
        lines.push('        float ds = 1.0e20;');
        for (const k of sdfSolidKinds) {
            lines.push(`        if (int(hdr.x) == ${k.code}) ds = sdf_leaf_field_${k.type}(p, rbase);`);
        }
        lines.push('        if (ds < 0.0 && ds > best) { best = ds; region = int(hdr.y); }');
        lines.push('    }');
    }
    // CLOSED meshes (fable-mesh-containment §1, amended): the lazy three-tier query —
    // (1) outside the baked local box → outside, free; (2) first-hit-facing nearest walk
    // (Validator-proven winding makes the cheap query sufficient); (3) only when INSIDE,
    // the closest-triangle distance supplies the |d| innermost-wins ranks by (× s → the
    // world-exact value the §5.2 discipline requires).
    for (const m of meshes) {
        if (!m.closed) continue;
        const box = m.localBox!;
        const sl = m.slot;
        const bases = `${sl.vbase}u, ${sl.tbase}u, ${sl.nbase}u`;
        lines.push(`    { // closed mesh ${ids.get(m.index) ?? m.index}`);
        lines.push('      vec3 lp = p; float ms = 1.0;');
        lines.push(...emitMeshPointQuery(m.placement).map((l) => `      ${l}`));
        lines.push('      d = 1.0e20;');
        lines.push(`      if (all(greaterThanEqual(lp, ${formatVec3(box.min)})) && all(lessThanEqual(lp, ${formatVec3(box.max)}))`);
        lines.push(`          && mesh_inside_bvh(u_data_vertices, u_data_indices, u_data_nodes, ${bases}, lp)) {`);
        lines.push(`          d = -ms * mesh_closest_bvh(u_data_vertices, u_data_indices, u_data_nodes, ${bases}, lp);`);
        lines.push('      } }');
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${m.index}; }`);
    }
    lines.push('    return region;');
    lines.push('}');
    return lines.join('\n');
}

/** World→LOCAL point conjugation lines for a mesh containment query: transform `lp` in
 *  place and set `ms` (the uniform scale — the s·d world-distance correction, §5.2).
 *  Constant tiers mirror emitPlacementQuery; driven reuses the §6.1 placement helpers.
 *  Unlike the SDF wrapper (rigid frame + s-scaled params), the mesh's vertex data is in
 *  the UNSCALED local frame, so the point divides by s and the distance multiplies back. */
function emitMeshPointQuery(pl: PlannedPlacement): string[] {
    if (isDrivenPlacement(pl)) {
        return [
            `lp = placement_rigid(${pl.uniformQ}, ${pl.uniformTS}, lp);`,
            `ms = placement_scale(${pl.uniformTS});`,
            'lp /= ms;',
        ];
    }
    const g = pl as Similarity;
    const kind = classifySimilarity(g);
    if (kind === 'identity') return [];
    const t = g.translation;
    const centered = isIdentityTranslation(t) ? 'lp' : `(lp - ${formatVec3(t)})`;
    if (kind === 'translation') return [`lp = lp - ${formatVec3(t)};`];
    if (kind === 'rigid') return [`lp = ${formatMat3(quatToMat3(quatConjugate(g.rotation)))} * ${centered};`];
    // similarity: fold 1/s into the matrix (or a plain division when rotation is trivial);
    // ms carries s for the world-distance correction.
    if (isIdentityRotation(g.rotation)) {
        return [`lp = ${centered} / ${formatFloat(g.scale)};`, `ms = ${formatFloat(g.scale)};`];
    }
    const M = quatToMat3(quatConjugate(g.rotation)).map((v) => v / g.scale);
    return [`lp = ${formatMat3(M)} * ${centered};`, `ms = ${formatFloat(g.scale)};`];
}

// ============================================================================
// The scene table (fable-object-tables): record readers + leaf dispatch + the TLAS walk
// ============================================================================
// One tree over every tabled placed thing. Leaf-list texel: (leafKind, ref, 0, 0) —
// analytic ref = record slot (header carries primKind + regionId), mesh/batch ref =
// ordinal, dispatched into the SAME generated wrappers the unrolled arms use. The
// analytic leaf reads its struct from the record and runs the SAME <type>_intersect
// the unrolled arm calls — one math, two addressings.

function generateSceneTable(table: PlannedSceneTable, plan: RenderPlan, ids: Map<number, string>, anyQuery: boolean): string {
    const lines: string[] = ['// Generated scene table (fable-object-tables)'];
    const S = table.slot;
    const STRIDE = ANALYTIC_RECORD_TEXELS;
    const chartUv = plan.program.materials.materialsReadUv;

    // Record readers for the present tabled kinds — generated from the SAME rows as the
    // structs/ctors (records.ts), so pack and read cannot drift. ONE reader per TYPE
    // across both arms (a box may be an analytic AND an SDF record — same param layout).
    const readerTypes = [...new Set([...table.kinds.map((k) => k.type), ...table.sdfKinds.map((k) => k.type)])];
    for (const t of readerTypes) {
        lines.push(generateRecordReader(primitive(t)));
    }
    lines.push('');

    // ── Boxed-SDF leaf machinery (impl-plan-sdf-accel T3), per PRESENT SDF-arm type:
    // the record-driven signed field (the region-keyed queries' target — prototyped in
    // the SDF dispatch), its uv sibling, and the INTERVAL leaf marchers. The rigid tail
    // (q_inv texel, (t_rigid, s) texel) sits texel-aligned after the params (records.ts
    // sdfTailTexel — the ONE layout truth); conjugation is once per call/visit.
    for (const k of table.sdfKinds) {
        const d = primitive(k.type);
        const sn = structName(d);
        const tail = sdfTailTexel(d);
        lines.push(`float sdf_leaf_field_${k.type}(vec3 p, uint rbase) {`);
        lines.push(`    ${sn} shape = ${k.type}_from_record(u_data_records, rbase);`);
        lines.push(`    vec4 rq = texelFetch(u_data_records, data_texel1d(rbase + ${tail}u), 0);`);
        lines.push(`    vec4 rts = texelFetch(u_data_records, data_texel1d(rbase + ${tail + 1}u), 0);`);
        lines.push(`    return ${k.type}_sdf(placement_rigid(rq, rts, p), shape);`);
        lines.push('}');
        if (chartUv && d.uvChart) {
            lines.push(`vec2 uv_leaf_${k.type}(vec3 p, uint rbase) {`);
            lines.push(`    ${sn} shape = ${k.type}_from_record(u_data_records, rbase);`);
            lines.push(`    vec4 rq = texelFetch(u_data_records, data_texel1d(rbase + ${tail}u), 0);`);
            lines.push(`    vec4 rts = texelFetch(u_data_records, data_texel1d(rbase + ${tail + 1}u), 0);`);
            lines.push(`    return ${k.type}_uv(placement_rigid(rq, rts, p), shape);`);
            lines.push('}');
        }
        // The per-type SELF-CONTAINED commit (the ONE-SHOT FIX, Aug 10 2026): the
        // first build committed through raymarch_commit → scene_normal →
        // scene_object_sdf — an O(N)-ARM dispatch inlined at every commit site inside
        // every marcher: ~6·N·2·3 inlined ops that stalled shader compilers past
        // ~50 objects (the sdf-field failure; SwiftShader AND Metal — backend-
        // agnostic). The leaf KNOWS its type and record: the normal is six taps of
        // ITS OWN field (O(1)), rotated to world ONCE by the record's quat; uv from
        // its own chart. One helper, called at both acceptance sites, so the two
        // paths cannot drift (the raymarch_commit lesson, kept — locally).
        lines.push(`void march_commit_${k.type}(Ray ray, float t, ${sn} shape, vec3 lp, vec4 rq, int region, inout Hit hit) {`);
        lines.push('    hit.t = t;');
        lines.push('    hit.p = ambient_geodesic(ray.origin, ray.direction, t);');
        lines.push('    vec2 e = vec2(NORMAL_EPSILON, 0.0);');
        lines.push('    vec3 nl = normalize(vec3(');
        lines.push(`        ${k.type}_sdf(lp + e.xyy, shape) - ${k.type}_sdf(lp - e.xyy, shape),`);
        lines.push(`        ${k.type}_sdf(lp + e.yxy, shape) - ${k.type}_sdf(lp - e.yxy, shape),`);
        lines.push(`        ${k.type}_sdf(lp + e.yyx, shape) - ${k.type}_sdf(lp - e.yyx, shape)));`);
        lines.push('    hit.frame = ambient_frame(hit.p, placement_normal(rq, nl));');
        lines.push('    hit.region_owner = region;');
        lines.push('    hit.element = 0;   // SDF objects have no sub-elements (Hit.element contract)');
        if (chartUv && d.uvChart) {
            lines.push(`    hit.uv = ${k.type}_uv(lp, shape);   // the type's own LOCAL chart`);
        } else {
            lines.push('    hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);   // planar placeholder (world — matches the unrolled arm)');
        }
        lines.push('}');
        // The interval leaf march (fable-sdf-accel §3): conjugate ONCE, march |sdf|
        // within [lt0, lt1] dilated by march_epsilon(lt1) (surfaces may sit ON the
        // conservative box wall); per-leaf exhaustion inside the interval = the
        // grazing stall-commit, outside = miss-and-resume.
        lines.push(`bool march_leaf_${k.type}(Ray ray, float lt0, float lt1, uint rbase, int region, inout Hit hit) {`);
        lines.push(`    ${sn} shape = ${k.type}_from_record(u_data_records, rbase);`);
        lines.push(`    vec4 rq = texelFetch(u_data_records, data_texel1d(rbase + ${tail}u), 0);`);
        lines.push(`    vec4 rts = texelFetch(u_data_records, data_texel1d(rbase + ${tail + 1}u), 0);`);
        lines.push('    vec3 ro = placement_rigid(rq, rts, ray.origin);');
        lines.push('    vec3 rd = placement_dir(rq, ray.direction);');
        lines.push('    float t = max(lt0, EPSILON);');
        lines.push('    float t_stop = min(lt1 + march_epsilon(lt1), hit.t);');
        lines.push('    float bound = 1e20;');
        lines.push('    for (int i = 0; i < MAX_MARCH_STEPS; i++) {');
        lines.push('        if (t > t_stop) return false;   // left the (dilated) interval or past the running nearest');
        lines.push(`        bound = abs(${k.type}_sdf(ro + t * rd, shape));`);
        lines.push('        if (bound < march_epsilon(t)) {');
        lines.push(`            march_commit_${k.type}(ray, t, shape, ro + t * rd, rq, region, hit);`);
        lines.push('            return true;');
        lines.push('        }');
        lines.push('        t += bound;');
        lines.push('    }');
        lines.push('    // Exhaustion still inside the interval: pinned at grazing — the stall-commit');
        lines.push('    // (never fires merely at the box wall: it requires bound < 16ε of REAL surface).');
        lines.push('    if (bound < 16.0 * march_epsilon(t) && t <= t_stop) {');
        lines.push(`        march_commit_${k.type}(ray, t, shape, ro + t * rd, rq, region, hit);`);
        lines.push('        return true;');
        lines.push('    }');
        lines.push('    return false;');
        lines.push('}');
        if (anyQuery) {
            lines.push(`bool march_leaf_any_${k.type}(Ray ray, float lt0, float lt1, uint rbase, float maxDist) {`);
            lines.push(`    ${sn} shape = ${k.type}_from_record(u_data_records, rbase);`);
            lines.push(`    vec4 rq = texelFetch(u_data_records, data_texel1d(rbase + ${tail}u), 0);`);
            lines.push(`    vec4 rts = texelFetch(u_data_records, data_texel1d(rbase + ${tail + 1}u), 0);`);
            lines.push('    vec3 ro = placement_rigid(rq, rts, ray.origin);');
            lines.push('    vec3 rd = placement_dir(rq, ray.direction);');
            lines.push('    float t = max(lt0, EPSILON);');
            lines.push('    float t_stop = min(lt1 + march_epsilon(lt1), maxDist);');
            lines.push('    for (int i = 0; i < MAX_MARCH_STEPS; i++) {');
            lines.push('        if (t > t_stop) return false;   // cleared the interval/light: unoccluded here');
            lines.push(`        float bound = abs(${k.type}_sdf(ro + t * rd, shape));`);
            lines.push('        if (bound < march_epsilon(t)) return true;');
            lines.push('        t += bound;');
            lines.push('    }');
            lines.push('    return true;   // exhausted inside the interval: grazing — conservatively occluded');
            lines.push('}');
        }
    }
    if (table.sdfKinds.length > 0) lines.push('');


    const tabledMeshes = plan.meshes.filter((m) => table.tabledMeshOrdinals.includes(m.ordinal));

    // Nearest-hit leaf: kind switch → analytic record / mesh wrapper / batch walk /
    // SDF interval march (lt0/lt1 = the node-box ray interval — leaf-size-1 TLAS, so
    // the node box IS the object box; the non-SDF arms ignore it).
    lines.push('bool scene_table_leaf(uint li, Ray ray, float lt0, float lt1, inout Hit hit) {');
    lines.push(`    vec4 L = texelFetch(u_data_records, data_texel1d(${S.leafListBase}u + li), 0);`);
    lines.push('    int lk = int(L.x); int ref = int(L.y);');
    lines.push('    bool found = false;');
    lines.push(`    if (lk == ${LEAF_ANALYTIC}) {`);
    lines.push(`        uint rbase = ${S.analyticBase}u + uint(ref) * ${STRIDE}u;`);
    lines.push('        vec4 hdr = texelFetch(u_data_records, data_texel1d(rbase), 0);');
    lines.push('        float t;');
    for (const k of table.kinds) {
        const d = primitive(k.type);
        lines.push(`        if (int(hdr.x) == ${k.code}) {`);
        lines.push(`            ${structName(d)} shape = ${k.type}_from_record(u_data_records, rbase);`);
        lines.push(`            if (${k.type}_intersect(ray, shape, t) && t < hit.t) {`);
        lines.push('                hit.t = t; found = true;');
        lines.push('                hit.p = ambient_geodesic(ray.origin, ray.direction, t);');
        lines.push(`                hit.frame = ambient_frame(hit.p, ${k.type}_normal(hit.p, shape));`);
        lines.push('                hit.region_owner = int(hdr.y);');
        lines.push('                hit.element = 0;');
        lines.push(`                ${uvFill(d, 'hit.p', 'shape', plan.program.materials.materialsReadUv)}`);
        lines.push('            }');
        lines.push('        }');
    }
    lines.push(`    } else if (lk == ${LEAF_MESH}) {`);
    for (const m of tabledMeshes) {
        lines.push(`        if (ref == ${m.ordinal}) { if (mesh_${ids.get(m.index)!}(ray, hit)) found = true; }`);
    }
    if (table.sdfKinds.length > 0) {
        lines.push(`    } else if (lk == ${LEAF_SDF}) {`);
        lines.push(`        uint rbase = ${S.analyticBase}u + (${table.analyticCount}u + uint(ref)) * ${STRIDE}u;`);
        lines.push('        vec4 hdr = texelFetch(u_data_records, data_texel1d(rbase), 0);');
        for (const k of table.sdfKinds) {
            lines.push(`        if (int(hdr.x) == ${k.code}) { if (march_leaf_${k.type}(ray, lt0, lt1, rbase, int(hdr.y), hit)) found = true; }`);
        }
    }
    lines.push('    } else {');
    for (const b of plan.instanceBatches) {
        lines.push(`        if (ref == ${b.ordinal}) { if (instance_${ids.get(b.index)!}(ray, hit)) found = true; }`);
    }
    lines.push('    }');
    lines.push('    return found;');
    lines.push('}');
    lines.push('');

    // The walk: standard stack DFS over the scene TLAS, pruned by the running nearest —
    // the shared skeleton (accel/bvh bvhWalkLines, same emitter as the instance TLAS walk).
    lines.push('bool scene_table_intersect(Ray ray, inout Hit hit) {');
    lines.push('    bool found = false;');
    lines.push(...bvhWalkLines(S.tlasBase, 'hit.t', [
        'for (int j = 0; j < cnt; j++) { if (scene_table_leaf(uint(off + j), ray, lt0, lt1, hit)) found = true; }',
    ], /*range*/ true));
    lines.push('    return found;');
    lines.push('}');

    if (anyQuery) {
        lines.push('');
        lines.push('bool scene_table_leaf_any(uint li, Ray ray, float lt0, float lt1, float maxDist) {');
        lines.push(`    vec4 L = texelFetch(u_data_records, data_texel1d(${S.leafListBase}u + li), 0);`);
        lines.push('    int lk = int(L.x); int ref = int(L.y);');
        lines.push(`    if (lk == ${LEAF_ANALYTIC}) {`);
        lines.push(`        uint rbase = ${S.analyticBase}u + uint(ref) * ${STRIDE}u;`);
        lines.push('        vec4 hdr = texelFetch(u_data_records, data_texel1d(rbase), 0);');
        lines.push('        float t;');
        for (const k of table.kinds) {
            const d = primitive(k.type);
            lines.push(`        if (int(hdr.x) == ${k.code}) { ${structName(d)} shape = ${k.type}_from_record(u_data_records, rbase); if (${k.type}_intersect(ray, shape, t) && t < maxDist) return true; }`);
        }
        lines.push(`    } else if (lk == ${LEAF_MESH}) {`);
        for (const m of tabledMeshes) {
            lines.push(`        if (ref == ${m.ordinal}) { if (mesh_any_${ids.get(m.index)!}(ray, maxDist)) return true; }`);
        }
        if (table.sdfKinds.length > 0) {
            lines.push(`    } else if (lk == ${LEAF_SDF}) {`);
            lines.push(`        uint rbase = ${S.analyticBase}u + (${table.analyticCount}u + uint(ref)) * ${STRIDE}u;`);
            lines.push('        vec4 hdr = texelFetch(u_data_records, data_texel1d(rbase), 0);');
            for (const k of table.sdfKinds) {
                lines.push(`        if (int(hdr.x) == ${k.code}) { if (march_leaf_any_${k.type}(ray, lt0, lt1, rbase, maxDist)) return true; }`);
            }
        }
        lines.push('    } else {');
        for (const b of plan.instanceBatches) {
            lines.push(`        if (ref == ${b.ordinal}) { if (instance_any_${ids.get(b.index)!}(ray, maxDist)) return true; }`);
        }
        lines.push('    }');
        lines.push('    return false;');
        lines.push('}');
        lines.push('');
        lines.push('bool scene_table_intersect_any(Ray ray, float maxDist) {');
        lines.push(...bvhWalkLines(S.tlasBase, 'maxDist', [
            'for (int j = 0; j < cnt; j++) { if (scene_table_leaf_any(uint(off + j), ray, lt0, lt1, maxDist)) return true; }',
        ], /*range*/ true));
        lines.push('    return false;');
        lines.push('}');
    }

    return lines.join('\n');
}

// ============================================================================
// region → material table (both backends)
// ============================================================================

function generateMaterialOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], meshes: PlannedMesh[], instances: PlannedInstanceBatch[], ambientMedium: number): string {
    const lines: string[] = ['// Generated region -> material table (§2.3), across both backends'];
    lines.push('int material_of(int region) {');
    const all: Array<{ index: number; materialId: number }> = [...sdf, ...analytic, ...meshes, ...instances];
    for (const obj of all.sort((a, b) => a.index - b.index)) {
        lines.push(`    if (region == ${obj.index}) return ${obj.materialId};`);
    }
    // Default arm covers region -1: the ambientMedium's material id, or -1 = vacuum (§2.4).
    lines.push(`    return ${ambientMedium};`);
    lines.push('}');
    return lines.join('\n');
}

// region → IOR of the region's interior at a point (reference-implementations §2: dielectrics
// read the far side's IOR without a full material-properties fetch). The point argument is the
// GRIN-interface unification (impl-plan-grin-interface): a region whose material carries a
// deflecting medium answers with the medium's n(x) FORMULA evaluated at p — Snell/Fresnel at a
// curved-index wall is ordinary Snell with the LOCAL n on each side — while constant rows ignore
// p (fold away). Non-dielectric materials are 1.0 (vacuum-like — pinned in the Planner),
// ior_of(-1, p) = 1.0 (ambient; ambientMedium is a media-era concern, §2.4). Value<T>-driven ior
// reads its uniform (declared via the materials {param} scan — same for formula params).
function generateIorOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], meshes: PlannedMesh[], materials: PlannedMaterial[]): string {
    const byId = new Map(materials.map((m) => [m.id, m]));
    const lines: string[] = ['// Generated region -> IOR table (§2.3 family; p = the GRIN-interface point argument)'];
    lines.push('float ior_of(int region, vec3 p) {');
    // CLOSED meshes have a real interior (fable-mesh-containment) and earn rows like any
    // solid; open meshes stay off the table (thin — the Validator's warning covers them).
    for (const obj of [...sdf, ...analytic, ...meshes.filter((m) => m.closed)].sort((a, b) => a.index - b.index)) {
        const mat = byId.get(obj.materialId);
        if (!mat) continue;
        // ONE ior truth (impl-plan-grin-interface): a deflecting medium's formula IS the
        // region's index — the surface row is superseded (the Validator rejects authoring
        // both). Emitted for ANY wall model ('none' too: correct for the deferred nested
        // case, ≈ 1.0 under the v1 continuous-wall contract, and exact linkage keeps ior_of
        // out of programs with no transmission).
        if (mat.medium?.ior !== undefined) {
            lines.push(`    if (region == ${obj.index}) return ${emitValue(mat.medium.ior as ParamValue, formatFloat)};   // '${mat.name}' — deflecting: the medium's n(p)`);
            continue;
        }
        // Non-transmissive materials are PINNED to 1.0 (fall through to the default), even if the
        // author set an ior on them — an authored lambert ior leaking into the table silently
        // yields η = 1 at adjacent dielectric boundaries (review finding). The Validator warns.
        if (!modelTransmission(mat.model)) continue;
        // No property name here (materials-§7): the transmission capability implies a
        // region-table row on the declaring model's schema — found structurally.
        const row = MATERIAL_MODELS[mat.model]?.properties.find((p) => p.storage === 'region-table');
        const ior = row !== undefined ? mat.values[row.source] : undefined;
        if (ior === undefined) continue;   // registry-test-enforced; unreachable backstop
        // The constant/driven split is emitValue's — ior_of is a region-indexed SCENE_VALUE
        // (no shading point, so it can't ride scene_material_properties, but the read obeys the
        // same one split point). An expression is rejected (the Validator already diagnosed it).
        const expr = emitValue(ior as ParamValue, formatFloat as (x: never) => string, () => {
            throw new Error(`intersection: material '${mat.name}': the surface ior row cannot be a GLSL expression — a spatial index is a medium: author it as medium: { ior: <formula> } (fable-variable-ior)`);
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

function generateSceneIntersect(arms: { analytic: boolean; sdf: boolean; mesh: boolean; instanced: boolean; table: boolean }, thinRegions: number[], anyQuery: boolean): string {
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
    if (arms.analytic) lines.push('    if (analytic_intersect(ray, hit)) found = true;');
    if (arms.sdf) lines.push('    if (sdf_intersect(ray, hit)) found = true;');   // bounded by hit.t → only closer
    if (arms.mesh) lines.push('    if (mesh_intersect(ray, hit)) found = true;');   // bounded by hit.t → only closer
    if (arms.instanced) lines.push('    if (instanced_intersect(ray, hit)) found = true;');
    if (arms.table) lines.push('    if (scene_table_intersect(ray, hit)) found = true;');   // the scene TLAS (fable-object-tables)
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
        if (arms.analytic) lines.push('    if (analytic_intersect_any(ray, maxDist)) return true;');
        if (arms.sdf) lines.push('    if (sdf_intersect_any(ray, maxDist)) return true;');
        if (arms.mesh) lines.push('    if (mesh_intersect_any(ray, maxDist)) return true;');
        if (arms.instanced) lines.push('    if (instanced_intersect_any(ray, maxDist)) return true;');
        if (arms.table) lines.push('    if (scene_table_intersect_any(ray, maxDist)) return true;');
        lines.push('    return false;');
        lines.push('}');
    }

    return lines.join('\n');
}
