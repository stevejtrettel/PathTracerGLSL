// components/intersection/instancing/instancing.ts — the placement-list multiplier
// (impl-plan-instancing; rail v2 per fable-data-rail). NOT an engine of its own: an
// instanced batch is the driven ray-into-local wrapper looped over placement RECORDS,
// against a shared prototype (a mesh BLAS or an analytic closed form). This file owns:
//   - sceneInstanceBatches(objects) — THE batch-ordinal truth (the A5 pattern; the
//     ledger assigns each batch's records/nodes regions via the dataTenantsOf adapter).
//   - instanceAttributeRows — THE attribute slot-order truth (Planner mints refs, App
//     packs; the layout cannot drift).
//   - packInstanceBatch — a batch's RAW rail payloads: placement records + the TLAS
//     nodes (+ attrs records), all reordered by ONE TLAS permutation so Hit.element
//     indexes everything consistently.
// Pure TS (components purity; kind predicate restated locally, type-only imports).

import type { InstancedObject, ObjectDescription } from '../../../compiler/types.js';
import type { Similarity } from '../../geometry/similarity.js';
import { rigidInverse, similarityApplyPoint } from '../../geometry/similarity.js';
import { buildBVHNodes, transformAABB, type AABB } from '../../accel/bvh/bvh.js';
import { MATERIAL_MODELS } from '../../materials/index.js';

/** The scene's instanced batches in scene order — index IS the batch ordinal (see header). */
export function sceneInstanceBatches(objects: readonly ObjectDescription[]): InstancedObject[] {
    return objects.filter((o): o is InstancedObject => 'kind' in o && o.kind === 'instanced');
}

/** One attribute row's pack spec: the row shape + N authored entries (scene order;
 *  Spectrum rows accept scalar broadcast per entry). */
export interface AttributeRowSpec {
    shape: 'float' | 'vec3';
    values: ReadonlyArray<number | [number, number, number]>;
}

/** THE slot-order truth for a batch's attribute rows (fable-instance-attributes): the
 *  prototype material model's schema rows, in SCHEMA order, filtered to the authored keys.
 *  The Planner (slot minting → the generated fetches) and the App (records packing) both
 *  call THIS, so the texel layout cannot drift between compile and upload. */
export function instanceAttributeRows(model: string, attributes: Record<string, unknown>): Array<{ source: string; shape: 'float' | 'vec3' }> {
    const props = MATERIAL_MODELS[model]?.properties ?? [];
    return props
        .filter((f) => f.storage === 'field' && f.source in attributes)
        .map((f) => ({ source: f.source, shape: f.glslType === 'Spectrum' ? 'vec3' as const : 'float' as const }));
}

/** A batch's RAW rail payloads (LOCAL refs; channel writes add the ledger bases). */
export interface PackedInstanceBatch {
    /** Placement records in TLAS-leaf order: 8 floats (2 texels) per instance —
     *  texel 2i = q_inv, texel 2i+1 = (t_rigid = −Rᵀt, s) — the §6.1 placement ABI. */
    placements: Float32Array;
    /** TLAS node array (8 floats per node; LOCAL refs). */
    nodes: Float32Array;
    nodeCount: number;
    /** Attr records in the SAME leaf order (A texels per instance, slot order), if any. */
    attributes?: Float32Array;
}

/** Build a batch's payloads: a TLAS over the instance WORLD boxes (the prototype's local
 *  box under each placement), with placements AND attrs re-emitted by the SAME leaf
 *  permutation — Hit.element (the leaf-order placement index) indexes both correctly. */
export function packInstanceBatch(localBox: AABB, placements: Similarity[], attributeRows?: AttributeRowSpec[]): PackedInstanceBatch {
    const boxes = placements.map((g) => transformAABB(localBox, (p) => similarityApplyPoint(g, p)));
    const { nodes, nodeCount, order } = buildBVHNodes(boxes);
    const n = placements.length;
    const place = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
        const { q, ts } = rigidInverse(placements[order[i]]);
        place[i * 8 + 0] = q[0]; place[i * 8 + 1] = q[1]; place[i * 8 + 2] = q[2]; place[i * 8 + 3] = q[3];
        place[i * 8 + 4] = ts[0]; place[i * 8 + 5] = ts[1]; place[i * 8 + 6] = ts[2]; place[i * 8 + 7] = ts[3];
    }
    let attributes: Float32Array | undefined;
    if (attributeRows !== undefined && attributeRows.length > 0) {
        const A = attributeRows.length;
        attributes = new Float32Array(n * A * 4);
        for (let i = 0; i < n; i++) {
            for (let a = 0; a < A; a++) {
                const v = attributeRows[a].values[order[i]];
                const t = (i * A + a) * 4;
                if (typeof v === 'number') {
                    attributes[t + 0] = v;
                    // Scalar: float rows read .x; Spectrum rows broadcast (§2.5).
                    attributes[t + 1] = attributeRows[a].shape === 'vec3' ? v : 0;
                    attributes[t + 2] = attributeRows[a].shape === 'vec3' ? v : 0;
                } else {
                    attributes[t + 0] = v[0]; attributes[t + 1] = v[1]; attributes[t + 2] = v[2];
                }
            }
        }
    }
    return { placements: place, nodes, nodeCount, ...(attributes !== undefined ? { attributes } : {}) };
}
