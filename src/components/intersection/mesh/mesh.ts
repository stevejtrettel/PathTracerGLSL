// Triangle-mesh engine — packer + shared contract (impl-plan-meshes).
// The GLSL leaf (mesh.glsl) is imported by the intersection feature; this file owns the
// TS side both the compiler and the app depend on:
//   - MESH_TEX_WIDTH — the ONE fixed data-texture width (compiler emits the #define; app packs
//     at it) so index→texel math agrees on both sides.
//   - meshExternNames(ordinal) — the extern texture names, keyed by MESH ORDINAL (position among
//     meshes in scene order), so the compiler's `extern:` sources and the app's registry names
//     match without either replaying the other's index assignment.
//   - packMesh(mesh) — turns a MeshObject's flat arrays into the padded typed arrays the engine's
//     texture factories upload (RGBA32F position/normal/uv, RGBA32UI index). App-side only.
// Pure TS — no imports from app/engine/compiler (components purity).

import type { MeshObject } from '../../../compiler/types.js';
import { buildBVH } from './bvh.js';

/** Fixed width for every mesh data texture (row-major linear layout). 2048² texels ≈ 4M
 *  vertices/triangles per texture — ample for v0; a knob, not a structural gate. */
export const MESH_TEX_WIDTH = 2048;

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

/** One packed data texture ready for a WebGL2 float/uint texture upload. */
export interface PackedTexture<T extends Float32Array | Uint32Array> {
    data: T;
    width: number;
    height: number;
}

export interface PackedMesh {
    position: PackedTexture<Float32Array>;   // RGBA32F, xyz per vertex
    index: PackedTexture<Float32Array>;      // RGBA32F, ijk per triangle — in BVH-LEAF order (≤16M exact)
    normal: PackedTexture<Float32Array>;     // RGBA32F, xyz per vertex (zeros when unauthored)
    uv: PackedTexture<Float32Array>;         // RGBA32F, xy per vertex (zeros when unauthored)
    bvh: PackedTexture<Float32Array>;        // RGBA32F, 2 texels per node (impl-plan-mesh-bvh §3)
    /** The BLAS root box — the mesh's local AABB, used as the prototype box when instanced. */
    rootBox: { min: [number, number, number]; max: [number, number, number] };
}

function ceilDiv(a: number, b: number): number { return Math.ceil(a / b); }

/** Pack a vec3-per-item source (length 3·N) into an RGBA32F texel grid (w = 0). */
function packVec3ToRGBA(src: Float32Array | undefined, count: number): PackedTexture<Float32Array> {
    const w = MESH_TEX_WIDTH;
    const h = Math.max(1, ceilDiv(count, w));
    const data = new Float32Array(w * h * 4);   // zero-filled default (safe when unread)
    if (src !== undefined) {
        for (let i = 0; i < count; i++) {
            data[i * 4 + 0] = src[i * 3 + 0];
            data[i * 4 + 1] = src[i * 3 + 1];
            data[i * 4 + 2] = src[i * 3 + 2];
        }
    }
    return { data, width: w, height: h };
}

/** Pack a vec2-per-item source (length 2·N) into an RGBA32F texel grid (zw = 0). */
function packVec2ToRGBA(src: Float32Array | undefined, count: number): PackedTexture<Float32Array> {
    const w = MESH_TEX_WIDTH;
    const h = Math.max(1, ceilDiv(count, w));
    const data = new Float32Array(w * h * 4);
    if (src !== undefined) {
        for (let i = 0; i < count; i++) {
            data[i * 4 + 0] = src[i * 2 + 0];
            data[i * 4 + 1] = src[i * 2 + 1];
        }
    }
    return { data, width: w, height: h };
}

/** Pack triangle indices (length 3·T) into an RGBA32F texel grid (w = 0). Indices are ≤ 16M,
 *  exactly representable in f32 — so the index texture stays float (no usampler2D). */
function packIndex(indices: Uint32Array, triCount: number): PackedTexture<Float32Array> {
    const w = MESH_TEX_WIDTH;
    const h = Math.max(1, ceilDiv(triCount, w));
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < triCount; i++) {
        data[i * 4 + 0] = indices[i * 3 + 0];
        data[i * 4 + 1] = indices[i * 3 + 1];
        data[i * 4 + 2] = indices[i * 3 + 2];
    }
    return { data, width: w, height: h };
}

/** Pack the flat BVH node array (8 floats = 2 RGBA32F texels per node) into a texel grid. The node
 *  array is already texel-contiguous, so it copies straight in (padded to the grid). Shared by the
 *  BLAS (mesh) and the TLAS (instancing) — same node format. */
export function packNodes(nodes: Float32Array, nodeCount: number): PackedTexture<Float32Array> {
    const texels = Math.max(1, nodeCount * 2);
    const w = MESH_TEX_WIDTH;
    const h = Math.max(1, ceilDiv(texels, w));
    const data = new Float32Array(w * h * 4);
    data.set(nodes.subarray(0, nodeCount * 8));
    return { data, width: w, height: h };
}

/** Turn a MeshObject's flat arrays into the four padded data textures the engine uploads.
 *  Normals/UVs are always emitted (zero-filled when unauthored — the leaf reads them only
 *  when the mesh is smooth / a uv reader exists; useSmooth is a compile-time fact). */
export function packMesh(mesh: MeshObject): PackedMesh {
    const vertexCount = mesh.positions.length / 3;
    // Build the BVH always (cheap for these sizes): its reordered triangle index becomes the index
    // texture — brute force scans it whole (order-independent), the BVH walk indexes leaf ranges
    // into it. So one index texture serves both traversals; only the node texture is BVH-specific.
    const bvh = buildBVH(mesh.positions, mesh.indices);
    return {
        position: packVec3ToRGBA(mesh.positions, vertexCount),
        index: packIndex(bvh.reindexedTriangles, bvh.reindexedTriangles.length / 3),
        normal: packVec3ToRGBA(mesh.normals, vertexCount),
        uv: packVec2ToRGBA(mesh.uvs, vertexCount),
        bvh: packNodes(bvh.nodes, bvh.nodeCount),
        rootBox: bvh.rootBox,
    };
}
