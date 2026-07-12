// engine/loaders/octahedral.ts
// EQUAL-AREA octahedral square↔sphere mapping (Clarberg 2008, as adopted by pbrt-v4's
// ImageInfiniteLight) — every texel of an N×N table subtends exactly 4π/N² steradians,
// so the chart Jacobian is constant: no sinθ table weighting, no pole singularity, no
// wasted polar texels. NOTE: this is NOT the common non-equal-area octahedral normal
// encoding (Cigolle et al.) — the radial warp is what buys equal area.
//
// Convention: Y-up (pbrt's z-up swizzled: our (x, z) span the square, y is the pole axis).
// The GLSL chart (env_chart_octahedral.glsl) is a line-for-line transcription of these two
// functions — change one, change both (the sampler's pdf depends on the pair agreeing).

export type Vec3Tuple = [number, number, number];

function copysign(mag: number, sign: number): number {
    return sign < 0 || Object.is(sign, -0) ? -Math.abs(mag) : Math.abs(mag);
}

/** [0,1]² → unit sphere, equal-area. */
export function equalAreaSquareToSphere(u: number, v: number): Vec3Tuple {
    const up = 2 * u - 1;
    const vp = 2 * v - 1;
    const upAbs = Math.abs(up);
    const vpAbs = Math.abs(vp);

    // Signed distance to the diagonal |u'|+|v'| = 1 (the equator fold)
    const signedDistance = 1 - (upAbs + vpAbs);
    const d = Math.abs(signedDistance);
    const r = 1 - d;

    const phi = ((r === 0 ? 1 : (vpAbs - upAbs) / r) + 1) * Math.PI / 4;
    const y = copysign(1 - r * r, signedDistance);                 // pole axis (pbrt's z)
    const cosPhi = copysign(Math.cos(phi), up);
    const sinPhi = copysign(Math.sin(phi), vp);
    const s = r * Math.sqrt(Math.max(0, 2 - r * r));
    return [cosPhi * s, y, sinPhi * s];
}

/** Unit sphere → [0,1]², exact inverse of the above. */
export function equalAreaSphereToSquare(d: Vec3Tuple): [number, number] {
    const x = Math.abs(d[0]);
    const y = Math.abs(d[1]);                                      // pole axis
    const z = Math.abs(d[2]);

    const r = Math.sqrt(Math.max(0, 1 - y));                      // radius on the square

    const a = Math.max(x, z);
    const b = a === 0 ? 0 : Math.min(x, z) / a;
    // φ ∈ [0, π/4] normalized to [0,1] via atan (pbrt uses a polynomial; atan is exact)
    let phi = Math.atan(b) * (2 / Math.PI);
    if (x < z) phi = 1 - phi;

    let vv = phi * r;
    let uu = r - vv;
    if (d[1] < 0) {                                               // southern hemisphere: fold
        const t = uu; uu = vv; vv = t;
        uu = 1 - uu;
        vv = 1 - vv;
    }
    uu = copysign(uu, d[0]);
    vv = copysign(vv, d[2]);
    return [(uu + 1) / 2, (vv + 1) / 2];
}

/**
 * Resample an equirect RGB table to an N×N equal-area octahedral RGB table (bilinear
 * source fetch; u wraps at the seam, v clamps at the poles). Used for `image` sources —
 * procedural sources skip this and bake directly in the octahedral chart.
 */
export function resampleEquirectToOctahedral(
    rgb: Float32Array, W: number, H: number, N: number,
): Float32Array {
    const out = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const dir = equalAreaSquareToSphere((i + 0.5) / N, (j + 0.5) / N);
            // equirect uv of dir (rotation-free — tables are unrotated by convention)
            const phi = Math.atan2(dir[2], dir[0]);
            const theta = Math.acos(Math.min(1, Math.max(-1, dir[1])));
            const u = phi / (2 * Math.PI) + 0.5;
            const v = theta / Math.PI;
            // bilinear fetch, wrap u / clamp v
            const fx = u * W - 0.5, fy = v * H - 0.5;
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0;
            const wrap = (x: number) => ((x % W) + W) % W;
            const clampY = (y: number) => Math.min(H - 1, Math.max(0, y));
            const o = 3 * (j * N + i);
            for (let c = 0; c < 3; c++) {
                const s = (x: number, y: number) => rgb[3 * (clampY(y) * W + wrap(x)) + c];
                out[o + c] =
                    (1 - tx) * (1 - ty) * s(x0, y0) + tx * (1 - ty) * s(x0 + 1, y0) +
                    (1 - tx) * ty * s(x0, y0 + 1) + tx * ty * s(x0 + 1, y0 + 1);
            }
        }
    }
    return out;
}
