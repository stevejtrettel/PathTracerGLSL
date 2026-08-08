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

/** Instance `i` of either placement form as flat scalars on a reused scratch — the ONE
 *  decode (Aug 8 allocation discipline, extended to every per-instance read): the box
 *  loop AND the record loop both call this, so the two reads cannot drift and neither
 *  allocates per instance. The packed arm normalizes its quat exactly like
 *  similarityFromTransform's raw-quat arm (f32-stored quats sit ~1e-7 off unit) — the
 *  two placement forms share one semantic (the instancingPacked byte gate). */
interface DecodedPlacement { qx: number; qy: number; qz: number; qw: number; s: number; tx: number; ty: number; tz: number; }

function decodePlacement(placements: Similarity[] | PackedPlacements, i: number, out: DecodedPlacement): void {
    if (Array.isArray(placements)) {
        const g = placements[i];
        out.qx = g.rotation[0]; out.qy = g.rotation[1]; out.qz = g.rotation[2]; out.qw = g.rotation[3];
        out.s = g.scale;
        out.tx = g.translation[0]; out.ty = g.translation[1]; out.tz = g.translation[2];
        return;
    }
    if (placements.orientations !== undefined) {
        const o = placements.orientations;
        const len = Math.hypot(o[4 * i], o[4 * i + 1], o[4 * i + 2], o[4 * i + 3]);
        out.qx = o[4 * i] / len; out.qy = o[4 * i + 1] / len; out.qz = o[4 * i + 2] / len; out.qw = o[4 * i + 3] / len;
    } else {
        out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
    }
    out.s = placements.sizes !== undefined ? placements.sizes[i] : 1;
    out.tx = placements.positions[3 * i]; out.ty = placements.positions[3 * i + 1]; out.tz = placements.positions[3 * i + 2];
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
    const d: DecodedPlacement = { qx: 0, qy: 0, qz: 0, qw: 1, s: 1, tx: 0, ty: 0, tz: 0 };
    // World boxes, FLAT (Aug 8 allocation-discipline rewrite — no per-instance AABB
    // objects or corner tuples at 1M instances). The corner transform below transcribes
    // quatRotate ∘ similarityApplyPoint op-for-op — output is byte-identical to the old
    // transformAABB(similarityApplyPoint) path (the bvhFlat reference-twin gate).
    const boxes = new Float64Array(6 * n);
    for (let i = 0; i < n; i++) {
        decodePlacement(placements, i, d);
        let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        for (let c = 0; c < 8; c++) {
            const px = (c & 1) ? localBox.max[0] : localBox.min[0];
            const py = (c & 2) ? localBox.max[1] : localBox.min[1];
            const pz = (c & 4) ? localBox.max[2] : localBox.min[2];
            // quatRotate (v' = v + 2·qv × (qv × v + w·v), the no-trig expansion) then ·s + t.
            const rtx = 2 * (d.qy * pz - d.qz * py);
            const rty = 2 * (d.qz * px - d.qx * pz);
            const rtz = 2 * (d.qx * py - d.qy * px);
            const wx = (px + d.qw * rtx + d.qy * rtz - d.qz * rty) * d.s + d.tx;
            const wy = (py + d.qw * rty + d.qz * rtx - d.qx * rtz) * d.s + d.ty;
            const wz = (pz + d.qw * rtz + d.qx * rty - d.qy * rtx) * d.s + d.tz;
            if (wx < minx) minx = wx; if (wx > maxx) maxx = wx;
            if (wy < miny) miny = wy; if (wy > maxy) maxy = wy;
            if (wz < minz) minz = wz; if (wz > maxz) maxz = wz;
        }
        boxes[6 * i] = minx; boxes[6 * i + 1] = miny; boxes[6 * i + 2] = minz;
        boxes[6 * i + 3] = maxx; boxes[6 * i + 4] = maxy; boxes[6 * i + 5] = maxz;
    }
    const { nodes, nodeCount, order } = buildBVHNodesFlat(boxes, n);
    // Placement records, FLAT: rigidInverse transcribed op-for-op (similarity.ts —
    // q_inv = conjugate, t_rigid = −(q_inv rotating t) via the same no-trig expansion),
    // so the stored f32 values are byte-identical to the old rigidInverse(sim(...))
    // path without its ~4 allocations per instance.
    const place = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
        decodePlacement(placements, order[i], d);
        const cx = -d.qx, cy = -d.qy, cz = -d.qz, cw = d.qw;
        const rx = 2 * (cy * d.tz - cz * d.ty);
        const ry = 2 * (cz * d.tx - cx * d.tz);
        const rz = 2 * (cx * d.ty - cy * d.tx);
        place[i * 8 + 0] = cx; place[i * 8 + 1] = cy; place[i * 8 + 2] = cz; place[i * 8 + 3] = cw;
        place[i * 8 + 4] = -(d.tx + cw * rx + cy * rz - cz * ry);
        place[i * 8 + 5] = -(d.ty + cw * ry + cz * rx - cx * rz);
        place[i * 8 + 6] = -(d.tz + cw * rz + cx * ry - cy * rx);
        place[i * 8 + 7] = d.s;
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
