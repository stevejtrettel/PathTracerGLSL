// Triangle-mesh engine — packer + shared contract (impl-plan-meshes).
// The GLSL leaf (mesh.glsl) is imported by the intersection feature; this file owns the
// TS side both the compiler and the app depend on:
//   - sceneMeshes(objects) — THE mesh-ordinal truth: the scene's meshes in scene order.
//     Planner (extern declaration) and App (upload) both iterate THIS list, so the
//     ordinal↔object assignment can never diverge (the audit's A5 replay hazard).
//   - meshExternNames(ordinal) — the extern texture names, keyed by mesh ordinal, so the
//     compiler's `extern:` sources and the app's registry names match by construction.
//   - packMesh(mesh) — a MeshObject's flat arrays → data-rail textures (RGBA32F
//     position/index/normal/uv + the BLAS node texture). App-side only.
// Encoding rides the data rail (components/data_textures.ts: DATA_TEX_WIDTH, packers);
// the BVH build + node format live in accel/bvh. Pure TS — compiler types imported
// type-only (components purity), so the mesh-kind predicate is restated locally
// (the similarity.ts/isDrivenTransform precedent).

import type { MeshObject, ObjectDescription } from '../../../compiler/types.js';
import { packVec3PerTexel, packVec2PerTexel, allocTexels, type PackedTexture } from '../../data_textures.js';
import { buildBVH, packNodes } from '../../accel/bvh/bvh.js';

/** The scene's meshes in scene order — index IS the mesh ordinal (see header). */
export function sceneMeshes(objects: readonly ObjectDescription[]): MeshObject[] {
    return objects.filter((o): o is MeshObject => 'kind' in o && o.kind === 'mesh');
}

/** Extern texture names for a mesh, keyed by its ordinal among the scene's meshes. */
export interface MeshExternNames {
    position: string;
    index: string;
    normal: string;
    uv: string;
    bvh: string;
}

export function meshExternNames(ordinal: number): MeshExternNames {
    return {
        position: `mesh_${ordinal}_position`,
        index: `mesh_${ordinal}_index`,
        normal: `mesh_${ordinal}_normal`,
        uv: `mesh_${ordinal}_uv`,
        bvh: `mesh_${ordinal}_bvh`,
    };
}

export interface PackedMesh {
    position: PackedTexture<Float32Array>;   // RGBA32F, xyz per vertex
    index: PackedTexture<Float32Array>;      // RGBA32F, ijk per triangle — in BVH-LEAF order (≤16M exact)
    /** The BVH-leaf-order triangle index as raw ints — the mesh-light CDF packer reads it
     *  so the CDF and the index texture agree by construction (fable-mesh-lights). */
    reindexedTriangles: Uint32Array;
    normal: PackedTexture<Float32Array>;     // RGBA32F, xyz per vertex (zeros when unauthored)
    uv: PackedTexture<Float32Array>;         // RGBA32F, xy per vertex (zeros when unauthored)
    bvh: PackedTexture<Float32Array>;        // RGBA32F, 2 texels per node (accel/bvh node format)
    /** The BLAS root box — the mesh's local AABB, used as the prototype box when instanced. */
    rootBox: { min: [number, number, number]; max: [number, number, number] };
}

/** Pack triangle indices (length 3·T) into an RGBA32F texel grid (w = 0). Indices are ≤ 16M,
 *  exactly representable in f32 — so the index texture stays float (no usampler2D). */
function packIndex(indices: Uint32Array, triCount: number): PackedTexture<Float32Array> {
    const tex = allocTexels(triCount);
    for (let i = 0; i < triCount; i++) {
        tex.data[i * 4 + 0] = indices[i * 3 + 0];
        tex.data[i * 4 + 1] = indices[i * 3 + 1];
        tex.data[i * 4 + 2] = indices[i * 3 + 2];
    }
    return tex;
}

/** Turn a MeshObject's flat arrays into the five padded data textures the engine uploads.
 *  Normals/UVs are always emitted (zero-filled when unauthored — the leaf reads them only
 *  when the mesh is smooth / a uv reader exists; useSmooth is a compile-time fact). */
export function packMesh(mesh: MeshObject): PackedMesh {
    const vertexCount = mesh.positions.length / 3;
    // Build the BVH always (cheap for these sizes): its reordered triangle index becomes the index
    // texture — brute force scans it whole (order-independent), the BVH walk indexes leaf ranges
    // into it. So one index texture serves both traversals; only the node texture is BVH-specific.
    const bvh = buildBVH(mesh.positions, mesh.indices);
    return {
        position: packVec3PerTexel(mesh.positions, vertexCount),
        index: packIndex(bvh.reindexedTriangles, bvh.reindexedTriangles.length / 3),
        reindexedTriangles: bvh.reindexedTriangles,
        normal: packVec3PerTexel(mesh.normals, vertexCount),
        uv: packVec2PerTexel(mesh.uvs, vertexCount),
        bvh: packNodes(bvh.nodes, bvh.nodeCount),
        rootBox: bvh.rootBox,
    };
}
