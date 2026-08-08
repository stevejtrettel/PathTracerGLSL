// components/data/pack.ts — channel assembly + grid packers (rail v2, fable-data-rail).
// Absorbs components/data_textures.ts (rail v1). The WRITE side of the ledger: allocate a
// channel at its ledger total, write each tenant's payload at its region base. All
// channels are RGBA32F at the fixed DATA_TEX_WIDTH; the GLSL side addresses via
// data_texel1d (glsl/core/data_texture.glsl) — the ONE width both sides share.
// Pure TS, no imports (components purity).

/** Fixed width for every data channel (row-major linear layout). A knob, not a
 *  structural gate — bumped 2048 → 4096 on Aug 7 2026 when the 1.4M-instance octic
 *  cloud tripped the Validator's nodes-channel ceiling (the declared trigger,
 *  fable-instance-clouds §8). 4096² texels ≈ 16.7M per channel → ~4M instances/batch. */
export const DATA_TEX_WIDTH = 4096;

/** One packed channel ready for a WebGL2 RGBA32F upload. */
export interface PackedChannel {
    data: Float32Array;
    width: number;
    height: number;
}

/** Allocate a zero-filled channel holding at least `texelCount` texels (zero-fill = safe
 *  default for padding and unauthored regions). */
export function allocChannel(texelCount: number): PackedChannel {
    const w = DATA_TEX_WIDTH;
    const h = Math.max(1, Math.ceil(Math.max(1, texelCount) / w));
    return { data: new Float32Array(w * h * 4), width: w, height: h };
}

/** Write raw texel floats (length 4·n) at a base texel. */
export function writeTexels(ch: PackedChannel, baseTexel: number, floats: Float32Array | number[]): void {
    ch.data.set(floats, baseTexel * 4);
}

/** Write a vec3-per-item payload (length 3·count) at a base texel (w = 0). */
export function writeVec3s(ch: PackedChannel, baseTexel: number, src: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
        const t = (baseTexel + i) * 4;
        ch.data[t] = src[i * 3]; ch.data[t + 1] = src[i * 3 + 1]; ch.data[t + 2] = src[i * 3 + 2];
    }
}

/** Write a vec2-per-item payload (length 2·count) at a base texel (zw = 0). */
export function writeVec2s(ch: PackedChannel, baseTexel: number, src: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
        const t = (baseTexel + i) * 4;
        ch.data[t] = src[i * 2]; ch.data[t + 1] = src[i * 2 + 1];
    }
}

/** Write one scalar per texel (.x; yzw = 0) at a base texel — CDF tables. */
export function writeScalars(ch: PackedChannel, baseTexel: number, src: Float32Array | Float64Array, count: number): void {
    for (let i = 0; i < count; i++) ch.data[(baseTexel + i) * 4] = src[i];
}

/** Write uvec3-per-item ids as exact floats (≤16M — no usampler2D) at a base texel.
 *  `.w` stays 0 — RESERVED as the per-triangle material-group slot (fable-data-rail §3). */
export function writeUvec3s(ch: PackedChannel, baseTexel: number, src: Uint32Array, count: number): void {
    for (let i = 0; i < count; i++) {
        const t = (baseTexel + i) * 4;
        ch.data[t] = src[i * 3]; ch.data[t + 1] = src[i * 3 + 1]; ch.data[t + 2] = src[i * 3 + 2];
    }
}
