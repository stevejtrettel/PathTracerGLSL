// tests/witnesses/scenes/imageTextureWitness.ts — the image-texture gates
// (src/glsl/shared/image_texture.glsl; its TS twin is tests/glsl/imageTextureTwin.ts).
//
// THE FRAME. A Lambert quad with corner (−1, −1, 0), edge1 (2, 0, 0) and edge2 (0, 2, 0) faces +z,
// so its chart has u along +x and v along +y. An orthographic camera at (0, 0, 4) looking down −z
// with half-height 1 and a square picture sees exactly the quad: picture column fraction = u and
// row fraction (bottom-left origin, as the runner reads) = v. Under a constant sky of radiance 1
// with one bounce, a Lambert surface reads its albedo, L(u, v) = ρ(u, v), so each quadrant of the
// picture reads the mean of the albedo field over that quadrant of the uv square, which
// quadrantMean computes exactly (the field is piecewise bilinear).
//
// THE IMAGE. 4 × 4 texels whose four 2 × 2 blocks differ in every channel, by columns as much as
// by rows, and whose three channels are arranged differently (R is bright top-right, G top-left,
// B bottom-left). Each convention error moves some quadrant of some channel by a lot:
//   - v not flipped (t = v): top and bottom swap (G: 0.639 ⇄ 0.112);
//   - u mirrored: left and right swap (G: 0.639 ⇄ 0.199);
//   - no half-texel offset: G top-left 0.485, B bottom-left 0.479;
//   - decoding after the blend: G top-left 0.563, R top-right 0.525;
//   - channels exchanged: R and B trade places;
//   - the sRGB flag ignored: image-texture-linear reads the decoded values, or the other way.
//
//   image-texture          — RGB program, colorspace 'srgb', under pt, pt-nee and pt-mis.
//   image-texture-linear   — the same image read as linear data (pt).
//   image-texture-spectral — the gray image (the G table) in a spectral program (pt). A gray RGB
//                            lifts to the constant spectrum exactly, so the values are G's. Gray
//                            texels look the same lifted before or after the blend, so this gate
//                            does not see the lift order; tests/compiler/imageTextures.test.ts pins
//                            that the generated code lifts the filtered value.
//
// Witness protocol: RR off; tonemap none (values read off the linear picture).

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { WitnessRegion } from '../types.js';
import { quadrantMean, type CodeTable, type Quadrant } from '../../glsl/imageTextureTwin.js';
import { pngDataUrl } from './png.js';

/** The three channels' codes, rows from the top of the image file. */
export const TEXTURE_CODES: { r: CodeTable; g: CodeTable; b: CodeTable } = {
    r: [[20, 0, 220, 255], [10, 30, 250, 200], [90, 120, 40, 60], [110, 80, 50, 70]],
    g: [[255, 230, 120, 90], [200, 240, 100, 110], [60, 40, 0, 10], [50, 30, 16, 5]],
    b: [[70, 40, 10, 0], [50, 60, 30, 20], [240, 255, 110, 130], [200, 230, 90, 120]],
};

const rgbRows = TEXTURE_CODES.r.map((row, j) => row.map((r, i) => [r, TEXTURE_CODES.g[j][i], TEXTURE_CODES.b[j][i]] as [number, number, number]));
const RGB_PNG = pngDataUrl(rgbRows);
const GRAY_PNG = pngDataUrl(TEXTURE_CODES.g);

function texturedQuad(id: string, name: string, url: string, colorspace: 'srgb' | 'linear'): SceneDescription {
    return {
        id,
        name,
        ambientSpace: { type: 'euclidean' },
        textures: { witness: { url, colorspace } },
        objects: [
            { type: 'quad', parameters: { corner: [-1, -1, 0], edge1: [2, 0, 0], edge2: [0, 2, 0] }, material: 'textured' },
        ],
        materials: {
            textured: { model: 'lambert', albedo: { texture: 'witness' } },
        },
        lights: [],
        environment: { type: 'constant', color: 1, intensity: 1.0, sampleAsLight: true },
    };
}

export const imageTextureScene = texturedQuad('image-texture', 'Image texture (sRGB) on an orthographic quad', RGB_PNG, 'srgb');
export const imageTextureLinearScene = texturedQuad('image-texture-linear', 'Image texture (linear data) on an orthographic quad', RGB_PNG, 'linear');
export const imageTextureSpectralScene = texturedQuad('image-texture-spectral', 'Image texture (gray, sRGB) in a spectral program', GRAY_PNG, 'srgb');

const base: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'orthographic', scale: 1, position: [0, 0, 4], target: [0, 0, 0] }, maxBounces: 1 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
};
export const imageTexturePtStrategy: RenderStrategy = base;
export const imageTextureNeeStrategy: RenderStrategy = { ...base, id: 'pt-nee', estimator: { ...base.estimator, directLighting: 'nee' } };
export const imageTextureMisStrategy: RenderStrategy = { ...base, id: 'pt-mis', estimator: { ...base.estimator, directLighting: 'mis' } };
export const imageTextureSpectralStrategy: RenderStrategy = {
    ...base,
    id: 'spectral-pt',
    measurement: { ...base.measurement, color: 'spectral' },
    estimator: { ...base.estimator, wavelengths: 'visible' },
};

export const QUADRANTS: Record<Quadrant, WitnessRegion> = {
    'bottom-left': { x: 0, y: 0, w: 0.5, h: 0.5 },
    'bottom-right': { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    'top-left': { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    'top-right': { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
};

/** The exact radiance of a quadrant: each channel's albedo mean over it. */
export function quadrantRadiance(quadrant: Quadrant, srgb: boolean): [number, number, number] {
    return [quadrantMean(TEXTURE_CODES.r, quadrant, srgb), quadrantMean(TEXTURE_CODES.g, quadrant, srgb), quadrantMean(TEXTURE_CODES.b, quadrant, srgb)];
}

/** The gray image's quadrant radiance (every channel G's mean). */
export function grayQuadrantRadiance(quadrant: Quadrant): [number, number, number] {
    const g = quadrantMean(TEXTURE_CODES.g, quadrant, true);
    return [g, g, g];
}
