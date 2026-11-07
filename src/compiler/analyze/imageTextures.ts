// compiler/analyze/imageTextures.ts — image textures, checked and lowered before Analyze.
//
// A `{ texture }` value is the one value form no later stage reads. This pass checks every such
// value and every texture declaration, assigns each read image an array layer (first use:
// materials in insertion order, rows in schema order), and replaces each value by the RGB
// expression that reads its layer at the hit's uv. Everything downstream (Validate, Plan, the
// spectrum kinds) then sees an ordinary RGB expression in a reflectance row: lifted after the
// filter in spectral programs, and reading uv, so the uv charts are on.
//
// The field the expression computes is src/glsl/shared/image_texture.glsl (pbrt-v4's
// conventions: t = 1 − v, texel centers at half-integers, each texel decoded to linear before the
// bilinear blend, repeat wrap). Its values lie in [0, 1] by construction, so the reflectance
// domain holds without an author contract.

import type { SceneDescription, MaterialDescription, ImageTextureDescription, TextureValue, ObjectDescription } from '../types.js';
import { isInstancedObject, isPrimitiveObject } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';
import { unknownKeysProblem } from '../../components/param.js';
import { formatFloat } from '../../components/glsl-format.js';
import { glslValue } from '../generate/color.js';

/** One layer of the material image array: the declared texture it holds. */
export interface ImageLayer {
    name: string;
    url: string;
    colorspace: ImageTextureDescription['colorspace'];
}

/** The extern name of the material image array (an RGBA8 2D-array texture, one layer per image). */
export const MATERIAL_TEXTURES_EXTERN = 'material_textures';

const TEXTURE_VALUE_KEYS = ['texture', 'uvScale'] as const;
const DECLARATION_KEYS = ['url', 'colorspace'] as const;

/** Is this an image-texture value (an object carrying the key `texture`)? */
export function isTextureValue(value: unknown): value is TextureValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, 'texture');
}

/**
 * Check the scene's texture declarations and values, and return the scene with every texture
 * value replaced by its RGB expression, plus the images those expressions read, in layer order.
 * Problems go to `bag`; the scene returned is meaningful only when there are none.
 */
export function lowerImageTextures(scene: SceneDescription, bag: DiagnosticBag): { scene: SceneDescription; images: ImageLayer[] } {
    const declared = scene.textures ?? {};
    for (const [name, decl] of Object.entries(declared)) {
        for (const problem of declarationProblems(decl)) bag.error('invalid-setting', `Texture '${name}' ${problem}`).add();
    }

    const images: ImageLayer[] = [];
    const layerOf = new Map<string, number>();
    const textured = new Set<string>();
    const materials: Record<string, MaterialDescription> = {};
    for (const [name, mat] of Object.entries(scene.materials)) {
        const rows = MATERIAL_MODELS[mat.model]?.properties ?? [];
        const lowered: Record<string, unknown> = { ...mat };
        // Schema order first (the layer order), then any other key, which cannot take a texture.
        const keys = [...rows.map((r) => r.source as string).filter((k) => Object.hasOwn(mat, k)), ...Object.keys(mat).filter((k) => !rows.some((r) => r.source === k))];
        for (const key of keys) {
            const value = (mat as Record<string, unknown>)[key];
            if (!isTextureValue(value)) continue;
            const label = `Material '${name}': ${key}`;
            const row = rows.find((r) => r.source === key);
            if (row === undefined) {
                bag.error('invalid-setting', `${label} is not a row of model '${mat.model}', so it cannot read an image texture`).add();
                continue;
            }
            if (row.glslType !== 'Spectrum' || row.role !== 'reflectance' || row.storage !== 'field') {
                bag.error('invalid-setting', `${label} cannot read an image texture: textures are a color form for reflectance rows (albedo, f0, transmittance); emission, index and float rows such as roughness do not take one`).add();
                continue;
            }
            const problems = valueProblems(value, declared);
            for (const problem of problems) bag.error('invalid-setting', `${label}: ${problem}`).add();
            if (problems.length > 0) continue;

            const decl = declared[value.texture];
            if (!layerOf.has(value.texture)) {
                layerOf.set(value.texture, images.length);
                images.push({ name: value.texture, url: decl.url, colorspace: decl.colorspace });
            }
            lowered[key] = glslValue(`image_texture(${layerOf.get(value.texture)}, ${uvExpression(value.uvScale)}, ${decl.colorspace === 'srgb'}).rgb`);
            textured.add(name);
        }
        materials[name] = lowered as MaterialDescription;
    }

    // The sphere's chart (v = 0 at +y, u turning about +y) is pbrt's rotated by 180°, so an image
    // authored for pbrt's would come out upside down and mirrored. Which chart is right is not
    // decided, so a sphere reads no image until it is.
    for (const obj of scene.objects) {
        const shape = sphereMaterial(obj);
        if (shape !== undefined && textured.has(shape)) {
            bag.error('invalid-setting', `Material '${shape}' reads an image texture and is used by a sphere: the sphere's uv chart orientation is not settled, so spheres take no image textures yet`).add();
        }
    }

    return { scene: { ...scene, materials }, images };
}

/** The material of a sphere (on its own or as an instance prototype), or undefined. */
function sphereMaterial(obj: ObjectDescription): string | undefined {
    const shape = isInstancedObject(obj) ? obj.prototype : obj;
    return isPrimitiveObject(shape) && shape.type === 'sphere' ? shape.material : undefined;
}

function declarationProblems(decl: unknown): string[] {
    if (typeof decl !== 'object' || decl === null || Array.isArray(decl)) return [`must be { url, colorspace: 'srgb' | 'linear' }`];
    const problems: string[] = [];
    const keys = unknownKeysProblem(decl, DECLARATION_KEYS);
    if (keys !== null) problems.push(`has ${keys}`);
    const { url, colorspace } = decl as { url?: unknown; colorspace?: unknown };
    if (typeof url !== 'string' || url === '') problems.push('url must be a non-empty string');
    if (colorspace !== 'srgb' && colorspace !== 'linear') {
        problems.push(`colorspace must be 'srgb' (color images) or 'linear' (data); it is required, because neither the file name nor an embedded profile says which`);
    }
    return problems;
}

function valueProblems(value: TextureValue, declared: Record<string, ImageTextureDescription>): string[] {
    const problems: string[] = [];
    const keys = unknownKeysProblem(value, TEXTURE_VALUE_KEYS);
    if (keys !== null) problems.push(`the texture value has ${keys}`);
    if (typeof value.texture !== 'string' || !Object.hasOwn(declared, value.texture)) {
        problems.push(`texture '${String(value.texture)}' is not declared in the scene's textures`);
    }
    const scale = value.uvScale;
    const positive = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
    if (scale !== undefined && !positive(scale) && !(Array.isArray(scale) && scale.length === 2 && scale.every(positive))) {
        problems.push('uvScale must be a finite number > 0 or a pair of them');
    }
    return problems;
}

/** The chart coordinate the image is read at: uv, scaled per axis. */
function uvExpression(scale: TextureValue['uvScale']): string {
    if (scale === undefined) return 'uv';
    const [a, b] = typeof scale === 'number' ? [scale, scale] : scale;
    return `uv * vec2(${formatFloat(a)}, ${formatFloat(b)})`;
}
