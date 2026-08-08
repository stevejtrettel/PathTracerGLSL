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

import type { InstancedObject, ObjectDescription, PackedPlacements } from '../../../compiler/types.js';
import type { Similarity } from '../../geometry/similarity.js';
import { rigidInverse, quatNormalize, IDENTITY_QUAT } from '../../geometry/similarity.js';
import { buildBVHNodesFlat, type AABB } from '../../accel/bvh/bvh.js';
import { MATERIAL_MODELS } from '../../materials/index.js';

/** The scene's instanced batches in scene order — index IS the batch ordinal (see header). */
export function sceneInstanceBatches(objects: readonly ObjectDescription[]): InstancedObject[] {
    return objects.filter((o): o is InstancedObject => 'kind' in o && o.kind === 'instanced');
}

/** Discriminates the two placement forms (fable-instance-clouds §4; Transform[] is the array). */
export function isPackedPlacements(p: InstancedObject['placements']): p is PackedPlacements {
    return !Array.isArray(p);
}

/** Instance count of either placement form — the ONE count read (Planner, ledger, Validator, pack). */
export function placementCount(p: InstancedObject['placements']): number {
    return Array.isArray(p) ? p.length : p.count;
}

/** Instance `i` of a PACKED placement list as a Similarity (loop-local temporary — the
 *  packed arm never materializes a per-instance ARRAY of these). */
function packedSimilarity(p: PackedPlacements, i: number): Similarity {
    return {
        // Normalized like similarityFromTransform's raw-quat arm (f32-stored quats sit
        // ~1e-7 off unit) — the two placement forms must share one semantic.
        rotation: p.orientations !== undefined
            ? quatNormalize([p.orientations[4 * i], p.orientations[4 * i + 1], p.orientations[4 * i + 2], p.orientations[4 * i + 3]])
            : IDENTITY_QUAT,
        translation: [p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2]],
        scale: p.sizes !== undefined ? p.sizes[i] : 1,
    };
}

/** One attribute row's pack spec: the row shape + N authored entries (scene order;
 *  Spectrum rows accept scalar broadcast per entry). */
export interface AttributeRowSpec {
    shape: 'float' | 'vec3';
    /** Literal per-entry values, or the PACKED arm: Float32Array of length N (float rows)
     *  / 3N interleaved (vec3 rows) — fable-instance-clouds §4. */
    values: ReadonlyArray<number | [number, number, number]> | Float32Array;
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
 *  permutation — Hit.element (the leaf-order placement index) indexes both correctly.
 *  Accepts either placement form (fable-instance-clouds §5): Similarity[] (from authored
 *  Transform[]) or the packed struct-of-arrays; both feed the SAME box/record loop via a
 *  per-instance accessor, so the two arms cannot diverge. */
export function packInstanceBatch(localBox: AABB, placements: Similarity[] | PackedPlacements, attributeRows?: AttributeRowSpec[]): PackedInstanceBatch {
    const n = Array.isArray(placements) ? placements.length : placements.count;
    const sim = Array.isArray(placements)
        ? (i: number): Similarity => placements[i]
        : (i: number): Similarity => packedSimilarity(placements, i);
    // World boxes, FLAT (Aug 8 allocation-discipline rewrite — no per-instance AABB
    // objects or corner tuples at 1M instances). The corner transform below transcribes
    // quatRotate ∘ similarityApplyPoint op-for-op, and the packed arm normalizes its
    // quat like packedSimilarity — output is byte-identical to the old
    // transformAABB(similarityApplyPoint) path (the bvhFlat reference-twin gate).
    const boxes = new Float64Array(6 * n);
    const packed = Array.isArray(placements) ? undefined : placements;
    for (let i = 0; i < n; i++) {
        let qx = 0, qy = 0, qz = 0, qw = 1, s = 1, tx: number, ty: number, tz: number;
        if (packed === undefined) {
            const g = (placements as Similarity[])[i];
            qx = g.rotation[0]; qy = g.rotation[1]; qz = g.rotation[2]; qw = g.rotation[3];
            s = g.scale; tx = g.translation[0]; ty = g.translation[1]; tz = g.translation[2];
        } else {
            if (packed.orientations !== undefined) {
                const o = packed.orientations;
                const len = Math.hypot(o[4 * i], o[4 * i + 1], o[4 * i + 2], o[4 * i + 3]);
                qx = o[4 * i] / len; qy = o[4 * i + 1] / len; qz = o[4 * i + 2] / len; qw = o[4 * i + 3] / len;
            }
            if (packed.sizes !== undefined) s = packed.sizes[i];
            tx = packed.positions[3 * i]; ty = packed.positions[3 * i + 1]; tz = packed.positions[3 * i + 2];
        }
        let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        for (let c = 0; c < 8; c++) {
            const px = (c & 1) ? localBox.max[0] : localBox.min[0];
            const py = (c & 2) ? localBox.max[1] : localBox.min[1];
            const pz = (c & 4) ? localBox.max[2] : localBox.min[2];
            // quatRotate (v' = v + 2·qv × (qv × v + w·v), the no-trig expansion) then ·s + t.
            const rtx = 2 * (qy * pz - qz * py);
            const rty = 2 * (qz * px - qx * pz);
            const rtz = 2 * (qx * py - qy * px);
            const wx = (px + qw * rtx + qy * rtz - qz * rty) * s + tx;
            const wy = (py + qw * rty + qz * rtx - qx * rtz) * s + ty;
            const wz = (pz + qw * rtz + qx * rty - qy * rtx) * s + tz;
            if (wx < minx) minx = wx; if (wx > maxx) maxx = wx;
            if (wy < miny) miny = wy; if (wy > maxy) maxy = wy;
            if (wz < minz) minz = wz; if (wz > maxz) maxz = wz;
        }
        boxes[6 * i] = minx; boxes[6 * i + 1] = miny; boxes[6 * i + 2] = minz;
        boxes[6 * i + 3] = maxx; boxes[6 * i + 4] = maxy; boxes[6 * i + 5] = maxz;
    }
    const { nodes, nodeCount, order } = buildBVHNodesFlat(boxes, n);
    const place = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
        const { q, ts } = rigidInverse(sim(order[i]));
        place[i * 8 + 0] = q[0]; place[i * 8 + 1] = q[1]; place[i * 8 + 2] = q[2]; place[i * 8 + 3] = q[3];
        place[i * 8 + 4] = ts[0]; place[i * 8 + 5] = ts[1]; place[i * 8 + 6] = ts[2]; place[i * 8 + 7] = ts[3];
    }
    let attributes: Float32Array | undefined;
    if (attributeRows !== undefined && attributeRows.length > 0) {
        const A = attributeRows.length;
        attributes = new Float32Array(n * A * 4);
        for (let i = 0; i < n; i++) {
            for (let a = 0; a < A; a++) {
                const { values, shape } = attributeRows[a];
                const src = order[i];
                const t = (i * A + a) * 4;
                if (values instanceof Float32Array) {
                    // Packed arm: N floats or 3N interleaved (fable-instance-clouds §4).
                    if (shape === 'vec3') {
                        attributes[t + 0] = values[3 * src]; attributes[t + 1] = values[3 * src + 1]; attributes[t + 2] = values[3 * src + 2];
                    } else {
                        attributes[t + 0] = values[src];
                    }
                    continue;
                }
                const v = values[src];
                if (typeof v === 'number') {
                    attributes[t + 0] = v;
                    // Scalar: float rows read .x; Spectrum rows broadcast (§2.5).
                    attributes[t + 1] = shape === 'vec3' ? v : 0;
                    attributes[t + 2] = shape === 'vec3' ? v : 0;
                } else {
                    attributes[t + 0] = v[0]; attributes[t + 1] = v[1]; attributes[t + 2] = v[2];
                }
            }
        }
    }
    return { placements: place, nodes, nodeCount, ...(attributes !== undefined ? { attributes } : {}) };
}
