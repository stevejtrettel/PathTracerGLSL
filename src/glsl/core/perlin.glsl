// Perlin's improved gradient noise (Perlin 2002), with fBm and turbulence: a transcription of
// pbrt-v4 src/pbrt/util/noise.cpp (Noise, FBm, Turbulence), for GLSL-expression material rows.
// Included when some material row is a GLSL expression; it is plain functions of a point in R³
// and reads nothing else.
// Provides: perlin_noise(), perlin_fbm(), perlin_turbulence().
// The TS twin tests/glsl/perlinTwin.ts is its tested ground truth (it reproduces pbrt's
// compiled fp32 values exactly); change one, change both.
//
// noise(x) is the trilinear blend, with quintic weights w(t) = 6t⁵ − 15t⁴ + 10t³, of the 8
// corner terms g·(x − c), where c is a corner of the unit lattice cell containing x and g one
// of 12 cube-edge gradients picked by hashing c through the 256-entry permutation below.
//   - noise = 0 at every lattice point; it is C² (the quintic weights).
//   - |noise| ≤ 2: each corner term is ±u ± v with |u|, |v| ≤ 1, and the weights are convex.
//     Sampled values stay within about ±1 (rms ≈ 0.27).
//   - Period 256 in each coordinate.
// fbm(x, ω, n) = Σ_{i<n} ωⁱ noise(1.99ⁱ x), so |fbm| ≤ 2 Σ_{i<n} ωⁱ. The factor 1.99 (not 2)
// keeps the octave lattices from aligning.
// turbulence(x, ω, n) = Σ_{i<n} ωⁱ |noise(1.99ⁱ x)| + 0.2 ωⁿ, in [0, 2 Σ_{i<n} ωⁱ + 0.2 ωⁿ].
// These are pbrt's FBm and Turbulence at zero ray-differential footprint, where pbrt sums every
// requested octave and Turbulence adds 0.2 ωⁿ as the average of the octaves it leaves out.
// There is no footprint-based octave limit here: the octave count is part of the authored
// scene, and pixel sampling converges to the pixel's average of exactly that texture.
//
// Nothing clamps the result. A formula must keep its own row in its domain (a reflectance in
// [0, 1]), which the bounds above make checkable by hand.
// Domain: the lattice index is exact for |x| < 2²⁴; above about 10⁴, fp32 leaves few bits for
// the offset inside a cell and the noise coarsens.

// pbrt's NoisePerm (whose 512 entries are this table twice), indexed mod 256.
const int PERLIN_PERM[256] = int[256](
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
    140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
    247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
    57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
    74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
    60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
    65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
    200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
    52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
    207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
    119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
    129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
    218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
    81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
    184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
    222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180
);

// The corner term g·(dx, dy, dz) for lattice corner (x, y, z), each in [0, 256]:
// h = perm(perm(perm(x) + y) + z) mod 16 picks g, a cube-edge direction (4 of the 16 repeat).
float perlin_grad(int x, int y, int z, float dx, float dy, float dz) {
    int h = PERLIN_PERM[(PERLIN_PERM[(PERLIN_PERM[x & 255] + y) & 255] + z) & 255] & 15;
    float u = (h < 8 || h == 12 || h == 13) ? dx : dy;
    float v = (h < 4 || h == 12 || h == 13) ? dy : dz;
    return ((h & 1) != 0 ? -u : u) + ((h & 2) != 0 ? -v : v);
}

// 6t⁵ − 15t⁴ + 10t³: zero first and second derivatives at t = 0 and t = 1.
float perlin_weight(float t) {
    float t2 = t * t;
    float t4 = t2 * t2;
    return 6.0 * (t4 * t) - 15.0 * t4 + 10.0 * (t2 * t);
}

// pbrt's Lerp, (1 − t)a + tb.
float perlin_lerp(float t, float a, float b) {
    return (1.0 - t) * a + t * b;
}

float perlin_noise(vec3 x) {
    vec3 cell = floor(x);
    vec3 d = x - cell;
    // The cell index mod 256, computed in float: exact for |x| < 2²⁴, never a negative int.
    ivec3 i = ivec3(mod(cell, 256.0));
    float w000 = perlin_grad(i.x,     i.y,     i.z,     d.x,       d.y,       d.z);
    float w100 = perlin_grad(i.x + 1, i.y,     i.z,     d.x - 1.0, d.y,       d.z);
    float w010 = perlin_grad(i.x,     i.y + 1, i.z,     d.x,       d.y - 1.0, d.z);
    float w110 = perlin_grad(i.x + 1, i.y + 1, i.z,     d.x - 1.0, d.y - 1.0, d.z);
    float w001 = perlin_grad(i.x,     i.y,     i.z + 1, d.x,       d.y,       d.z - 1.0);
    float w101 = perlin_grad(i.x + 1, i.y,     i.z + 1, d.x - 1.0, d.y,       d.z - 1.0);
    float w011 = perlin_grad(i.x,     i.y + 1, i.z + 1, d.x,       d.y - 1.0, d.z - 1.0);
    float w111 = perlin_grad(i.x + 1, i.y + 1, i.z + 1, d.x - 1.0, d.y - 1.0, d.z - 1.0);
    float wx = perlin_weight(d.x), wy = perlin_weight(d.y), wz = perlin_weight(d.z);
    float x00 = perlin_lerp(wx, w000, w100);
    float x10 = perlin_lerp(wx, w010, w110);
    float x01 = perlin_lerp(wx, w001, w101);
    float x11 = perlin_lerp(wx, w011, w111);
    return perlin_lerp(wz, perlin_lerp(wy, x00, x10), perlin_lerp(wy, x01, x11));
}

float perlin_fbm(vec3 x, float omega, int octaves) {
    float sum = 0.0, lambda = 1.0, o = 1.0;
    for (int i = 0; i < octaves; ++i) {
        sum += o * perlin_noise(lambda * x);
        lambda *= 1.99;
        o *= omega;
    }
    return sum;
}

float perlin_turbulence(vec3 x, float omega, int octaves) {
    float sum = 0.0, lambda = 1.0, o = 1.0;
    for (int i = 0; i < octaves; ++i) {
        sum += o * abs(perlin_noise(lambda * x));
        lambda *= 1.99;
        o *= omega;
    }
    return sum + o * 0.2;
}
