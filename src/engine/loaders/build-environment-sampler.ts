// engine/loaders/build-environment-sampler.ts — the DUMB half of the env sampler build
// (E6): upload + registration only. The importance-table MATH (luminance, NEE blur, MIS
// compensation, per-chart Jacobian, CDFs) lives in components/env/importance.ts beside
// the chart GLSL it must mirror — estimator math never belonged in the blind layer.
// Extern NAMES are the CALLER'S (compiler/app own naming); this file registers what it
// is told, knowing nothing.

import { TextureFactory } from '../utils/TextureFactory';
import { buildEnvImportanceTable } from '../../components/env/importance.js';

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
    textureRegistry: { register: (name: string, tex: WebGLTexture) => void },
    hdrRGB: Float32Array, // length = W*H*3, linear RGB in radiance units
    W: number,
    H: number,
    /** Extern names to register the CDF textures under — caller-owned (E6). */
    names: { map: string; cond: string; marg: string },
    opts: { blur?: boolean; chart?: string; compensation?: boolean } = {},
): EnvSamplerBuildResult {
    const { condCDF, margCDF, totalWeight } = buildEnvImportanceTable(hdrRGB, W, H, opts);

    // Upload as R32F (NEAREST, no mips) and register under the caller's names.
    const tf = new TextureFactory(gl);
    textureRegistry.register(names.cond, tf.createR32F(condCDF, W, H));
    textureRegistry.register(names.marg, tf.createR32F(margCDF, 1, H));

    return {
        texNames: { cond: names.cond, marg: names.marg, map: names.map },
        size: [W, H],
        totalWeight,
        cdf: { cond: condCDF, marg: margCDF },
    };
}
