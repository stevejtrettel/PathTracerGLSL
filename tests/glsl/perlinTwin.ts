// TS twin of src/glsl/core/perlin.glsl, operation for operation, with every intermediate
// rounded to fp32 (Math.fround), so it reproduces pbrt-v4's single-precision noise.cpp
// (tests/glsl/perlin.test.ts compares it with values from compiling that file) and is the
// reference the GPU probe (scripts/witness-textures.ts) holds the GLSL to.
// The permutation is read out of perlin.glsl, so the table has one source.
import perlinGLSL from '../../src/glsl/core/perlin.glsl?raw';

const f = Math.fround;

/** The 256-entry permutation, parsed from the GLSL constant PERLIN_PERM. */
export const PERLIN_PERM: readonly number[] = (() => {
    const m = /const int PERLIN_PERM\[256\] = int\[256\]\(([^)]*)\)/.exec(perlinGLSL);
    if (m === null) throw new Error('PERLIN_PERM not found in perlin.glsl');
    return m[1].split(',').map((s) => Number(s.trim()));
})();
const P = PERLIN_PERM;

function grad(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
    const h = P[(P[(P[x & 255] + y) & 255] + z) & 255] & 15;
    const u = h < 8 || h === 12 || h === 13 ? dx : dy;
    const v = h < 4 || h === 12 || h === 13 ? dy : dz;
    return f(((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -v : v));
}

/** 6t⁵ − 15t⁴ + 10t³ with pbrt's powers: t⁵ = (t²)²·t, t⁴ = (t²)², t³ = t²·t. */
function weight(t: number): number {
    const t2 = f(t * t);
    const t4 = f(t2 * t2);
    return f(f(f(6 * f(t4 * t)) - f(15 * t4)) + f(10 * f(t2 * t)));
}

const lerp = (t: number, a: number, b: number) => f(f(f(1 - t) * a) + f(t * b));

/** Perlin's improved gradient noise at (x, y, z), each rounded to fp32 first. */
export function perlinNoise(x: number, y: number, z: number): number {
    x = f(x); y = f(y); z = f(z);
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const dx = f(x - fx), dy = f(y - fy), dz = f(z - fz);
    const ix = ((fx % 256) + 256) % 256, iy = ((fy % 256) + 256) % 256, iz = ((fz % 256) + 256) % 256;
    const w000 = grad(ix, iy, iz, dx, dy, dz);
    const w100 = grad(ix + 1, iy, iz, f(dx - 1), dy, dz);
    const w010 = grad(ix, iy + 1, iz, dx, f(dy - 1), dz);
    const w110 = grad(ix + 1, iy + 1, iz, f(dx - 1), f(dy - 1), dz);
    const w001 = grad(ix, iy, iz + 1, dx, dy, f(dz - 1));
    const w101 = grad(ix + 1, iy, iz + 1, f(dx - 1), dy, f(dz - 1));
    const w011 = grad(ix, iy + 1, iz + 1, dx, f(dy - 1), f(dz - 1));
    const w111 = grad(ix + 1, iy + 1, iz + 1, f(dx - 1), f(dy - 1), f(dz - 1));
    const wx = weight(dx), wy = weight(dy), wz = weight(dz);
    const x00 = lerp(wx, w000, w100), x10 = lerp(wx, w010, w110);
    const x01 = lerp(wx, w001, w101), x11 = lerp(wx, w011, w111);
    return lerp(wz, lerp(wy, x00, x10), lerp(wy, x01, x11));
}

const LACUNARITY = f(1.99);

/** Σ_{i<octaves} ωⁱ noise(1.99ⁱ x). */
export function perlinFbm(x: number, y: number, z: number, omega: number, octaves: number): number {
    const w = f(omega);
    x = f(x); y = f(y); z = f(z);
    let sum = 0, lambda = 1, o = 1;
    for (let i = 0; i < octaves; i++) {
        sum = f(sum + f(o * perlinNoise(f(lambda * x), f(lambda * y), f(lambda * z))));
        lambda = f(lambda * LACUNARITY);
        o = f(o * w);
    }
    return sum;
}

/** Σ_{i<octaves} ωⁱ |noise(1.99ⁱ x)| + 0.2 ω^octaves. */
export function perlinTurbulence(x: number, y: number, z: number, omega: number, octaves: number): number {
    const w = f(omega);
    x = f(x); y = f(y); z = f(z);
    let sum = 0, lambda = 1, o = 1;
    for (let i = 0; i < octaves; i++) {
        sum = f(sum + f(o * Math.abs(perlinNoise(f(lambda * x), f(lambda * y), f(lambda * z)))));
        lambda = f(lambda * LACUNARITY);
        o = f(o * w);
    }
    return f(sum + f(o * f(0.2)));
}
