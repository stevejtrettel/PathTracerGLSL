// Types for render-glsl-probes.mjs, so the TypeScript scripts that call it are typechecked.
import type { Page } from 'playwright';

/** A float texture bound to the sampler uniform `uniform` (RGBA32F, `width × height` texels). */
export interface ProbeTexture {
    uniform: string;
    width: number;
    height: number;
    data: ArrayLike<number>;
    filter?: 'nearest' | 'linear';
}

/** A uniform value: `type` is 'int', 'float' or a GLSL `vecN`/`matN` type (uploaded as floats). */
export interface ProbeUniform {
    type: string;
    value: number | number[];
}

/** One fragment program; `values` (if given) is uploaded to the `vec4 values[]` uniform. */
export interface ProbeShader {
    name: string;
    source: string;
    values?: number[];
    uniforms?: Record<string, ProbeUniform>;
    textures?: ProbeTexture[];
}

/**
 * Renders each shader into a `width × height` RGBA32F framebuffer and returns its pixels
 * (row-major from the bottom row, 4 floats per pixel). `sharedTextures` are bound before
 * each shader's own textures.
 */
export function renderProbes(
    page: Page,
    shaders: ProbeShader[],
    width?: number,
    sharedTextures?: ProbeTexture[],
    height?: number,
): Promise<number[][]>;
