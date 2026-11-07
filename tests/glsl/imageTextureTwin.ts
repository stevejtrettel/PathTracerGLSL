// TS twin of src/glsl/shared/image_texture.glsl: one channel of an 8-bit image as a field on the
// uv chart. The conventions are pbrt-v4's (textures.cpp, util/image.h):
//   - t = 1 − v, so uv (0, 0) is the image's bottom-left corner (row 0 is the file's top row);
//   - texel centers at half-integers: x = s·W − ½, y = t·H − ½;
//   - each texel is decoded to linear BEFORE the bilinear blend;
//   - repeat wrap in both directions.

/** The sRGB transfer curve, code value c ∈ [0, 1] → linear. */
export function srgbDecode(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** One channel's 8-bit codes, rows from the top of the image file. */
export type CodeTable = readonly (readonly number[])[];

const wrap = (i: number, n: number) => (i < 0 ? i + n : i >= n ? i - n : i);

/** The decoded texel at column i, row j (both already wrapped into range). */
function texel(codes: CodeTable, i: number, j: number, srgb: boolean): number {
    const c = codes[j][i] / 255;
    return srgb ? srgbDecode(c) : c;
}

/** The field at (u, v): repeat-wrapped, decoded per texel, bilinear. */
export function imageTextureTwin(codes: CodeTable, u: number, v: number, srgb: boolean): number {
    const H = codes.length, W = codes[0].length;
    const s = u - Math.floor(u), t = 1 - (v - Math.floor(v));
    const x = s * W - 0.5, y = t * H - 0.5;
    const fx = Math.floor(x), fy = Math.floor(y);
    const dx = x - fx, dy = y - fy;
    const i0 = wrap(fx, W), i1 = wrap(fx + 1, W), j0 = wrap(fy, H), j1 = wrap(fy + 1, H);
    const top = (1 - dx) * texel(codes, i0, j0, srgb) + dx * texel(codes, i1, j0, srgb);
    const bottom = (1 - dx) * texel(codes, i0, j1, srgb) + dx * texel(codes, i1, j1, srgb);
    return (1 - dy) * top + dy * bottom;
}

/** A quarter of the uv square, named as it appears in the picture when u runs right and v up. */
export type Quadrant = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/**
 * The exact mean of the field over one quadrant of the uv square, for a 4 × 4 image. The field is
 * Σ T_ij · tent(x − i) · tent(y − j) with the tents wrapped, so its integral over a rectangle is
 * Σ T_ij a_i b_j, where a_i is the integral of column i's tent over the rectangle's x-range. A
 * half of the image spans two texel widths starting half a texel before a texel center, so its two
 * own columns get ⅞ each and the two others (one through the wrap) ⅛ each.
 */
export function quadrantMean(codes: CodeTable, quadrant: Quadrant, srgb: boolean): number {
    if (codes.length !== 4 || codes.some((row) => row.length !== 4)) throw new Error('quadrantMean: the image must be 4 × 4');
    const near = [7 / 8, 7 / 8, 1 / 8, 1 / 8], far = [1 / 8, 1 / 8, 7 / 8, 7 / 8];
    const a = quadrant.endsWith('left') ? near : far;
    // The picture's top half is v ∈ [½, 1], which is t ∈ [0, ½]: the file's first two rows.
    const b = quadrant.startsWith('top') ? near : far;
    let sum = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) sum += texel(codes, i, j, srgb) * a[i] * b[j];
    return sum / 4;   // the quadrant's area in texel units is 2 × 2
}
