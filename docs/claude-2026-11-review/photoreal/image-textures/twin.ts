// TS twin of the planned GLSL image_texture(): pbrt-v4 conventions — t = 1 - v
// (textures.cpp:367), texel centers at +0.5 (image.h:281), decode each texel to linear
// BEFORE bilinear blending (image.h:263 GetChannel → ToLinear), repeat wrap.
// Checks the witness's derived values by brute-force integration of the field.
const srgbDecode = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // pbrt color.h:526
const W = 4, H = 4;
// Byte codes, row 0 = TOP row of the image file (as uploaded, no flip).
const codes = [
    [255, 200, 160, 230],
    [128, 64, 192, 96],
    [32, 0, 16, 48],
    [8, 80, 24, 40],
];
const wrap = (i: number, n: number) => ((i % n) + n) % n;
function lookup(u: number, v: number, decodeFirst: boolean): number {
    const fu = u - Math.floor(u), fv = v - Math.floor(v);          // repeat
    const x = fu * W - 0.5, y = (1 - fv) * H - 0.5;                 // t = 1 - v
    const xi = Math.floor(x), yi = Math.floor(y), dx = x - xi, dy = y - yi;
    const T = (i: number, j: number) => {
        const k = codes[wrap(j, H)][wrap(i, W)] / 255;
        return decodeFirst ? srgbDecode(k) : k;
    };
    const val = (1 - dx) * (1 - dy) * T(xi, yi) + dx * (1 - dy) * T(xi + 1, yi)
        + (1 - dx) * dy * T(xi, yi + 1) + dx * dy * T(xi + 1, yi + 1);
    return decodeFirst ? val : srgbDecode(val);
}
// Midpoint integration over a uv rectangle (N² samples; field is piecewise bilinear, so the
// midpoint rule on a grid aligned to texel quarters is exact up to fp — N multiple of 4·W).
function integrate(u0: number, u1: number, v0: number, v1: number, decodeFirst: boolean, N = 1024): number {
    let s = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        s += lookup(u0 + (u1 - u0) * (a + 0.5) / N, v0 + (v1 - v0) * (b + 0.5) / N, decodeFirst);
    }
    return s / (N * N);
}
const dec = codes.map((r) => r.map((k) => srgbDecode(k / 255)));
const rowMean = dec.map((r) => r.reduce((x, y) => x + y, 0) / W);
const texelMean = rowMean.reduce((x, y) => x + y, 0) / H;
// Top half of the picture = v ∈ [0.5, 1] = t ∈ [0, 0.5] = image rows y ∈ [0, 2]:
// tents of rows 0,1 contribute 7/8, rows 2,3 (row 3 via the wrap) contribute 1/8 each.
const topExact = ((7 / 8) * (rowMean[0] + rowMean[1]) + (1 / 8) * (rowMean[2] + rowMean[3])) / 2;
const botExact = ((7 / 8) * (rowMean[2] + rowMean[3]) + (1 / 8) * (rowMean[0] + rowMean[1])) / 2;
const out = {
    texelMean,
    fullIntegral: integrate(0, 1, 0, 1, true),
    wrongOrderFull: integrate(0, 1, 0, 1, false),
    topExact, topIntegral: integrate(0, 1, 0.5, 1, true),
    botExact, botIntegral: integrate(0, 1, 0, 0.5, true),
    // A v-flipped implementation would swap top and bottom.
    seamContinuity: Math.abs(lookup(0, 0.3, true) - lookup(1 - 1e-9, 0.3, true)),
    centerExact: Math.abs(lookup((2 + 0.5) / W, 1 - (1 + 0.5) / H, true) - dec[1][2]),
};
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(16), v.toFixed(7));
