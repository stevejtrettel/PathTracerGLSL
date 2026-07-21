// Mesh area-light descriptor + packers (fable-mesh-lights) — the lights family's first
// DATA-DRIVEN kind. NOT authored directly: the ONE route is the sampleAsLight material on
// a mesh OBJECT (the §6.2 inverse route, like emissive analytic quads/spheres) — the
// Planner builds the values itself (no folded primitive params exist for a mesh), so this
// descriptor carries no region/valuesFromRegion pair.
//
// Precompute-and-ship (the house rule): the sampler reads WORLD-space vertex positions
// from a dedicated texture (packed CPU-side under the CONSTANT placement — the §6 pin),
// so the shader does ZERO placement math and the struct carries no transform rows. The
// CDF is normalized cumulative WORLD triangle area, one texel per triangle, in the
// BVH-REORDERED triangle order (the index texture's order — one order truth).

import type { LightKindDescriptor } from '../../descriptors.js';
import type { MeshObject } from '../../../compiler/types.js';
import type { Similarity } from '../../geometry/similarity.js';
import { similarityApplyPoint } from '../../geometry/similarity.js';
import { allocTexels, type PackedTexture } from '../../data_textures.js';
import { radiantScalar } from '../power.js';
import lightMeshGLSL from './mesh.glsl?raw';

export const meshLightDescriptor: LightKindDescriptor = {
    kind: 'mesh',
    glsl: lightMeshGLSL,
    delta: false,
    // No authored route: a `{ kind: 'mesh' }` light record is always rejected — author an
    // emissive mesh OBJECT instead (validateAuthored fires on any well-shaped attempt).
    authoredParams: [],
    params: [
        { name: 'radiance', shape: 'vec3', semantic: 'radiometric' },        // Le
        { name: 'area', shape: 'number', semantic: 'geometric', kind: 'area' },   // WORLD total (s²-folded)
        // triCount is NOT a row: it is CDF-walk plumbing, baked as a literal sampler arg
        // (PlannedLight.mesh.triCount) — rows are the light's physical vocabulary.
    ],
    // pbrt PowerLightSampler, one-sided: π·A_total·Le (the quad formula, summed area).
    power(v) {
        return Math.max(1e-8, Math.PI * (v.area as number) * radiantScalar(v.radiance as number[]));
    },
    toValues: () => {
        throw new Error("mesh lights are not authored directly (unreachable: validateAuthored rejects '{ kind: 'mesh' }')");
    },
    validateAuthored: () => [
        "mesh lights are not authored as light records — set `sampleAsLight` (or leave it on) on an emissive material used by a mesh OBJECT (fable-mesh-lights §1)",
    ],
};

/** Extern names for a mesh light's textures, keyed by the backing MESH ordinal (the
 *  index texture is the intersection feature's, reused by name — merge dedups). */
export function meshLightExternNames(meshOrdinal: number): { lightpos: string; lightcdf: string } {
    return {
        lightpos: `mesh_${meshOrdinal}_lightpos`,
        lightcdf: `mesh_${meshOrdinal}_lightcdf`,
    };
}

/** WORLD total surface area under a constant similarity: local Σ|cross|/2 × s² (rotation
 *  and translation are area-preserving; uniform scale is exactly s²). The ONE constant the
 *  identity-free pdf and the power formula read — Planner-baked. */
export function meshWorldArea(positions: Float32Array, indices: Uint32Array, scale: number): number {
    let local = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
        const ux = positions[ib] - positions[ia], uy = positions[ib + 1] - positions[ia + 1], uz = positions[ib + 2] - positions[ia + 2];
        const vx = positions[ic] - positions[ia], vy = positions[ic + 1] - positions[ia + 1], vz = positions[ic + 2] - positions[ia + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        local += Math.hypot(cx, cy, cz) / 2;
    }
    return local * scale * scale;
}

/** Pack a mesh light's two rail textures: WORLD vertex positions (one texel per vertex)
 *  and the normalized cumulative WORLD-area CDF over the REORDERED triangles (one texel
 *  per triangle — `reindexed` is packMesh's BVH-leaf-order index, so the CDF and the
 *  shared index texture agree by construction). */
export function packMeshLight(mesh: MeshObject, placement: Similarity, reindexed: Uint32Array): { lightpos: PackedTexture<Float32Array>; lightcdf: PackedTexture<Float32Array> } {
    const vertexCount = mesh.positions.length / 3;
    const lightpos = allocTexels(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        const w = similarityApplyPoint(placement, [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]);
        lightpos.data[i * 4 + 0] = w[0]; lightpos.data[i * 4 + 1] = w[1]; lightpos.data[i * 4 + 2] = w[2];
    }
    const T = reindexed.length / 3;
    const lightcdf = allocTexels(T);
    let acc = 0;
    const areas = new Float64Array(T);
    for (let t = 0; t < T; t++) {
        // World areas from the PACKED world positions (exactly what the sampler fetches).
        const ax = lightpos.data[(reindexed[t * 3]) * 4], ay = lightpos.data[(reindexed[t * 3]) * 4 + 1], az = lightpos.data[(reindexed[t * 3]) * 4 + 2];
        const bx = lightpos.data[(reindexed[t * 3 + 1]) * 4], by = lightpos.data[(reindexed[t * 3 + 1]) * 4 + 1], bz = lightpos.data[(reindexed[t * 3 + 1]) * 4 + 2];
        const cx = lightpos.data[(reindexed[t * 3 + 2]) * 4], cy = lightpos.data[(reindexed[t * 3 + 2]) * 4 + 1], cz = lightpos.data[(reindexed[t * 3 + 2]) * 4 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        areas[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        acc += areas[t];
    }
    let run = 0;
    for (let t = 0; t < T; t++) {
        run += areas[t];
        lightcdf.data[t * 4] = acc > 0 ? run / acc : (t + 1) / T;
    }
    if (T > 0) lightcdf.data[(T - 1) * 4] = 1.0;   // exact closure (fp sum drift)
    return { lightpos, lightcdf };
}
