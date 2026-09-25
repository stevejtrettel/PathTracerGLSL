// compiler/plan/Planner.ts

import type { SceneDescription, RenderStrategy, MaterialModel, MediumDescription, Vec3, MaterialProperty, GlslExpression, ValueParam, Transform, ParameterMetadata, SpectrumValue, DataReads } from '../types.js';
import { isGlslExpression, isValueParam, isBlackbody, mediumRoutesToTracking, mediumWeightsAbsorption, mediumMayScatter, isMeshObject, isInstancedObject } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';
import { MATERIAL_MODELS, modelTwoSidedShading } from '../../components/materials/index.js';
import { LIGHT_KINDS, applyAuthoredDefaults, DEFAULT_LIGHT_SELECTION } from '../../components/lights/index.js';
import { lightTableLayout } from '../../components/lights/table.js';
import { tonemapModel } from '../../components/tonemap/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../components/volume_scattering/index.js';
import { PRIMITIVES, primitive, primitiveBounds, canonicalizePrimitiveParameters, classifyPlacement, resolveBackend } from '../../components/geometry/index.js';
import {
    IDENTITY_QUAT,
    isDrivenTransform,
    isIdentityRotation,
    quatFromAxisAngle,
    quatNormalize,
    rigidInverse,
    similarityCompose,
    similarityFromTransform,
    type Quat,
    type Similarity,
    type Vec3Tuple,
} from '../../components/geometry/similarity.js';
import { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import type { RenderPlan, PlannedPrimitiveObject, PlannedMesh, PlannedInstanceBatch, PlannedMaterial, PlannedMedium, PlannedLight, PlannedSceneTable, ProgramDescription, PlannedPipeline, DrivenPlacement, PlannedPlacement, ResolvedProperty, ResolvedEnvironment } from './types.js';
import { foldBlackbody } from '../../components/lights/blackbody.js';
import { isDrivenPlacement } from './types.js';
import { sceneMeshes } from '../../components/intersection/mesh/mesh.js';
import { meshLocalBox } from '../../components/intersection/mesh/topology.js';
import { dataTenantsOf, keepsLocalFrame, materialReadsUv, lightRosterOf, authoredLightEmission, batchNeedsInterior, dataReadsOf, READS_EVERYTHING } from './dataTenants.js';
import { planDataLayout } from '../../components/data/ledger.js';
import { resolveMeasurement } from './measurement.js';
import { sceneInstanceBatches, instanceAttributeRows, placementCount } from '../../components/intersection/instancing/instancing.js';
import { DEFAULT_MESH_TRAVERSAL, DEFAULT_INSTANCE_ACCEL, DEFAULT_OBJECT_DISPATCH, MARCHED_TABLE_THRESHOLD } from '../../components/intersection/index.js';
import type { BlackbodyValue } from '../types.js';

/** Registered primitive types — unknowns must diagnose here, not throw downstream
 *  (impl-plan-geometry-descriptors: the capability IS the descriptor fact). */
const implementedTypes = () => Object.keys(PRIMITIVES);

/** C2: the ONE place env defaults resolve — the plan record is closed (no optionals),
 *  so Generate reads values, never re-derives defaults. */
function resolveEnvironment(env: SceneDescription['environment']): ResolvedEnvironment {
    if (env === undefined || env.type === 'none') return { type: 'none' };
    if (env.type === 'constant') {
        // The color goes through the SAME spectrum normalization as material spectra: a
        // scalar broadcasts to a vec3, a constant blackbody folds, a scalar {param} default
        // broadcasts. (Passed through raw, a scalar color crashed the GLSL formatter.)
        // (The cast drops GlslExpression from the return type: an env color cannot be one.)
        const color = resolveColorProperty(env.color, [0, 0, 0]) as SpectrumValue;
        return { type: 'constant', color, intensity: env.intensity ?? 1.0 };
    }
    if (env.type === 'image') return { type: 'image', url: env.url, intensity: env.intensity ?? 1.0, rotation: env.rotation ?? 0.0 };
    return { type: 'procedural', glsl: env.glsl, intensity: env.intensity ?? 1.0, rotation: env.rotation ?? 0.0 };
}

/**
 * Plan one strategy. `reads` is the set of optional data structures the scene's data layout
 * provides — the union over ALL of the scene's renderers (Compiler.compileScene). Omitted, the
 * layout holds exactly what this strategy itself reads.
 */
export function plan(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, bag: DiagnosticBag, reads?: DataReads): RenderPlan {
    return planWithLayout(features, scene, strategy, bag, reads ?? dataReadsOf(programDecisions(features, scene, strategy)));
}

/**
 * A strategy's decisions — its ProgramDescription, from which dataReadsOf reads the data it
 * needs. Decisions never depend on the data layout (they read counts and kinds, not offsets),
 * so planning against a layout with every optional structure present decides exactly what the
 * final plan will; tests/compiler/dataReads.test.ts checks this for every suite scene.
 */
export function programDecisions(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy): ProgramDescription {
    return planWithLayout(features, scene, strategy, new DiagnosticBag('decisions'), READS_EVERYTHING).program;
}

function planWithLayout(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, bag: DiagnosticBag, reads: DataReads): RenderPlan {
    // --- Assign material IDs in AUTHORED (insertion) order — naming batch N1 (audit P1).
    // Identity is STRUCTURAL, symmetric with objects/regions: renaming a material no
    // longer renumbers ids or churns artifacts; names are provenance. JS insertion order
    // is deterministic and JSON-round-trip-stable; the one trap — integer-like keys
    // iterate first — is Validator-rejected.
    // Property resolution is SCHEMA-DRIVEN (materials-§7): exactly the model's declared
    // rows resolve, each `authored ?? row.default` shaped by glslType. The old per-field
    // hand-resolution (and its model-conditional ior default) dissolved into the rows —
    // a non-dielectric simply has no ior value; ior_of pins it structurally.
    const materials: PlannedMaterial[] = [];
    let materialIndex = 0;
    for (const [name, mat] of Object.entries(scene.materials)) {
        materials.push({
            id: materialIndex++,
            name,
            model: mat.model,
            values: resolveMaterialValues(mat.model, mat as unknown as Record<string, MaterialProperty | undefined>),
            medium: mat.medium === undefined ? null : resolveMedium(mat.medium),
        });
    }

    // Build name→id lookup for objects
    const materialIdMap = new Map<string, number>();
    for (const m of materials) {
        materialIdMap.set(m.name, m.id);
    }

    // --- Assign objects; RESOLVE the backend (B1 — shape, not backend) ---
    // Auto = analytic if the primitive provides it, else sdf; a per-object `backend`
    // pin overrides (research/coverage — Validator-checked against provides).
    // `index` is assigned in scene order across BOTH backends: it is the globally-unique
    // region id (§2.3), so material_of() spans both lists and regions never collide.
    // ONE list, both intersection methods (impl-plan-sdf-as-shape T5) — scene order,
    // region ids assigned as we go.
    const objects: PlannedPrimitiveObject[] = [];
    const meshes: PlannedMesh[] = [];
    const instanceBatches: PlannedInstanceBatch[] = [];
    // THE ordinal truth (audit A5): Planner (extern declaration) and App (upload) both
    // derive mesh/batch ordinals from the SAME shared enumerators — the assignment can
    // never diverge, including for Validator-rejected batches (which still hold their
    // ordinal on both sides; they just never plan).
    const meshOrdinals = new Map(sceneMeshes(scene.objects).map((m, i) => [m, i] as const));
    const batchOrdinals = new Map(sceneInstanceBatches(scene.objects).map((b, i) => [b, i] as const));
    // The data layout: the same adapter + ledger call, with the same `reads`, that the App
    // makes to pack the bytes — so the offsets baked here are where the bytes land.
    const dataTenantsResult = dataTenantsOf(scene, reads);
    const { tenants: dataTenants, batchGeometrySlot, batchPlacementRecord, table: sceneTableTruth, lightBatches: sceneLightBatches } = dataTenantsResult;
    const dataLayout = planDataLayout(dataTenants);
    let objectIndex = 0;
    for (const obj of scene.objects) {
        if (isMeshObject(obj)) {
            // Mesh (impl-plan-meshes): a region in the shared id space; placement is
            // ray-into-local for BOTH constant and driven (vertices stay object-LOCAL —
            // never folded, so a slider moves the mesh with no re-upload). Data (vertices/
            // triangles) becomes extern textures the app uploads; only counts/flags plan here.
            const matId = materialIdMap.get(obj.material)!;   // validated by the Validator
            meshes.push({
                ordinal: meshOrdinals.get(obj)!,
                index: objectIndex++,
                materialId: matId,
                name: obj.name,
                triCount: obj.indices.length / 3,
                smooth: obj.normals !== undefined,
                // Solid (fable-mesh-containment) — Validator-proven; the local box is the
                // containment query's baked root-box early-out.
                closed: obj.closed === true,
                ...(obj.closed === true ? { localBox: meshLocalBox(obj.positions) } : {}),
                slot: dataLayout.meshes[meshOrdinals.get(obj)!],
                placement: isDrivenTransform(obj.transform)
                    ? buildDrivenPlacement(obj.transform!, objectIndex - 1)
                    : placementOf(obj.transform),
            });
            continue;
        }
        if (isInstancedObject(obj)) {
            // Instanced batch (impl-plan-instancing): one prototype, N placements, ONE region +
            // material (the prototype's). The prototype's backend picks the loop's local-intersect;
            // its transform is ignored (placements carry all world placement). Placement values +
            // prototype geometry are computed from the scene and uploaded by the app (like meshes).
            const proto = obj.prototype;
            const matId = materialIdMap.get(proto.material)!;   // validated by the Validator
            const region = objectIndex++;
            const ordinal = batchOrdinals.get(obj)!;
            // Per-instance ATTRIBUTES (fable-instance-attributes): slot order from the ONE
            // shared helper (the app's packer calls the same one — the layout cannot drift);
            // the batch material's rows are patched to AttributeValue refs, so the generated
            // fill fetches instance_k_attrs by Hit.element. The Validator guaranteed the
            // material is exclusive to this batch, so the patch cannot affect anyone else.
            const attrRows = instanceAttributeRows(scene.materials[proto.material]?.model ?? '', obj.attributes ?? {});
            const attributeRows = attrRows.length > 0 ? attrRows : undefined;
            if (attributeRows !== undefined) {
                const mat = materials.find((m) => m.id === matId)!;
                attributeRows.forEach((r, slot) => {
                    mat.values[r.source] = { attribute: { batch: ordinal, base: dataLayout.batches[ordinal].attrsBase, slot, count: attributeRows.length, shape: r.shape } };
                });
            }
            if (isMeshObject(proto)) {
                instanceBatches.push({
                    ordinal, index: region, materialId: matId, name: obj.name,
                    instanceCount: placementCount(obj.placements),
                    ...(attributeRows !== undefined ? { attributeRows } : {}),
                    slot: dataLayout.batches[ordinal],
                    ...(batchNeedsInterior(obj, scene) ? { hasInterior: true } : {}),
                    prototype: { backend: 'mesh', triCount: proto.indices.length / 3, smooth: proto.normals !== undefined, geometrySlot: dataLayout.meshes[batchGeometrySlot[ordinal]!] },
                });
            } else {
                const backend = resolveBackend(proto.type, proto.backend);
                if (backend === undefined) {
                    // Unregistered type / unhonorable pin — the Validator diagnoses; keep
                    // region ids stable and skip.
                    continue;
                }
                instanceBatches.push({
                    ordinal, index: region, materialId: matId, name: obj.name,
                    instanceCount: placementCount(obj.placements),
                    ...(attributeRows !== undefined ? { attributeRows } : {}),
                    slot: dataLayout.batches[ordinal],
                    // Containment (impl-plan-instanced-containment): omitted when false so
                    // every opaque batch's plan stays byte-identical.
                    ...(batchNeedsInterior(obj, scene) ? { hasInterior: true } : {}),
                    // Prototype has NO transform → just canonicalize (no fold). record (the
                    // adapter's ONE tier truth): 'frame' = 2-texel rigid record, s scales the
                    // params in-shader; 'params' = 1-texel folded-parameters record, world-space
                    // intersect (impl-plan-placement-fold stage 3).
                    // MARCHED prototypes (impl-plan-sdf-as-shape T7) ride the same record
                    // and the same leaf item — only the intersect line differs, which is
                    // the whole point of the merge. Frame tier: the bound test and the
                    // march both run in the prototype's own frame.
                    prototype: {
                        backend: 'primitive', shapeType: proto.type,
                        record: backend === 'sdf' ? 'frame' : batchPlacementRecord[ordinal],
                        parameters: canonicalizePrimitiveParameters(proto.type, proto.parameters),
                        intersect: backend === 'sdf' ? 'march' : 'closed-form',
                    },
                });
            }
            continue;
        }
        const backend = resolveBackend(obj.type, obj.backend);
        if (backend === undefined) {
            // Unregistered type or unhonorable pin — a diagnostic, never a throw (C7).
            const which = `Object ${scene.objects.indexOf(obj)}${obj.name !== undefined ? ` ('${obj.name}')` : ''}`;
            bag.error('missing-geometry',
                `${which}: primitive '${obj.type}' is not implemented yet (available: ${implementedTypes().join(', ')})`)
                .add();
            objectIndex++;   // keep region ids scene-order stable for the remaining objects
            continue;
        }
        const matId = materialIdMap.get(obj.material)!;   // validated by Validator

        if (backend === 'sdf') {
            // Placement (fable-transforms §5.2/§6): constant → the point param folds into
            // the placement as a pre-translation and the wrapper owns all positioning;
            // driven → the uniform record with LOCAL parameters.
            const { parameters, placement } = resolveSDFPlacement(obj.type, obj.parameters, obj.transform, objectIndex, keepsLocalFrame(obj, scene));
            objects.push({ index: objectIndex++, materialId: matId, type: obj.type, intersect: 'march', name: obj.name, parameters, placement });
        } else if (isDrivenTransform(obj.transform)) {
            // Driven (§6): parameters stay LOCAL (plane still canonicalized); the
            // generated arm conjugates the ray into the rigid frame. The Validator
            // has already rejected driven SAMPLABLE emitters, so the light registry
            // never sees these.
            const regionId = objectIndex++;
            objects.push({
                index: regionId,
                materialId: matId,
                type: obj.type,
                intersect: 'closed-form',
                name: obj.name,
                parameters: canonicalizePrimitiveParameters(obj.type, obj.parameters),
                placement: buildDrivenPlacement(obj.transform!, regionId),
            });
        } else {
            // A PATTERNED + rotated shape must NOT bake its rotation away — the chart needs the
            // frame the fold dissolves (fable-imagery P1b). Emit it like a movable shape but with
            // CONSTANT placement: canonical params + retained similarity, so hit-finding AND the
            // uv chart both run in the shape's own frame (the per-ray un-rotate is paid ONLY
            // here). Everything else folds ENTIRELY into canonical parameters (the analytic set
            // is similarity-closed — fable-transforms §5.1; folding keeps the light registry on
            // resolved params so a sampleAsLight emitter cannot drift from its geometry). ONE
            // predicate with the table adapter (keepsLocalFrame) — a retained shape is never
            // tabled. (Patterned ⟹ checker/expression ⟹ non-emissive, so no light drift.)
            // Non-patterned constants route through classifyPlacement (the ONE fold
            // truth, stage-4 amendment): similarity-closed shapes fold ENTIRELY;
            // non-closed analytic shapes (box/cylinder — placement-fold stage 4) fold
            // T,s and keep the pure-rotation residual as a CONSTANT placement (the
            // P1b emission shape — baked vec4s, no uniforms). Identity residuals bake
            // no placement at all, so closed shapes keep their bare params-folded arms.
            const cl = keepsLocalFrame(obj, scene)
                ? null
                : classifyPlacement(obj.type, obj.parameters, placementOf(obj.transform));
            const residualLive = cl !== null && !(isIdentityRotation(cl.residual.rotation) && cl.residual.scale === 1
                && cl.residual.translation[0] === 0 && cl.residual.translation[1] === 0 && cl.residual.translation[2] === 0);
            objects.push({
                index: objectIndex++,
                materialId: matId,
                type: obj.type,
                intersect: 'closed-form',
                name: obj.name,
                ...(cl === null
                    ? { parameters: canonicalizePrimitiveParameters(obj.type, obj.parameters), placement: placementOf(obj.transform) }
                    : residualLive
                        ? { parameters: cl.parameters, placement: cl.residual }
                        : { parameters: cl.parameters }),
            });
        }
    }

    // --- Lights: the registry, in light-id order (= selection-CDF order), IS the light roster
    // (lightRosterOf): authored lights, then emissive analytic objects, then emissive meshes.
    // The roster computed each light's values; here each entry is tied to its region. The data
    // layout sized the light table and tree from the same list, so they cannot disagree.
    //
    // An authored HITTABLE light desugars to an emissive region: a synthesized material (the
    // backing model is lambert with albedo 0 — the only site that chooses it) and an object of
    // the kind's backing primitive. The material's emission is the same value the light's rows
    // were built from (authoredLightEmission), so the hit side and the sampler agree exactly
    // (any mismatch makes pt and pt-nee converge to different images). An emissive OBJECT's
    // region id is its scene index.
    const lights: PlannedLight[] = lightRosterOf(scene).map((entry, id): PlannedLight => {
        if ('authored' in entry.source) {
            const light = scene.lights[entry.source.authored];
            const d = LIGHT_KINDS[entry.kind];
            if (d.region === undefined) return { id, kind: entry.kind, values: entry.values };
            const matId = materialIndex++;
            materials.push({
                id: matId,
                name: `__light_${id}`,
                model: 'lambert',
                values: resolveMaterialValues('lambert', { albedo: [0.0, 0.0, 0.0], emission: authoredLightEmission(light.emission) as MaterialProperty }),
                medium: null,
            });
            const regionId = objectIndex++;
            // Row defaults applied once by the framework (the record the Validator judged);
            // canonicalization (the disk's unit normal) is the same formula the kind's
            // toValues applies, so hit side and sample side stay bit-identical.
            const authored = applyAuthoredDefaults(d, light as unknown as Record<string, unknown>);
            objects.push({
                index: regionId,
                materialId: matId,
                type: d.region.primitive,
                intersect: 'closed-form',
                parameters: canonicalizePrimitiveParameters(d.region.primitive, d.region.parameters(authored)),
            });
            return { id, kind: entry.kind, regionId, values: entry.values };
        }
        const regionId = entry.source.object;
        if (entry.kind !== 'mesh') return { id, kind: entry.kind, regionId, values: entry.values };
        // A mesh emitter samples its triangles by area: the literal walk range and the channel
        // bases of its world-position bake and area CDF (the ledger allocated them for exactly
        // these meshes — meshIsSamplableEmitter, the census predicate).
        const mesh = meshes.find((m) => m.index === regionId)!;
        const lslot = dataLayout.meshLights.get(mesh.ordinal)!;
        return {
            id, kind: 'mesh', regionId, values: entry.values,
            mesh: { ordinal: mesh.ordinal, triCount: mesh.triCount, tbase: mesh.slot.tbase, wposBase: lslot.wposBase, cdfBase: lslot.cdfBase },
        };
    });

    // Selection-power context (impl-plan-directional-beam P6): pbrt's DistantLight
    // formula Φ = E·π·R² needs the scene's bounding radius — stamped on EVERY light
    // (no kind branch, the doors discipline; kinds read it or don't). Never
    // parameter-driven, so the driven-CDF recompute closures capture it untouched.
    const worldRadius = sceneWorldRadius(objects.filter((o) => o.intersect === 'closed-form'), meshes);
    for (const l of lights) l.powerCtx = { worldRadius };

    // --- Ambient medium (§2.4): material_of(-1) resolves to this id; -1 = vacuum ---
    const ambientMedium = scene.ambientMedium !== undefined
        ? materialIdMap.get(scene.ambientMedium) ?? -1   // unknown name already errored in the Validator
        : -1;

    // --- The planned scene table (fable-object-tables) — bases + counts + kind codes
    // from the adapter's ONE truth; tabled analytic objects marked for the feature's
    // residual/table split. Present whether or not this strategy tables (the data is
    // strategy-independent; 'unrolled' programs never read it).
    let sceneTable: PlannedSceneTable | undefined;
    if (sceneTableTruth !== null && dataLayout.sceneTable !== undefined) {
        const tabledSet = new Set(sceneTableTruth.analytic.map((a) => a.sceneIndex));
        for (const a of objects) if (a.intersect === 'closed-form' && tabledSet.has(a.index)) a.tabled = true;
        // Boxed-SDF leaves (impl-plan-sdf-accel T2): tabled SDF objects leave the
        // global marcher for the LEAF_SDF interval march — the same residual/table
        // split, on the SDF arm.
        const sdfTabledSet = new Set(sceneTableTruth.sdf.map((s) => s.sceneIndex));
        for (const o of objects) if (sdfTabledSet.has(o.index)) o.tabled = true;
        sceneTable = {
            slot: dataLayout.sceneTable,
            regionMaterialsBase: dataLayout.regionMaterials?.base ?? -1,
            leafCount: sceneTableTruth.leaves.length,
            analyticCount: sceneTableTruth.analytic.length,
            solidCount: sceneTableTruth.solidCount,
            kinds: [...sceneTableTruth.kindCodes].map(([type, code]) => ({ type, code })),
            tabledMeshOrdinals: sceneTableTruth.leaves.filter((l) => l.kind === 1).map((l) => l.ref),
            sdfRecords: sceneTableTruth.sdf.map((s) => ({ region: s.sceneIndex, type: s.type, solid: s.solid })),
            sdfKinds: [...sceneTableTruth.sdfKindCodes].map(([type, code]) => ({ type, code })),
        };
    }

    // --- The light tree's baked slot. Batch instance lights (fable-light-bvh §7 stage 2) take
    // the GLOBAL light-index bases after the registry lights: each eligible batch's instances
    // in record order.
    let lightBase = lights.length;
    const instanceLights = sceneLightBatches.map(({ ordinal, count }) => {
        const entry = { ordinal, base: lightBase, count };
        lightBase += count;
        return entry;
    });
    const lightTree = dataLayout.lightTree !== undefined
        ? {
            treeBase: dataLayout.lightTree.treeBase,
            tableBase: dataLayout.lightTree.tableBase,
            trailsBase: dataLayout.lightTree.trailsBase,
            strideTexels: lights.length > 0 ? lightTableLayout(lights.map((l) => l.kind)).strideTexels : 0,
            count: lightBase,
            registryCount: lights.length,
            instanceLights,
        }
        : undefined;

    // --- Build program description ---
    const program = planProgram(features, scene, strategy, lights, materials, objects, meshes, instanceBatches, instanceLights.reduce((a, b) => a + b.count, 0));
    const pipeline = planPipeline(program);

    return {
        objects,
        meshes,
        instanceBatches,
        data: { tenants: dataTenantsResult, layout: dataLayout },
        ...(sceneTable !== undefined ? { sceneTable } : {}),
        ...(lightTree !== undefined ? { lightTree } : {}),
        materials,
        lights,
        ambientMedium,
        program,
        pipeline,
    };
}

// ============================================================================
// Program description — what the generated program does
// ============================================================================

function planProgram(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, lights: PlannedLight[], materials: PlannedMaterial[], objects: PlannedPrimitiveObject[], meshes: PlannedMesh[], instanceBatches: PlannedInstanceBatch[], batchLightTotal: number): ProgramDescription {
    // Surface models = the models of the PLANNED materials — the one list that already
    // includes the desugared area lights' synthesized emitter materials, so a new hittable
    // light kind can never leave its backing model out of the program (the lights-door
    // rule: adding a kind must not touch this site). 'none' (§3.6) and unregistered
    // models fall out of the registry filter. Registry insertion order pins the dispatch
    // order (deterministic snapshots).
    const present = new Set(materials.map((m) => m.model));
    const brdfModels = (Object.keys(MATERIAL_MODELS) as MaterialModel[]).filter((m) => present.has(m));

    // Directional-emission gates (softbeam v0): kinds declaring the emissionCone fact
    // gate their backing material's hit-side emission by the SAME cone the sampler
    // reads (one profile truth — pt ≡ pt-nee). Registry-driven: no kind branch; the
    // backing material is found through the light's region (the desugar's own record).
    const emissionCones = lights.flatMap((l) => {
        const fact = LIGHT_KINDS[l.kind]?.emissionCone;
        if (fact === undefined || l.regionId === undefined) return [];
        const backing = objects.find((o) => o.index === l.regionId);
        return backing === undefined ? [] : [{ materialId: backing.materialId, ...fact(l.values) }];
    });

    // A samplable environment is a light for NEE purposes (T3) — an env-only scene under
    // 'nee'/'mis' gets the lighting infrastructure with an env-only lighting_sample.
    // `envKindSamplable` is the analyzer's SCENE FACT (the kind supports sampling); the
    // program DECISION (`environmentSamplable` below) also needs the NEE machinery to
    // exist at all (impl-plan-exact-linkage: under 'none' nothing can call the sampler).
    const envKindSamplable = features.environment.samplable;
    // Batch instance lights are samplable ONLY under the tree (fable-light-bvh §7):
    // under 'power' they stay path-found — an estimator-only difference (§11.2), and
    // the power CDF never meets a 100k-entry bake. batchLights true ⇒ NEE is on ⇒
    // lighting below is non-null.
    const selection = strategy.estimator.lightSelection ?? DEFAULT_LIGHT_SELECTION;
    const batchLights = selection === 'bvh' && batchLightTotal > 0
        && strategy.estimator.directLighting !== 'none';
    const hasLights = features.lighting.totalLightCount > 0 || envKindSamplable || batchLights;
    const wantsNEE = strategy.estimator.directLighting !== 'none' && hasLights;
    const lighting = wantsNEE
        ? {
              method: (strategy.estimator.directLighting === 'mis' ? 'mis' : 'nee') as 'mis' | 'nee',
              selection,
              // The env selection OVERRIDE rides only when authored — absent means the
              // derived power partition (impl-plan-env-power-selection).
              ...(strategy.estimator.envSelectWeight !== undefined
                  ? { envSelectWeight: strategy.estimator.envSelectWeight }
                  : {}),
          }
        : null;
    const envSamplable = envKindSamplable && lighting !== null;
    const mis = lighting?.method === 'mis';

    // Taxonomy §8 (the volumeIntegrator split): whether scattering is COMPUTED is a
    // measurement truncation (scattering 'ignored' renders scattering media absorbing-only);
    // HOW live scattering is sampled is the estimator's volumeSampling axis. 'analytic'
    // and 'delta-tracking' survive the Validator (which also enforces coherence:
    // 'analytic' × heterogeneous medium is an error, so vs matches the scene by here).
    const measurement = resolveMeasurement(scene, strategy);
    const scattering = measurement.scattering;
    const vs = strategy.estimator.volumeSampling ?? 'analytic';
    const scatteringArms = features.media.hasScatteringMedia
        && scattering === 'full'
        && (vs === 'analytic' || vs === 'delta-tracking');
    // Heterogeneous media (fable-heterogeneous-media.md; emission P5): some medium
    // ROUTES to a null-collision arm, so the delta/ratio occupant is included.
    // Independent of scatteringArms — an absorbing-only heterogeneous medium needs the
    // ratio pass-through arm with no phase machinery at all. Any expression coefficient
    // counts (even under scattering 'ignored' — the D1 clamp couples the fields), and
    // so does a constant-ε SCATTERING medium (the analytic channel-MIS arm has no
    // source term; its σ̄ is auto-derived at emit time).
    const heterogeneousArms = materials.some((m) =>
        m.medium !== null && mediumRoutesToTracking(
            m.medium, scattering === 'full' && mediumMayScatter(m.medium)));
    // The interior termination rule's precondition (docs/fable-subsurface.md §6): some
    // scattering medium settles absorption by WEIGHT rather than by the tracking lottery, so a
    // per-collision survival probability is genuinely owed. Same `scatters` resolution as the
    // routing above and as generateMediumSample's — one predicate, three readers.
    //
    // ROULETTE IS PART OF THE DECISION, not a separate gate downstream. The rule is the accessor's
    // ONLY consumer, so without roulette the accessor would link with nothing calling it — the
    // seam-unused case §2.12 exists to forbid. One decision, both emissions.
    const weightedAbsorptionArms = strategy.estimator.russianRoulette != null
        && materials.some((m) =>
            m.medium !== null && mediumWeightsAbsorption(
                m.medium, scatteringArms && mediumMayScatter(m.medium)));

    // §6.2: samplable-emitter machinery exists iff some light entered the registry with a
    // region (delta-only scenes compile to the pre-area-light program) — or batch
    // instance lights are live under the tree (their region is the batch's).
    const samplableEmitters = lights.some((l) => l.regionId !== undefined) || batchLights;

    // Object dispatch (hoisted so regionLookup shares the decision — one truth):
    // scene-dependent default (T6) past MARCHED_TABLE_THRESHOLD; an explicit
    // strategy always wins.
    const objectDispatch = strategy.estimator.objectDispatch
        ?? (objects.filter((o) => o.intersect === 'march').length >= MARCHED_TABLE_THRESHOLD ? 'table' : DEFAULT_OBJECT_DISPATCH);

    return {
        measurement,
        estimator: {
            lighting,
            russianRoulette: strategy.estimator.russianRoulette,
            // Reserved values ('raymarch'/'ratio-tracking') are Validator-rejected before
            // planning, so vs here is 'analytic' | 'delta-tracking'.
            volumeSampling: scatteringArms ? (vs as 'analytic' | 'delta-tracking') : 'none',
            // Placement is a decision only where a medium NEE estimate exists at all.
            mediumLightSampling: lighting !== null && scatteringArms
                ? (strategy.estimator.mediumLightSampling ?? 'vertex')
                : 'vertex',
            envSampler: {
                chart: strategy.estimator.envSampler ?? 'equirect',
                compensation: strategy.estimator.envCompensation ?? false,
            },
            // 'exponential' is reserved-not-built: the Validator rejects it before
            // planning, so no dead construction branch survives here (C6).
            accumulation: { type: strategy.estimator.accumulation.type },
        },
        view: {
            tonemap: strategy.view.tonemap.type === 'none'
                ? { type: 'none' }
                : { type: strategy.view.tonemap.type, exposure: strategy.view.tonemap.exposure },
        },
        // Seam decisions (impl-plan-exact-linkage): each generated dispatch/query exists
        // iff some included technique links it — the same conditions the techniques'
        // `requires` lists state, written down ONCE where the providers read them.
        intersection: {
            // Backend presence — the intersection family's link map (symmetric across all
            // three; scene_intersect combines exactly these arms). Derived from the resolved
            // plan objects, so byte-identical to the prior local length checks in the feature.
            classes: {
                primitive: objects.length > 0,
                mesh: meshes.length > 0,
                instanced: instanceBatches.length > 0,
            },
            // Traversal engines (impl-plan-mesh-bvh / impl-plan-tlas) — registry ids;
            // defaults from the registry (components/intersection), Validator-gatekept.
            meshTraversal: strategy.estimator.meshTraversal ?? DEFAULT_MESH_TRAVERSAL,
            instanceAccel: strategy.estimator.instanceAccel ?? DEFAULT_INSTANCE_ACCEL,
            // Scene-dependent default (T6): a scene with many MARCHED objects gets the
            // table, because the unrolled regime emits one march loop per object and the
            // shader compile grows superlinearly (measurements on the constant).
            objectDispatch,
            // The opaque shadow fast path is scene_intersect_any's only caller; the
            // media shadow walker re-spawns scene_intersect instead (§6.3).
            anyQuery: lighting !== null && !features.media.hasMedia,
            // Any leaf with a {param} transform field (fable-transforms §6) — gates
            // glsl/core/placement.glsl + the rigid-frame query tiers. (Instanced batches
            // also need placement.glsl — the feature includes it on `instanced` too.)
            drivenPlacement: scene.objects.some((o) => !isInstancedObject(o) && isDrivenTransform(o.transform)),
        },
        materials: {
            models: brdfModels,
            // Region→material lookup form (impl-plan-region-materials): 'data' rides
            // table dispatch — the ONE regime whose programs must stop scaling with
            // the object count. 'baked' keeps the folded constant arms (byte gate).
            regionLookup: objectDispatch === 'table' ? 'data' : 'baked',
            surfaceEval: lighting !== null,
            surfacePdf: mis,
            // Two-sided selection queries (fable-rough-dielectric §3): a receiver whose
            // BSDF support is the SPHERE and which runs NEE can be lit from below its
            // shading normal, so the light tree's horizon cull must disarm there. Gated
            // on NEE because without it there is no selection to shape at all.
            twoSidedShading: lighting !== null && brdfModels.some(modelTwoSidedShading),
            // Directional-emission gates (softbeam v0, fable-emitter-profiles): backing
            // materials whose hit-side emission is cone-gated by the kind's emissionCone
            // fact — registry-driven, baked literals (light geometry rows are constant).
            // OMITTED when empty so programs without softbeams are byte-identical.
            ...(emissionCones.length > 0 ? { emissionCones } : {}),
            // Gates the REAL uv charts (fable-imagery P1/P2): a scene with no uv-reading
            // material keeps the cheap planar placeholder everywhere (no wasted chart trig).
            // ONE "reads uv" notion, shared with keepsLocalFrame (materialReadsUv): a PROCEDURAL
            // material — checker OR any formula. COARSE by choice (owner Jul 21): a formula
            // reading only `p` still turns charts on — correctness-safe (a uv-formula is NEVER
            // missed), slightly wasteful. Precise per-formula uv-detection is the noted follow-up.
            materialsReadUv: Object.keys(scene.materials).some((name) => materialReadsUv(name, scene)),
        },
        media: {
            present: features.media.hasMedia,
            scatteringArms,
            heterogeneousArms,
            weightedAbsorptionArms,
            // Emissive media (impl-plan-medium-emission): the MediumProperties ε field,
            // the arms' collection lines, and the walk's radiance line exist. NOT gated
            // on scattering — emission is a source term, not scattering (the 'ignored'
            // truncation does not suppress it).
            emission: features.media.hasMedia && features.media.hasEmissiveMedia,
            nullInterfaces: features.media.hasNullInterfaces,
            // GRIN (fable-variable-ior.md): any planned medium carries a refractive index.
            deflecting: materials.some((m) => m.medium !== null && m.medium.ior !== undefined),
            shadowWalker: features.media.hasMedia && lighting !== null,
            mediumEval: scatteringArms && lighting !== null,
            mediumPdf: scatteringArms && mis,
            // Distinct scattering models present → the MediumProperties field union + the
            // generated interaction_medium_* dispatch. Only meaningful when scattering is
            // live (the phase is invoked only at scatter events); [] otherwise.
            models: scatteringArms
                ? Object.keys(VOLUME_SCATTERING_MODELS).filter((k) =>
                    Object.values(scene.materials).some((m) => m.medium !== undefined && (m.medium.model ?? 'hg') === k))
                : [],
        },
        emitters: {
            samplable: samplableEmitters,
            lightingPdf: samplableEmitters && lighting?.method === 'mis',
            // Driven-lights Stage A: a ValueParam reaches PlannedLight.values ONLY via a
            // driven radiometric row (geometry stays constant in v1), so this is exactly
            // "some light's emission is a {param}".
            driven: lighting !== null && lights.some((l) => Object.values(l.values).some((v) => isValueParam(v) || isBlackbody(v))),   // a driven blackbody dial is driven emission
        },
        environment: resolveEnvironment(scene.environment),
        environmentSamplable: envSamplable,
        environmentPdf: envSamplable && mis,
        // Selection is live only when finite lights split mass with the env; env-only
        // programs fold the draw to certainty (changing it would be bias — plan O1).
        // Batch instance lights are finite lights under 'bvh' (the samplers' two-stage
        // draw reads the uniform whenever the env is samplable).
        environmentSelectionLive: envSamplable && (lights.length > 0 || batchLights),
    };
}

// ============================================================================
// Pipeline — derived from program description
// ============================================================================

function planPipeline(program: ProgramDescription): PlannedPipeline {
    // Variance accumulation adds a second-moment attachment to the SAME double_buffer
    // (MRT): mean and moment then ping-pong in lockstep by construction — one swap flips
    // both attachments, so they can never desynchronize. The display pass still reads
    // attachment 0 (the mean); the moment is instrumentation, exported via readBuffer.
    const variance = program.estimator.accumulation.type === 'variance';

    return {
        framebuffers: [
            variance
                ? { id: 'accumulation', type: 'double_buffer', format: ['rgba32f', 'rgba32f'] }
                : { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
            { id: 'screen', type: 'screen' },
            // On-demand LDR export target (impl-plan-display Stage 4 / Option B): the
            // display pass is re-run into this rgba8 buffer ONLY when exporting a PNG —
            // zero cost on the normal display→screen path (allocated, not rendered).
            { id: 'ldr', type: 'texture', format: 'rgba8' },
        ],
        passes: [
            {
                role: 'pathtracer',
                inputs: variance
                    ? { 'u_previous': 'accumulation_previous', 'u_previousMoment': 'accumulation_previous:1' }
                    : { 'u_previous': 'accumulation_previous' },
                output: variance
                    ? ['accumulation_current:0', 'accumulation_current:1']
                    : 'accumulation_current',
            },
            {
                role: 'display',
                // Encoding tonemaps dither the 8-bit write → they bind the global
                // blue-noise tile; 'none' (raw probe path) does not.
                inputs: tonemapModel(program.view.tonemap.type).encodesToDisplay
                    ? { 'u_radiance': 'accumulation_current', 'u_blueNoise': 'extern:blue_noise' }
                    : { 'u_radiance': 'accumulation_current' },
                output: 'screen',
            },
        ],
        swaps: [{ buffers: ['accumulation'] }],
    };
}

/** Authored TRS → the canonical Similarity. The lowering itself lives beside the
 *  algebra (`similarityFromTransform`) so the authoring layer's `flattenGroups` and
 *  this fold share ONE implementation; the alias keeps the Planner's vocabulary. */
export const placementOf = similarityFromTransform;

// ============================================================================
// Driven placement (fable-transforms §6/§6.1)
// ============================================================================
// A leaf with any {param} transform field takes the uniform tier: two vec4 uniforms
// per object carrying the INVERSE similarity in rigid form — q_inv and (t_rigid=−Rᵀt, s)
// — recomputed host-side in fp64 from the parameter map on every change. Constants
// mix freely with params; they are baked into the closures. Guard rails (§6.1 pin 4):
// the Validator cannot see runtime values, so the closure renormalizes rotations,
// clamps scale away from zero, and warns ONCE instead of uploading a singular payload.

/** Reader of one TRS field from the live parameter map (constants baked in). */
type FieldReader<T> = (params: Record<string, unknown>) => T;

export function buildDrivenPlacement(transform: Transform, index: number): DrivenPlacement {
    const paths: string[] = [];
    const parameters: Record<string, ParameterMetadata> = {};
    let warned = false;
    const warnOnce = (msg: string) => {
        if (!warned) { warned = true; console.warn(`driven placement (object ${index}): ${msg}`); }
    };
    const label = (path: string) => path.split('.').pop() ?? path;

    // -- position --
    let readPosition: FieldReader<Vec3Tuple>;
    const pos = transform.position;
    if (isValueParam(pos)) {
        const def = (pos.default ?? [0, 0, 0]) as Vec3Tuple;
        paths.push(pos.param);
        parameters[pos.param] = { type: 'vec3', default: def, name: label(pos.param), group: 'Placement', triggersReset: true };
        readPosition = (p) => {
            const v = p[pos.param] as number[] | undefined;
            return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? (v as Vec3Tuple) : def;
        };
    } else {
        const c = (pos ?? [0, 0, 0]) as Vec3Tuple;
        readPosition = () => c;
    }

    // -- rotation: quaternion (const | param) or axis-angle (angle const | param) --
    let readRotation: FieldReader<Quat>;
    const rot = transform.rotation;
    const safeQuat = (q: number[] | undefined, fallback: Quat): Quat => {
        if (!Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) return fallback;
        const norm = Math.hypot(q[0], q[1], q[2], q[3]);
        if (norm < 1e-6) { warnOnce('degenerate quaternion — using identity'); return IDENTITY_QUAT; }
        return quatNormalize(q as Quat);
    };
    if (rot === undefined) {
        readRotation = () => IDENTITY_QUAT;
    } else if (isValueParam(rot)) {
        const def = safeQuat(rot.default as number[] | undefined, IDENTITY_QUAT);
        paths.push(rot.param);
        parameters[rot.param] = { type: 'vec4', default: def, name: label(rot.param), group: 'Placement', triggersReset: true };
        readRotation = (p) => safeQuat(p[rot.param] as number[] | undefined, def);
    } else if (Array.isArray(rot)) {
        const c = quatNormalize(rot);
        readRotation = () => c;
    } else {
        // axis-angle; the axis is constant (Validator-checked non-zero), the angle may drive.
        const axis = rot.axis as Vec3Tuple;
        const angle = rot.angle;
        if (isValueParam(angle)) {
            const def = typeof angle.default === 'number' && Number.isFinite(angle.default) ? angle.default : 0;
            paths.push(angle.param);
            parameters[angle.param] = {
                type: 'float', default: def, name: label(angle.param), group: 'Placement', triggersReset: true,
                ...(angle.min !== undefined && angle.max !== undefined ? { range: [angle.min, angle.max] as [number, number] } : {}),
            };
            readRotation = (p) => {
                const a = p[angle.param];
                return quatFromAxisAngle(axis, typeof a === 'number' && Number.isFinite(a) ? a : def);
            };
        } else {
            const c = quatFromAxisAngle(axis, angle);
            readRotation = () => c;
        }
    }

    // -- scale (strictly positive; runtime floor per §6.1 pin 4) --
    let readScale: FieldReader<number>;
    const scl = transform.scale;
    if (isValueParam(scl)) {
        const floor = scl.min !== undefined && scl.min > 0 ? scl.min : 1e-6;
        const def = typeof scl.default === 'number' && scl.default > 0 ? scl.default : 1;
        paths.push(scl.param);
        parameters[scl.param] = {
            type: 'float', default: def, name: label(scl.param), group: 'Placement', triggersReset: true,
            ...(scl.min !== undefined && scl.max !== undefined ? { range: [scl.min, scl.max] as [number, number] } : {}),
        };
        readScale = (p) => {
            const s = p[scl.param];
            if (typeof s !== 'number' || !Number.isFinite(s) || s < floor) {
                if (typeof s === 'number') warnOnce(`scale ${s} clamped to ${floor} (must stay > 0)`);
                return typeof s === 'number' && Number.isFinite(s) ? floor : def;
            }
            return s;
        };
    } else {
        const c = (scl ?? 1) as number;
        readScale = () => c;
    }

    // The §6.1 rigid-form inverse, computed fp64 host-side (rigidInverse = the ONE ABI truth,
    // shared with instancing's constant-placement lowering).
    const evalQ = (p: Record<string, unknown>): number[] => rigidInverse({ rotation: readRotation(p), translation: readPosition(p), scale: readScale(p) }).q;
    const evalTS = (p: Record<string, unknown>): number[] => rigidInverse({ rotation: readRotation(p), translation: readPosition(p), scale: readScale(p) }).ts;

    const uniformQ = `u_object${index}PlacementQ`;
    const uniformTS = `u_object${index}PlacementTS`;
    return {
        kind: 'driven',
        uniformQ,
        uniformTS,
        uniforms: [
            { name: uniformQ, type: 'vec4', parameterPath: paths[0], parameterPaths: paths, default: evalQ({}), compute: evalQ },
            { name: uniformTS, type: 'vec4', parameterPath: paths[0], parameterPaths: paths, default: evalTS({}), compute: evalTS },
        ],
        parameters,
    };
}

/**
 * SDF placement (fable-transforms §5.2 as built — impl-plan-placement-fold stage 2):
 * constant placements fold MAXIMALLY into the canonical parameters via
 * `classifyPlacement` (closed shapes emit NO wrapper at all; non-closed shapes fold
 * T,s and keep a pure-rotation residual on the rigid tier — the `s·d` similarity
 * tier is dead for constants). `retainFrame` (keepsLocalFrame, the shared P1b
 * predicate — its third reader) preserves the historical wrapper emission instead:
 * the oriented uv chart mirrors the SDF wrapper, so a rotated shape whose material
 * reads uv must keep the frame the fold would dissolve. On that path the single
 * point row folds into the placement as a PRE-translation (the object rotates about
 * its own origin, carrying the offset along), preventing double-offset when both
 * center and transform are set.
 */
export function resolveSDFPlacement(
    type: string,
    rawParameters: Record<string, number | number[]>,
    transform: Transform | undefined,
    index: number,
    retainFrame = false,
): { parameters: Record<string, number | number[]>; placement: PlannedPlacement } {
    // Driven (§6): parameters stay LOCAL — the rigid-frame query scales them in-shader,
    // so there is no fold (the wrapper handles ALL placement, live). Canonicalization
    // applies exactly ONCE on every path (plane: unit normal + scaled offset — the SDF
    // expression is a true distance bound only then); classifyPlacement canonicalizes
    // internally, so the fold path hands it RAW values.
    if (isDrivenTransform(transform)) {
        return { parameters: canonicalizePrimitiveParameters(type, rawParameters), placement: buildDrivenPlacement(transform!, index) };
    }

    const placement = placementOf(transform);
    if (retainFrame) {
        const parameters = canonicalizePrimitiveParameters(type, rawParameters);
        const pointParams = primitive(type).params.filter((p) => p.kind === 'point');
        const point = pointParams.length === 1
            ? parameters[pointParams[0].name] as number[] | undefined
            : undefined;
        if (!point) {
            return { parameters, placement };
        }
        return {
            parameters: { ...parameters, [pointParams[0].name]: [0, 0, 0] },
            placement: similarityCompose(placement, {
                rotation: IDENTITY_QUAT,
                translation: point as [number, number, number],
                scale: 1,
            }),
        };
    }

    const classified = classifyPlacement(type, rawParameters, placement);
    return { parameters: classified.parameters, placement: classified.residual };
}

/** Schema-driven property resolution (materials-§7): exactly the model's declared rows,
 *  `authored ?? row.default`, shaped by glslType (Spectrum broadcasts the scalar default
 *  and accepts scalar-with-broadcast authored values; float rejects vectors). 'none' and
 *  unregistered models resolve to no values — they declare nothing. */
export function resolveMaterialValues(
    model: MaterialModel,
    authored: Record<string, MaterialProperty | undefined>,
): Record<string, ResolvedProperty> {
    const values: Record<string, ResolvedProperty> = {};
    if (model === 'none') return values;
    for (const row of MATERIAL_MODELS[model]?.properties ?? []) {
        const v = authored[row.source];
        values[row.source] = row.glslType === 'Spectrum'
            ? resolveColorProperty(v, [row.default, row.default, row.default])
            : resolveScalarProperty(v, row.default);
    }
    return values;
}

/** Medium resolution (§3.5): sigma_a/sigma_s/model are the fixed RTE core; phase params
 *  are the medium's OWN model's schema rows (union fields of other present models fall
 *  back to their row defaults at emit time). */
function resolveMedium(med: MediumDescription): PlannedMedium {
    const model = med.model ?? 'hg';
    const values: PlannedMedium['values'] = {};
    for (const row of VOLUME_SCATTERING_MODELS[model]?.properties ?? []) {
        values[row.source] = resolveScalarProperty(
            (med as unknown as Record<string, MaterialProperty | undefined>)[row.source], row.default);
    }
    // Media coefficients are NOT blackbody surfaces (σ is extinction, not radiance);
    // the narrowing below is honest — isBlackbody σ is Validator-rejected upstream.
    const noBB = (v: ReturnType<typeof resolveColorProperty>): Vec3 | GlslExpression | ValueParam<Vec3> => {
        if (isBlackbody(v)) throw new Error('blackbody spelling on a medium coefficient (Validator should have rejected it)');
        return v;
    };
    return {
        sigma_a: noBB(resolveColorProperty(med.sigma_a, [0.0, 0.0, 0.0])),
        sigma_s: noBB(resolveColorProperty(med.sigma_s, [0.0, 0.0, 0.0])),
        model,
        // Heterogeneous D1: carried only when authored (the Validator enforces the
        // expression↔majorant pairing and warns on inert declarations).
        ...(med.majorant !== undefined ? { majorant: med.majorant } : {}),
        emission: noBB(resolveColorProperty(med.emission, [0.0, 0.0, 0.0])),
        values,
        // GRIN (fable-variable-ior.md): present ⇒ deflecting. Default n = 1 (vacuum) is the
        // continuous-boundary convention; a scalar constant/{param}/formula over p.
        ...(med.ior !== undefined ? { ior: resolveScalarProperty(med.ior, 1.0) } : {}),
    };
}

export function resolveColorProperty(value: MaterialProperty | undefined, fallback: Vec3): Vec3 | GlslExpression | ValueParam<Vec3> | BlackbodyValue {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (isBlackbody(value)) return foldBlackbody(value);   // constant dials bake; driven survive
    if (isValueParam(value)) {
        // Scalar spectra intentionally broadcast. Do the same for a parameter default so
        // the generated vec3 uniform can never receive a scalar on its initial upload.
        if (typeof value.default === 'number') {
            return { ...value, default: [value.default, value.default, value.default] } as ValueParam<Vec3>;
        }
        return value as ValueParam<Vec3>;  // preserve — emitted as a uniform (§2.8)
    }
    if (typeof value === 'number') return [value, value, value] as Vec3;
    return value;
}

export function resolveScalarProperty(value: MaterialProperty | undefined, fallback: number): number | GlslExpression | ValueParam<number> {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (isValueParam(value)) return value as ValueParam<number>;  // preserve — emitted as a uniform (§2.8)
    if (typeof value === 'number') return value;
    // Validator reports this before planning. Keep a hard backstop for direct helper use
    // and for untyped JavaScript callers so a malformed scalar can never compile silently.
    throw new Error('Scalar material property cannot be a vector');
}

/** Bounding-sphere radius (about the world origin) of the scene's boundable geometry —
 *  the pbrt worldRadius for `power(values, ctx)` (impl-plan-directional-beam P6).
 *  VARIANCE-ONLY by contract (selection weights; cdf_rescale keeps them unbiased), so
 *  coarse by license: folded analytic objects through the bounds fact (unbounded
 *  primitives — plane — and local-frame/driven objects skipped), closed meshes as
 *  placed spheres around their local boxes; SDF objects and instance batches skipped.
 *  Nothing boundable → 10, the constant the directional descriptor's ctx-fallback twins. */
function sceneWorldRadius(analytic: PlannedPrimitiveObject[], meshes: PlannedMesh[]): number {
    let r = 0;
    let any = false;
    for (const o of analytic) {
        if (o.placement !== undefined) continue;   // local-frame parameters are not world boxes
        const b = primitiveBounds(o.type, o.parameters) ?? undefined;
        if (b === undefined) continue;
        // Max corner norm of the world AABB: per-axis worst magnitude, combined.
        r = Math.max(r, Math.hypot(
            Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])),
            Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])),
            Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])),
        ));
        any = true;
    }
    for (const m of meshes) {
        if (m.localBox === undefined || isDrivenPlacement(m.placement)) continue;
        const g = m.placement as Similarity;
        const half = Math.hypot(
            (m.localBox.max[0] - m.localBox.min[0]) / 2,
            (m.localBox.max[1] - m.localBox.min[1]) / 2,
            (m.localBox.max[2] - m.localBox.min[2]) / 2,
        );
        const center = Math.hypot(
            (m.localBox.max[0] + m.localBox.min[0]) / 2,
            (m.localBox.max[1] + m.localBox.min[1]) / 2,
            (m.localBox.max[2] + m.localBox.min[2]) / 2,
        );
        // Rotation-free sphere bound: |t| + s·(local radius about the local origin).
        r = Math.max(r, Math.hypot(g.translation[0], g.translation[1], g.translation[2]) + g.scale * (half + center));
        any = true;
    }
    return any ? Math.max(r, 1e-3) : 10;
}
