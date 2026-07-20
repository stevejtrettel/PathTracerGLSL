// components/data_textures.ts — the DATA-TEXTURE RAIL (audit batch 3).
//
// Large read-only GPU data rides RGBA32F textures addressed by texelFetch (WebGL2 has
// no SSBO and a 16KB UBO cap — see memory data-textures-webgl2). This file is the ONE
// encoding truth both sides of the rail share: the app packs at DATA_TEX_WIDTH, the
// compiler emits the matching `#define DATA_TEX_WIDTH` consumed by data_texel1d
// (glsl/core/data_texture.glsl) — so index→texel math can never disagree.
//
// Current tenants: mesh geometry (intersection/mesh), instance placements
// (intersection/instancing), BVH node textures (accel/bvh). Future tenants: Stage B's
// analytic-params tables, light-BVH nodes, majorant grids — anything array-shaped.
// This is the GPU-encoding sibling of glsl-format.ts (one formats numbers into
// source; this packs arrays into textures). Pure TS, no imports (components purity).

/** Fixed width for every data texture (row-major linear layout). 2048² texels ≈ 4M
 *  items per texture — ample; a knob, not a structural gate. */
export const DATA_TEX_WIDTH = 2048;

/** One packed data texture ready for a WebGL2 float/uint texture upload. */
export interface PackedTexture<T extends Float32Array | Uint32Array> {
    data: T;
    width: number;
    height: number;
}

/** Allocate a zero-filled RGBA32F texel grid holding at least `texelCount` texels
 *  (zero-fill = safe default for unread padding/unauthored channels). */
export function allocTexels(texelCount: number): PackedTexture<Float32Array> {
    const w = DATA_TEX_WIDTH;
    const h = Math.max(1, Math.ceil(Math.max(1, texelCount) / w));
    return { data: new Float32Array(w * h * 4), width: w, height: h };
}

/** Pack a vec3-per-item source (length 3·N) into an RGBA32F grid, one texel per item
 *  (w = 0). `src` undefined → zeros (safe when unread). */
export function packVec3PerTexel(src: Float32Array | undefined, count: number): PackedTexture<Float32Array> {
    const tex = allocTexels(count);
    if (src !== undefined) {
        for (let i = 0; i < count; i++) {
            tex.data[i * 4 + 0] = src[i * 3 + 0];
            tex.data[i * 4 + 1] = src[i * 3 + 1];
            tex.data[i * 4 + 2] = src[i * 3 + 2];
        }
    }
    return tex;
}

/** Pack a vec2-per-item source (length 2·N) into an RGBA32F grid (zw = 0). */
export function packVec2PerTexel(src: Float32Array | undefined, count: number): PackedTexture<Float32Array> {
    const tex = allocTexels(count);
    if (src !== undefined) {
        for (let i = 0; i < count; i++) {
            tex.data[i * 4 + 0] = src[i * 2 + 0];
            tex.data[i * 4 + 1] = src[i * 2 + 1];
        }
    }
    return tex;
}

/** Pack an already texel-contiguous float record stream (4 floats per texel) into a
 *  grid — a straight copy, padded. For multi-texel records (BVH nodes = 2 texels,
 *  placements = 2 texels), `texelCount` is records × texels-per-record. */
export function packFloatTexels(flat: Float32Array, texelCount: number): PackedTexture<Float32Array> {
    const tex = allocTexels(texelCount);
    tex.data.set(flat.subarray(0, Math.min(flat.length, texelCount * 4)));
    return tex;
}
