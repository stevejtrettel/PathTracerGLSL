// app/images.ts — loading the material images of a scene-data plan into the image array.
//
// Each image is fetched and decoded to 8-bit RGBA exactly as stored: no color-space conversion
// (the compiled lookup applies the declared colorspace itself) and no alpha premultiplication.
// The layers of one array share one size, so images of different sizes are an error.

import type { Engine } from '../engine/Engine.js';
import type { SceneDataPlan } from '../compiler/sceneData.js';
import { MATERIAL_TEXTURES_EXTERN } from '../compiler/analyze/imageTextures.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The bit depth of a PNG (IHDR byte 24), or null when the bytes are not a PNG. */
export function pngBitDepth(bytes: Uint8Array): number | null {
    if (bytes.length < 25 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
    return bytes[24];
}

/** What is wrong with the images' sizes, or null when they share one. */
export function layerSizeProblem(sizes: Array<{ url: string; width: number; height: number }>): string | null {
    const [first] = sizes;
    if (sizes.every((s) => s.width === first.width && s.height === first.height)) return null;
    return `The scene's image textures must all be one size (they share one texture array): ${sizes.map((s) => `${s.url} ${s.width}×${s.height}`).join(', ')}`;
}

/** Fetch, check and decode one image. */
async function decode(url: string): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image texture ${url}: fetch failed (${response.status} ${response.statusText})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A browser decodes a 16-bit PNG to 8 bits without saying so; the lookup reads 8-bit codes.
    const depth = pngBitDepth(bytes);
    if (depth !== null && depth !== 8) {
        throw new Error(`Image texture ${url} is a ${depth}-bit PNG; image textures are read at 8 bits — convert it, or use the 8-bit JPEG`);
    }
    return createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/** Load the plan's images, in layer order, into the engine's image array. */
export async function uploadImages(images: NonNullable<SceneDataPlan['images']>, engine: Engine): Promise<void> {
    const layers = await Promise.all(images.map((image) => decode(image.url)));
    try {
        const problem = layerSizeProblem(layers.map((b, i) => ({ url: images[i].url, width: b.width, height: b.height })));
        if (problem !== null) throw new Error(problem);
        engine.registerImageArray(MATERIAL_TEXTURES_EXTERN, layers, layers[0].width, layers[0].height);
    } finally {
        for (const layer of layers) layer.close();
    }
}
