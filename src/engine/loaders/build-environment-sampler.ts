// engine/build-environment-sampler.ts
import { TextureFactory } from '../utils/TextureFactory';

export type EnvSamplerBuildResult = {
    texNames: { cond: string; marg: string; map: string };
    size: [number, number];
    totalWeight: number;
};

export function buildEnvironmentSampler(
    gl: WebGL2RenderingContext,
    textureRegistry: { register: (name: string, tex: WebGLTexture)=>void },
    hdrRGB: Float32Array, // length = W*H*3, linear RGB in radiance units
    W: number,
    H: number,
    // names to register under (optional, choose your own scheme)
    names = { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' },
): EnvSamplerBuildResult {

    // 1) luminance per texel
    const Y = new Float32Array(W * H);
    for (let j = 0; j < H; ++j) {
        for (let i = 0; i < W; ++i) {
            const k = 3 * (j * W + i);
            const r = hdrRGB[k], g = hdrRGB[k+1], b = hdrRGB[k+2];
            Y[j*W + i] = 0.2126*r + 0.7152*g + 0.0722*b;
        }
    }

    // 2) conditional CDF per row & marginal CDF over rows
    const condCDF = new Float32Array(W * H);
    const margCDF = new Float32Array(H);
    const rowSum  = new Float32Array(H);

    let total = 0.0;
    const PI = Math.PI;

    for (let j = 0; j < H; ++j) {
        const theta = PI * (j + 0.5) / H;
        const sinT  = Math.sin(theta);
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
        totalWeight: total
    };
}
