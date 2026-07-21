// Triangle-mesh engine — packer + shared contract (impl-plan-meshes; rail v2 per
// fable-data-rail). The GLSL leaf (mesh.glsl) is imported by the intersection feature;
// this file owns the TS side both the compiler and the app depend on:
//   - sceneMeshes(objects) — THE mesh-ordinal truth: the scene's meshes in scene order.
//     Planner and App both iterate THIS list (the A5 pattern); the LEDGER
//     (components/data — via the dataTenantsOf adapter) assigns where each mesh's bytes
//     live in the shared channels.
//   - packMesh(mesh) — a MeshObject's flat arrays → RAW payloads (BVH-built, leaf-order
//     index) that the App writes into the channels at the mesh's ledger slot. The rail
//     owns encoding; this packer owns what mesh bytes MEAN.
// Pure TS — compiler types imported type-only (components purity), so the mesh-kind
// predicate is restated locally (the similarity.ts/isDrivenTransform precedent).

import type { MeshObject, ObjectDescription } from '../../../compiler/types.js';
import { buildBVH } from '../../accel/bvh/bvh.js';

/** The scene's meshes in scene order — index IS the mesh ordinal (see header). */
export function sceneMeshes(objects: readonly ObjectDescription[]): MeshObject[] {
    return objects.filter((o): o is MeshObject => 'kind' in o && o.kind === 'mesh');
}

/** A mesh's RAW rail payloads (rail v2): tenant-LOCAL ids throughout — the channel
 *  writes add the ledger bases. */
export interface PackedMesh {
    vertexCount: number;
    triCount: number;
    /** BVH-leaf-order triangle index (LOCAL vertex ids, length 3·T) — the index channel's
     *  payload AND the order truth the mesh-light CDF packer follows. */
    reindexedTriangles: Uint32Array;
    /** Flat BVH node array (8 floats per node; LOCAL leaf/child refs). */
    nodes: Float32Array;
    nodeCount: number;
    /** The BLAS root box — the mesh's local AABB (prototype box when instanced). */
    rootBox: { min: [number, number, number]; max: [number, number, number] };
}

/** Build the mesh's BVH + leaf-order index (positions/normals/uvs ride the MeshObject
 *  itself — the App writes them into the vertex channels directly). The BVH is built
 *  ALWAYS (cheap at these sizes): brute traversal scans the reordered index whole
 *  (order-independent); the walk indexes leaf ranges into it — one index, both engines. */
export function packMesh(mesh: MeshObject): PackedMesh {
    const bvh = buildBVH(mesh.positions, mesh.indices);
    return {
        vertexCount: mesh.positions.length / 3,
        triCount: bvh.reindexedTriangles.length / 3,
        reindexedTriangles: bvh.reindexedTriangles,
        nodes: bvh.nodes,
        nodeCount: bvh.nodeCount,
        rootBox: bvh.rootBox,
    };
}
