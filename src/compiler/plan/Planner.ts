// compiler/plan/Planner.ts

import type { SceneDescription, RenderStrategy, MaterialModel, MediumDescription, Vec3, MaterialProperty, GlslExpression, ValueParam, Transform, ParameterMetadata } from '../types.js';
import { isGlslExpression, isValueParam, isBlackbody, mediumRoutesToTracking, mediumMayScatter, hasConstantNonzeroEmission, isMeshObject, isInstancedObject } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';
import { MATERIAL_MODELS, EMISSION_KEY } from '../../components/materials/index.js';
import { LIGHT_KINDS, applyAuthoredDefaults } from '../../components/lights/index.js';
import { tonemapModel } from '../../components/tonemap/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../components/volume_scattering/index.js';
import { PRIMITIVES, primitive, canonicalizePrimitiveParameters, foldAnalyticParameters, resolveBackend } from '../../components/geometry/index.js';
import {
    IDENTITY_QUAT,
    isDrivenTransform,
    quatFromAxisAngle,
    quatNormalize,
    rigidInverse,
    similarityCompose,
    similarityFromTransform,
    type Quat,
    type Similarity,
    type Vec3Tuple,
} from '../../components/geometry/similarity.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import type { RenderPlan, PlannedSDFObject, PlannedAnalyticObject, PlannedMesh, PlannedInstanceBatch, PlannedMaterial, PlannedMedium, PlannedLight, PlannedSceneTable, ProgramDescription, PlannedPipeline, DrivenPlacement, PlannedPlacement, ResolvedProperty, ResolvedEnvironment } from './types.js';
import { foldBlackbody } from '../../components/lights/blackbody.js';
import { meshWorldArea } from '../../components/lights/mesh/mesh.js';
import { isDrivenPlacement } from './types.js';
import { sceneMeshes } from '../../components/intersection/mesh/mesh.js';
import { meshLocalBox } from '../../components/intersection/mesh/topology.js';
import { dataTenantsOf, keepsLocalFrame, materialReadsUv } from './dataTenants.js';
import { planDataLayout } from '../../components/data/ledger.js';
import { sceneInstanceBatches, instanceAttributeRows } from '../../components/intersection/instancing/instancing.js';
import { DEFAULT_MESH_TRAVERSAL, DEFAULT_INSTANCE_ACCEL, DEFAULT_OBJECT_DISPATCH } from '../../components/intersection/index.js';
import type { BlackbodyValue } from '../types.js';

/** Registered primitive types — unknowns must diagnose here, not throw downstream
 *  (impl-plan-geometry-descriptors: the capability IS the descriptor fact). */
const implementedTypes = () => Object.keys(PRIMITIVES);

/** C2: the ONE place env defaults resolve — the plan record is closed (no optionals),
 *  so Generate reads values, never re-derives defaults. */
function resolveEnvironment(env: SceneDescription['environment']): ResolvedEnvironment {
    if (env === undefined || env.type === 'none') return { type: 'none' };
    if (env.type === 'constant') return { type: 'constant', color: env.color, intensity: env.intensity ?? 1.0 };
    if (env.type === 'image') return { type: 'image', url: env.url, intensity: env.intensity ?? 1.0, rotation: env.rotation ?? 0.0 };
    return { type: 'procedural', glsl: env.glsl, intensity: env.intensity ?? 1.0, rotation: env.rotation ?? 0.0 };
}

export function plan(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, bag: DiagnosticBag): RenderPlan {
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
    const objects: PlannedSDFObject[] = [];
    const analyticObjects: PlannedAnalyticObject[] = [];
    const meshes: PlannedMesh[] = [];
    const instanceBatches: PlannedInstanceBatch[] = [];
    // THE ordinal truth (audit A5): Planner (extern declaration) and App (upload) both
    // derive mesh/batch ordinals from the SAME shared enumerators — the assignment can
    // never diverge, including for Validator-rejected batches (which still hold their
    // ordinal on both sides; they just never plan).
    const meshOrdinals = new Map(sceneMeshes(scene.objects).map((m, i) => [m, i] as const));
    const batchOrdinals = new Map(sceneInstanceBatches(scene.objects).map((b, i) => [b, i] as const));
    // Rail v2 (fable-data-rail): THE layout truth — the same adapter+ledger call the App
    // makes, so baked bases and packed bytes can never disagree.
    const { tenants: dataTenants, batchGeometrySlot, table: sceneTableTruth } = dataTenantsOf(scene);
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
                    instanceCount: obj.placements.length,
                    ...(attributeRows !== undefined ? { attributeRows } : {}),
                    slot: dataLayout.batches[ordinal],
                    prototype: { backend: 'mesh', triCount: proto.indices.length / 3, smooth: proto.normals !== undefined, geometrySlot: dataLayout.meshes[batchGeometrySlot[ordinal]!] },
                });
            } else {
                const backend = resolveBackend(proto.type, proto.backend);
                if (backend !== 'analytic') {
                    // v1: only mesh + analytic prototypes (SDF instancing = the deferred domain-rep
                    // generalization). The Validator diagnoses; keep region ids stable and skip.
                    continue;
                }
                instanceBatches.push({
                    ordinal, index: region, materialId: matId, name: obj.name,
                    instanceCount: obj.placements.length,
                    ...(attributeRows !== undefined ? { attributeRows } : {}),
                    slot: dataLayout.batches[ordinal],
                    // Prototype has NO transform → just canonicalize (no fold); s scales per instance in-shader.
                    prototype: { backend: 'analytic', shapeType: proto.type, parameters: canonicalizePrimitiveParameters(proto.type, proto.parameters) },
                });
            }
            continue;
        }
        const backend = resolveBackend(obj.type, obj.backend);
        if (backend === undefined) {
            // Unregistered type or unhonorable pin — a diagnostic, never a throw (C7).
            bag.error('missing-geometry',
                `Primitive '${obj.type}' is not implemented yet (available: ${implementedTypes().join(', ')})`)
                .add();
            objectIndex++;   // keep region ids scene-order stable for the remaining objects
            continue;
        }
        const matId = materialIdMap.get(obj.material)!;   // validated by Validator

        if (backend === 'sdf') {
            // Placement (fable-transforms §5.2/§6): constant → the point param folds into
            // the placement as a pre-translation and the wrapper owns all positioning;
            // driven → the uniform record with LOCAL parameters.
            const { parameters, placement } = resolveSDFPlacement(obj.type, obj.parameters, obj.transform, objectIndex);
            objects.push({ index: objectIndex++, materialId: matId, sdfType: obj.type, name: obj.name, parameters, placement });
        } else if (isDrivenTransform(obj.transform)) {
            // Driven (§6): parameters stay LOCAL (plane still canonicalized); the
            // generated arm conjugates the ray into the rigid frame. The Validator
            // has already rejected driven SAMPLABLE emitters, so the light registry
            // never sees these.
            const regionId = objectIndex++;
            analyticObjects.push({
                index: regionId,
                materialId: matId,
                shapeType: obj.type,
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
            analyticObjects.push({
                index: objectIndex++,
                materialId: matId,
                shapeType: obj.type,
                name: obj.name,
                ...(keepsLocalFrame(obj, scene)
                    ? { parameters: canonicalizePrimitiveParameters(obj.type, obj.parameters), placement: placementOf(obj.transform) }
                    : { parameters: foldAnalyticParameters(obj.type, obj.parameters, placementOf(obj.transform)) }),
            });
        }
    }

    // --- Assign lights (the §6.2 samplable registry; order = light id = CDF order) ---
    // REGISTRY-DRIVEN desugar (A3 — the lights door): the kind descriptor declares how
    // an authored light lowers — registry values (radiometric PRODUCTS computed once)
    // and, for hittable kinds, the backing emitter region. Le is shared EXACTLY
    // between the emission table and the sampler (any mismatch makes pt and pt-nee
    // converge to different images). Unregistered kinds (directional) are
    // Validator-rejected; skipped here.
    const lights: PlannedLight[] = [];
    let lightIndex = 0;
    for (const light of scene.lights) {
        const d = LIGHT_KINDS[light.kind];
        if (d === undefined) continue;
        // ONE authored word (B2): emission — Le for area kinds, radiant intensity for
        // delta kinds; scalar broadcasts (the spectrum convention, §2.5). Driven-lights
        // Stage A: a {param} emission flows through UNRESOLVED into both the registry
        // values (the sampler reads its uniform) AND, for hittable kinds, the synthesized
        // material's emission row — the SAME uniform, so pt ≡ pt-nee by construction.
        const e = light.emission;
        // Blackbody (impl-plan-blackbody-uv): constant dials FOLD here; a driven dial
        // flows through as the spec — the split point mints slider + derived uniform.
        const product: Vec3 | ValueParam<number> | ValueParam<Vec3> | BlackbodyValue =
            isValueParam(e) ? e
            : isBlackbody(e) ? foldBlackbody(e)
            : (typeof e === 'number' ? [e, e, e] : e);
        // Row defaults applied ONCE by the framework (D1) — the same record the
        // Validator judged; toValues/region.parameters read plain values.
        const authored = applyAuthoredDefaults(d, light as unknown as Record<string, unknown>);
        if (d.region === undefined) {
            lights.push({ id: lightIndex++, kind: light.kind, values: d.toValues(authored, product) });
            continue;
        }
        // Hittable: synthesize the emissive material + the backing region, THROUGH the
        // same schema path as authored materials (materials-§7 — no drift possible).
        // lambert is THE backing emitter model (albedo 0 = pure emitter) — the ONLY site
        // that knows it: planProgram derives the model set from planned materials, so the
        // choice propagates to includes/dispatch without a second synchronized site.
        const matId = materialIndex++;
        materials.push({
            id: matId,
            name: `__light_${lightIndex}`,
            model: 'lambert',
            values: resolveMaterialValues('lambert', { albedo: [0.0, 0.0, 0.0], emission: product }),
            medium: null,
        });
        const regionId = objectIndex++;
        analyticObjects.push({
            index: regionId,
            materialId: matId,
            shapeType: d.region.primitive,
            // Framework canonicalization (the disk's unit normal): the same shared
            // formula the kind's toValues applies — hit side and sample side stay
            // bit-identical (the one-sided pin).
            parameters: canonicalizePrimitiveParameters(d.region.primitive, d.region.parameters(authored)),
        });
        lights.push({ id: lightIndex++, kind: light.kind, regionId, values: d.toValues(authored, product) });
    }

    // sampleAsLight route (§6.2): emissive analytic quad/sphere OBJECTS join the registry —
    // per REGION, so two objects sharing one emissive material become two lights. V1: constant
    // nonzero emission only (Analyzer/Validator enforce); Le read from the material constant.
    for (const planned of analyticObjects) {
        const mat = materials[planned.materialId];
        if (mat === undefined || mat.name.startsWith('__light_')) continue;   // synthesized: already registered
        if (PRIMITIVES[planned.shapeType]?.samplableAsLight !== true) continue;
        // Driven placement (§6): parameters are LOCAL and the geometry is live — the
        // registry bakes literals, so driven emitters are Validator-rejected upstream;
        // this skip is the backstop that keeps a stale-literal light out of the CDF.
        if (planned.placement !== undefined) continue;
        const sceneMat = scene.materials[mat.name];
        if (sceneMat === undefined || sceneMat.sampleAsLight === false) continue;
        const emission = mat.values[EMISSION_KEY];
        if (!hasConstantNonzeroEmission(emission)) continue;   // C3: the ONE predicate (shared with Analyzer/Validator)
        const Le = emission as Vec3;
        // Registry-driven (A3): the kind whose backing region primitive matches this
        // object's shape converts the FOLDED parameters back to registry values —
        // both authoring routes share one kind definition.
        const kindEntry = Object.values(LIGHT_KINDS).find((k) => k.region?.primitive === planned.shapeType);
        if (kindEntry?.valuesFromRegion === undefined) continue;   // backstop; samplableAsLight already gated
        lights.push({
            id: lightIndex++, kind: kindEntry.kind, regionId: planned.index,
            values: kindEntry.valuesFromRegion(planned.parameters, Le),
        });
    }

    // Mesh emitters (fable-mesh-lights): the SAME sampleAsLight material route — an
    // emissive-material mesh OBJECT joins the registry as the data-driven 'mesh' kind.
    // Uniform-area: values carry Le + the WORLD total area (the identity-free pdf's one
    // constant, s²-folded) + triCount (the CDF walk's range). Driven placement excluded
    // (the §6 pin, Validator-enforced; the skip is the stale-literal backstop).
    for (const planned of meshes) {
        const mat = materials[planned.materialId];
        if (mat === undefined) continue;
        if (isDrivenPlacement(planned.placement)) continue;
        const sceneMat = scene.materials[mat.name];
        if (sceneMat === undefined || sceneMat.sampleAsLight === false) continue;
        const emission = mat.values[EMISSION_KEY];
        if (!hasConstantNonzeroEmission(emission)) continue;   // C3: the ONE predicate
        const src = sceneMeshes(scene.objects)[planned.ordinal];   // the ordinal truth
        const lslot = dataLayout.meshLights.get(planned.ordinal);
        if (lslot === undefined) continue;   // backstop: the route predicate ≡ the adapter's (meshIsSamplableEmitter)
        lights.push({
            id: lightIndex++, kind: 'mesh', regionId: planned.index,
            mesh: {
                ordinal: planned.ordinal, triCount: planned.triCount,
                tbase: planned.slot.tbase, wposBase: lslot.wposBase, cdfBase: lslot.cdfBase,
            },
            values: {
                radiance: emission as Vec3,
                area: meshWorldArea(src.positions, src.indices, (planned.placement as Similarity).scale),
            },
        });
    }

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
        for (const a of analyticObjects) if (tabledSet.has(a.index)) a.tabled = true;
        sceneTable = {
            slot: dataLayout.sceneTable,
            leafCount: sceneTableTruth.leaves.length,
            analyticCount: sceneTableTruth.analytic.length,
            solidCount: sceneTableTruth.solidCount,
            kinds: [...sceneTableTruth.kindCodes].map(([type, code]) => ({ type, code })),
            tabledMeshOrdinals: sceneTableTruth.leaves.filter((l) => l.kind === 1).map((l) => l.ref),
        };
    }

    // --- Build program description ---
    const program = planProgram(features, scene, strategy, lights, materials, objects, analyticObjects, meshes, instanceBatches);
    const pipeline = planPipeline(program);

    return {
        objects,
        analyticObjects,
        meshes,
        instanceBatches,
        ...(sceneTable !== undefined ? { sceneTable } : {}),
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

function planProgram(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, lights: PlannedLight[], materials: PlannedMaterial[], objects: PlannedSDFObject[], analyticObjects: PlannedAnalyticObject[], meshes: PlannedMesh[], instanceBatches: PlannedInstanceBatch[]): ProgramDescription {
    // Surface models = the models of the PLANNED materials — the one list that already
    // includes the desugared area lights' synthesized emitter materials, so a new hittable
    // light kind can never leave its backing model out of the program (the lights-door
    // rule: adding a kind must not touch this site). 'none' (§3.6) and unregistered
    // models fall out of the registry filter. Registry insertion order pins the dispatch
    // order (deterministic snapshots).
    const present = new Set(materials.map((m) => m.model));
    const brdfModels = (Object.keys(MATERIAL_MODELS) as MaterialModel[]).filter((m) => present.has(m));

    // A samplable environment is a light for NEE purposes (T3) — an env-only scene under
    // 'nee'/'mis' gets the lighting infrastructure with an env-only lighting_sample.
    // `envKindSamplable` is the analyzer's SCENE FACT (the kind supports sampling); the
    // program DECISION (`environmentSamplable` below) also needs the NEE machinery to
    // exist at all (impl-plan-exact-linkage: under 'none' nothing can call the sampler).
    const envKindSamplable = features.environment.samplable;
    const hasLights = features.lighting.totalLightCount > 0 || envKindSamplable;
    const wantsNEE = strategy.estimator.directLighting !== 'none' && hasLights;
    const lighting = wantsNEE
        ? {
              method: (strategy.estimator.directLighting === 'mis' ? 'mis' : 'nee') as 'mis' | 'nee',
              selection: strategy.estimator.lightSelection ?? 'power',
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
    const scattering = strategy.measurement.scattering ?? 'full';
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

    // §6.2: samplable-emitter machinery exists iff some light entered the registry with a
    // region (delta-only scenes compile to the pre-area-light program).
    const samplableEmitters = lights.some((l) => l.regionId !== undefined);

    return {
        measurement: {
            // Straight-through: unregistered camera types are Validator-rejected upstream
            // (reject-not-remove), so the Planner never coerces — CameraDesc mirrors the
            // strategy's CameraDescription exactly.
            camera: strategy.measurement.camera,
            // Ambient space rides the SCENE (the geometry-of-space is part of the
            // integral's domain); non-registry types are Validator-rejected upstream.
            ambient: scene.ambientSpace?.type ?? 'euclidean',
            response: strategy.measurement.response ?? 'radiance',
            maxBounces: strategy.measurement.maxBounces,
            scattering,
            shadows: strategy.measurement.shadows ?? 'opaque-dielectrics',
            color: 'rgb',   // 'spectral' is Validator-rejected (reserved, contracts §8)
        },
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
            backends: {
                sdf: objects.length > 0,
                analytic: analyticObjects.length > 0,
                mesh: meshes.length > 0,
                instanced: instanceBatches.length > 0,
            },
            // Traversal engines (impl-plan-mesh-bvh / impl-plan-tlas) — registry ids;
            // defaults from the registry (components/intersection), Validator-gatekept.
            meshTraversal: strategy.estimator.meshTraversal ?? DEFAULT_MESH_TRAVERSAL,
            instanceAccel: strategy.estimator.instanceAccel ?? DEFAULT_INSTANCE_ACCEL,
            objectDispatch: strategy.estimator.objectDispatch ?? DEFAULT_OBJECT_DISPATCH,
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
            surfaceEval: lighting !== null,
            surfacePdf: mis,
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
        environmentSelectionLive: envSamplable && lights.length > 0,
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
 * SDF placement (fable-transforms §5.2): a local POINT parameter is a PRE-translation
 * of the placement (the object rotates/scales about its own origin, carrying the
 * offset along) — folded so the generated wrapper owns ALL positioning and the SDF
 * call stays origin-centered, preventing double-offset when both center and transform
 * are set. Which parameter folds is DERIVED from the kind rows (the object's single
 * `kind: 'point'` param — plane has none, so it falls through with no type check).
 * For pure translations this reduces exactly to the old position+center sum (byte gate).
 */
export function resolveSDFPlacement(
    type: string,
    rawParameters: Record<string, number | number[]>,
    transform: Transform | undefined,
    index: number,
): { parameters: Record<string, number | number[]>; placement: PlannedPlacement } {
    // Descriptor canonicalization applies on BOTH paths (plane: unit normal + scaled
    // offset — the SDF expression is a conservative bound only then; the Validator
    // rejects the zero vector). Framework-applied, never a type-name branch.
    const parameters = canonicalizePrimitiveParameters(type, rawParameters);

    // Driven (§6): parameters stay LOCAL — the rigid-frame query scales them in-shader,
    // so there is no point fold (the wrapper handles ALL placement, live).
    if (isDrivenTransform(transform)) {
        return { parameters, placement: buildDrivenPlacement(transform!, index) };
    }

    const placement = placementOf(transform);
    // Exactly one point param folds; zero (plane) or several (no current primitive —
    // one translation cannot absorb two points) fall through unfolded. Only an
    // AUTHORED value folds — an omitted param resolves to its row default at emit
    // time, exactly as before the derivation.
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
