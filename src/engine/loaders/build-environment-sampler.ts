// engine/build-environment-sampler.ts
import { TextureFactory } from '../utils/TextureFactory';

export type EnvSamplerBuildResult = {
    texNames: { cond: string; marg: string; map: string };
    size: [number, number];
    totalWeight: number;
    /** The CPU-side CDF arrays (also uploaded as R32F textures). Exposed so tests can verify
     *  the density round-trips through CDF differences — the invariant the GLSL pdf relies on. */
    cdf: { cond: Float32Array; marg: Float32Array };
};

export function buildEnvironmentSampler(
    gl: WebGL2RenderingContext,
    textureRegistry: { register: (name: string, tex: WebGLTexture)=>void },
    hdrRGB: Float32Array, // length = W*H*3, linear RGB in radiance units
    W: number,
    H: number,
    // names to register under (optional, choose your own scheme)
    names = { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' },
    opts: {
        blur?: boolean;
        /** Chart the table lives in (T5, D11): 'equirect' weights texels by the sinθ
         *  Jacobian; 'octahedral' texels are equal-area (constant weight). Default equirect. */
        chart?: 'equirect' | 'octahedral';
        /** MIS compensation (pbrt-v4 / Karlík et al. 2019): subtract the dΩ-weighted mean
         *  luminance before the CDF build — spend light samples only where the env beats
         *  the average that BSDF sampling already covers. ONLY sound under MIS (the
         *  Validator gates it); pdf-0-where-L>0 is deliberate here. */
        compensation?: boolean;
    } = {},
): EnvSamplerBuildResult {
    const blur = opts.blur ?? true;
    const chart = opts.chart ?? 'equirect';
    const compensation = opts.compensation ?? false;

    // 1) luminance per texel
    let Y = new Float32Array(W * H);
    for (let j = 0; j < H; ++j) {
        for (let i = 0; i < W; ++i) {
            const k = 3 * (j * W + i);
            const r = hdrRGB[k], g = hdrRGB[k+1], b = hdrRGB[k+2];
            Y[j*W + i] = 0.2126*r + 0.7152*g + 0.0722*b;
        }
    }

    // 1b) Support coverage (pbrt-v3 §14.2.4 / env-plan D2.3): radiance LOOKUPS are bilinear,
    // so a black texel adjacent to a bright one still contributes nonzero radiance in its
    // neighborhood. A one-texel 3×3 tent blur on the IMPORTANCE table (not the radiance!)
    // guarantees pdf > 0 wherever bilinear L > 0 — without it, NEE-only estimators are
    // biased near black↔bright texel boundaries (MIS never needed this; NEE does).
    // u wraps (equirect seam), v clamps (poles).
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

    // Per-texel solid angle in the table's chart (must match the GLSL chart's env_texel_dOmega)
    const texelOmega = (j: number): number =>
        chart === 'octahedral'
            ? (4 * Math.PI) / (W * H)
            : (2 * Math.PI / W) * (Math.PI / H) * Math.sin(Math.PI * (j + 0.5) / H);

    // 1c) MIS compensation (post-blur): subtract the dΩ-weighted mean luminance — the level
    // BSDF sampling already covers — and clamp at zero. A uniform env compensates to an
    // all-zero table → the uniform-fallback CDF with pdf 0 everywhere → miss-MIS weight 1
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
    const rowSum  = new Float32Array(H);

    let total = 0.0;
    const PI = Math.PI;

    for (let j = 0; j < H; ++j) {
        // Chart Jacobian weight, up to a constant factor (constants cancel in the CDF):
        // equirect rows shrink by sinθ; octahedral texels are equal-area (weight 1).
        const theta = PI * (j + 0.5) / H;
        const sinT  = chart === 'octahedral' ? 1.0 : Math.sin(theta);
        let sum = 0.0;
        for (let i = 0; i < W; ++i) sum += Math.max(0, Y[j*W + i]) * sinT;
        rowSum[j] = sum;
        const safe = Math.max(sum, 1e-20);
        let c = 0.0;
        for (let i = 0; i < W; ++i) {
            c += Math.max(0, Y[j*W + i]) * sinT;
            condCDF[j*W + i] = c / safe;
        }
        total += sum;
    }

    let acc = 0.0;
    for (let j = 0; j < H; ++j) {
        acc += rowSum[j];
        margCDF[j] = total > 0 ? (acc / total) : (j + 1) / H;
    }

    // 3) upload CDFs as R32F (NEAREST) via TextureFactory
    const tf = new TextureFactory(gl);
    const condTex = tf.createR32F(condCDF, W, H); // NEAREST, no mips
    const margTex = tf.createR32F(margCDF, 1, H); // NEAREST, no mips

    // 4) register with stable names
    textureRegistry.register(names.cond, condTex);
    textureRegistry.register(names.marg, margTex);

    return {
        texNames: { cond: names.cond, marg: names.marg, map: names.map },
        size: [W, H],
        totalWeight: total,
        cdf: { cond: condCDF, marg: margCDF },
    };
}
