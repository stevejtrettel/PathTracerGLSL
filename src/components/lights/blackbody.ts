// components/lights/blackbody.ts — the kelvin → RGB parameterization (family-root
// shared part, the power.ts precedent; impl-plan-blackbody-uv).
//
// A blackbody lamp is a PARAMETERIZATION (owner-pinned): temperature → chroma is a pure
// function, so it rides the DERIVED rail — constant kelvin FOLDS to an RGB literal at
// plan time; driven kelvin becomes a float slider feeding a computed vec3 uniform
// (values.ts, the u_tanFov/u_majorant pattern). CPU-only — no GPU trig, ever.
//
// Pipeline: Planckian locus in CIE xy via the Kim et al. (2002) cubic-spline
// approximations (valid 1667K–25000K; clamped outside), xy → XYZ at Y = 1, XYZ →
// LINEAR sRGB (D65 matrix), negatives clamped, then MAX-CHANNEL NORMALIZED: chroma
// carries only color, `scale` carries all magnitude — the same decomposition the HDR
// widget edits (chroma × intensity), so the two dials compose predictably.

import type { Vec3, BlackbodyValue } from '../../compiler/types.js';

/** Local {param} guard (purity: components import only contract TYPES). */
const isParam = (x: unknown): boolean => typeof x === 'object' && x !== null && 'param' in x;

/** Normalized (max channel = 1) linear-sRGB chroma of a blackbody at `kelvin`. */
export function kelvinToRGB(kelvin: number): Vec3 {
    const T = Math.min(25000, Math.max(1667, kelvin));
    const invT = 1000 / T;           // Kim et al. work in 10³/T
    const invT2 = invT * invT;
    const invT3 = invT2 * invT;

    // Planckian locus, CIE 1931 x(T) (Kim et al. 2002):
    const x = T <= 4000
        ? -0.2661239 * invT3 - 0.2343589 * invT2 + 0.8776956 * invT + 0.179910
        : -3.0258469 * invT3 + 2.1070379 * invT2 + 0.2226347 * invT + 0.240390;
    // y(x) per temperature band:
    const x2 = x * x, x3 = x2 * x;
    const y = T <= 2222
        ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
        : T <= 4000
            ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
            : 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;

    // xy → XYZ at Y = 1, then XYZ → linear sRGB (D65).
    const X = x / y;
    const Z = (1 - x - y) / y;
    let r = 3.2404542 * X - 1.5371385 * 1 - 0.4985314 * Z;
    let g = -0.9692660 * X + 1.8760108 * 1 + 0.0415560 * Z;
    let b = 0.0556434 * X - 0.2040259 * 1 + 1.0572252 * Z;
    r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);

    const m = Math.max(r, g, b, 1e-9);
    return [r / m, g / m, b / m];
}

/** The full fold: chroma(kelvin) · scale — what a CONSTANT blackbody bakes to at plan
 *  time and what the driven closure computes per change (bake ≡ ship, one body). */
export function blackbodyRGB(kelvin: number, scale = 1): Vec3 {
    const [r, g, b] = kelvinToRGB(kelvin);
    return [r * scale, g * scale, b * scale];
}

/** Fold a blackbody spelling when BOTH dials are constant (plan entry); a driven dial
 *  passes through to the split point (values.ts), which mints slider + derived uniform. */
export function foldBlackbody(v: BlackbodyValue): Vec3 | BlackbodyValue {
    const { kelvin, scale } = v.blackbody;
    if (isParam(kelvin) || isParam(scale)) return v;
    return blackbodyRGB(kelvin as number, (scale as number | undefined) ?? 1);
}
