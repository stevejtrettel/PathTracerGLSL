// Environment importance tables: an RGB luminance proposal, independent of colour
// representation. The sampler reads probabilities from the stored CDF differences.

import { DEFAULT_ENV_CHART } from './index.js';

export interface EnvImportanceTable {
    /** Conditional CDF per row (W×H) — texel column selection within the chosen row. */
    condCDF: Float32Array;
    /** Marginal CDF over rows (H). */
    margCDF: Float32Array;
    /** Σ luminance·weight with chart constants dropped (they cancel in the CDF). The
     *  `env.totalWeight` parameter — also the env-power mass the derived selection
     *  probability reads (impl-plan-env-power-selection). For MIS-compensated tables
     *  this is the COMPENSATED mass, deliberately. */
    totalWeight: number;
}

export function buildEnvImportanceTable(
    hdrRGB: Float32Array, // length = W*H*3, linear RGB in radiance units
    W: number,
    H: number,
    opts: {
        /** Support-coverage blur (pbrt-v3 §14.2.4 / env-plan D2.3) — default true. */
        blur?: boolean;
        /** Chart the table lives in (T5, D11): 'equirect' weights texels by the sinθ
         *  Jacobian; 'octahedral' texels are equal-area (constant weight). */
        chart?: string;
        /** MIS compensation (pbrt-v4 / Karlík et al. 2019): subtract the dΩ-weighted mean
         *  luminance before the CDF build — spend light samples only where the env beats
         *  the average BSDF sampling already covers. ONLY sound under MIS (Validator-
         *  gated); pdf-0-where-L>0 is deliberate here. */
        compensation?: boolean;
    } = {},
): EnvImportanceTable {
    const blur = opts.blur ?? true;
    const chart = opts.chart ?? DEFAULT_ENV_CHART;
    const compensation = opts.compensation ?? false;
    if (hdrRGB.some(c => !Number.isFinite(c) || c < 0))
        throw new Error('Environment RGB samples must be finite and nonnegative');

    // 1) luminance per texel
    let Y = new Float32Array(W * H);
    for (let j = 0; j < H; ++j) {
        for (let i = 0; i < W; ++i) {
            const k = 3 * (j * W + i);
            const r = hdrRGB[k], g = hdrRGB[k + 1], b = hdrRGB[k + 2];
            Y[j * W + i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
    }

    // Blur the proposal to cover the image filter's footprint. The independent
    // uniform-sphere component covers detail the bake or float32 CDFs lose.
    if (blur) {
        const blurred = new Float32Array(W * H);
        // Neighborhood policy per chart: equirect wraps u (the φ seam) and clamps v (poles);
        // octahedral edges are fold lines — clamp both (conservative; blur only needs to
        // cover the bilinear footprint, and fold-aware wrapping isn't worth its complexity).
        const wrapU = chart === 'equirect';
        for (let j = 0; j < H; ++j) {
            for (let i = 0; i < W; ++i) {
                let sum = 0, wsum = 0;
                for (let dj = -1; dj <= 1; ++dj) {
                    const jj = Math.min(H - 1, Math.max(0, j + dj));
                    for (let di = -1; di <= 1; ++di) {
                        const ii = wrapU ? (i + di + W) % W : Math.min(W - 1, Math.max(0, i + di));
                        const w = (dj === 0 ? 2 : 1) * (di === 0 ? 2 : 1);   // 3×3 tent
                        sum += w * Y[jj * W + ii];
                        wsum += w;
                    }
                }
                blurred[j * W + i] = sum / wsum;
            }
        }
        Y = blurred;
    }

    // Solid-angle weights for the mean. The equirect midpoint correction is a
    // common factor across rows, so it cancels in this weighted average.
    const texelOmega = (j: number): number =>
        chart === 'octahedral'
            ? (4 * Math.PI) / (W * H)
            : (2 * Math.PI / W) * (Math.PI / H) * Math.sin(Math.PI * (j + 0.5) / H);

    // 1c) MIS compensation (post-blur): subtract the dΩ-weighted mean luminance — the level
    // BSDF sampling already covers — and clamp at zero. A uniform env compensates to an
    // all-zero table → zero CDFs with pdf 0 everywhere → miss-MIS weight 1
    // on the BSDF side. Unbiased by construction, MIS-only by Validator rule.
    if (compensation) {
        let num = 0, den = 0;
        for (let j = 0; j < H; ++j) {
            const dO = texelOmega(j);
            for (let i = 0; i < W; ++i) { num += Y[j * W + i] * dO; den += dO; }
        }
        const mean = den > 0 ? num / den : 0;
        for (let k = 0; k < Y.length; ++k) Y[k] = Math.max(0, Y[k] - mean);
    }

    // 2) conditional CDF per row & marginal CDF over rows
    const condCDF = new Float32Array(W * H);
    const margCDF = new Float32Array(H);
    // Accumulate and normalize in one precision; only the stored CDFs are float32.
    const rowSum = new Float64Array(H);

    let total = 0.0;
    const PI = Math.PI;

    for (let j = 0; j < H; ++j) {
        // Chart Jacobian weight, up to a constant factor (constants cancel in the CDF):
        // equirect rows shrink by sinθ; octahedral texels are equal-area (weight 1).
        const theta = PI * (j + 0.5) / H;
        const sinT = chart === 'octahedral' ? 1.0 : Math.sin(theta);
        let sum = 0.0;
        for (let i = 0; i < W; ++i) sum += Math.max(0, Y[j * W + i]) * sinT;
        rowSum[j] = sum;
        let c = 0.0;
        for (let i = 0; i < W; ++i) {
            c += Math.max(0, Y[j * W + i]) * sinT;
            condCDF[j * W + i] = sum > 0 ? c / sum : 0;
        }
        total += sum;
    }

    let acc = 0.0;
    for (let j = 0; j < H; ++j) {
        acc += rowSum[j];
        margCDF[j] = total > 0 ? (acc / total) : 0;
    }

    return { condCDF, margCDF, totalWeight: total };
}
