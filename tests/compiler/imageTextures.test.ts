// Image textures (compiler/analyze/imageTextures.ts, src/glsl/shared/image_texture.glsl): the
// checks on `{ texture }` values and the scene's texture declarations, the lowering to an RGB
// expression read in the material resolver, layer order, exact linkage of the image block and its
// sampler, and the sampler budget's count of a 2D-array sampler.
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { lowerImageTextures } from '../../src/compiler/analyze/imageTextures.js';
import { samplerRoster } from '../../src/compiler/generate/Generator.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { imageTextureScene, imageTextureNeeStrategy, imageTextureSpectralStrategy, imageTextureMisStrategy } from '../witnesses/scenes/imageTextureWitness.js';
import { exprConstRef, exprTwinStrategy } from '../witnesses/scenes/exprMaterialWitness.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const SAMPLER = 'uniform highp sampler2DArray u_material_textures;';

function fragment(scene: SceneDescription, strategy: RenderStrategy): string {
    const shaders = [...compiler.compile(scene, strategy).shaders.values()];
    return shaders.find((s) => s.fragment.includes('scene_material_properties'))!.fragment;
}

/** A quad and a disk (both with uv charts) under the witness sky, with the given materials. */
function sceneWith(materials: SceneDescription['materials'], textures: SceneDescription['textures'], extraObjects: SceneDescription['objects'] = []): SceneDescription {
    const names = Object.keys(materials);
    return {
        ...imageTextureScene,
        id: 'image-texture-test',
        textures,
        objects: [
            { type: 'quad', parameters: { corner: [-1, -1, 0], edge1: [2, 0, 0], edge2: [0, 2, 0] }, material: names[0] },
            { type: 'disk', parameters: { center: [0, 0, -1], normal: [0, 0, 1], radius: 1 }, material: names[names.length - 1] },
            ...extraObjects,
        ],
        materials,
    };
}

const TEXTURES = {
    wood: { url: 'wood.jpg', colorspace: 'srgb' as const },
    data: { url: 'data.png', colorspace: 'linear' as const },
    unused: { url: 'unused.png', colorspace: 'srgb' as const },
};

function problems(scene: SceneDescription): string[] {
    const bag = new DiagnosticBag('test');
    lowerImageTextures(scene, bag);
    return bag.getErrors().map((e) => e.message);
}

describe('image textures: checks', () => {
    it('accepts the witness scene', () => {
        expect(problems(imageTextureScene)).toEqual([]);
    });

    it('rejects an undeclared texture name', () => {
        const msgs = problems(sceneWith({ m: { model: 'lambert', albedo: { texture: 'oak' } } }, TEXTURES));
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatch(/Material 'm': albedo.*'oak'.*not declared/);
    });

    it('rejects unknown keys and a uvScale that is not positive and finite', () => {
        expect(problems(sceneWith({ m: { model: 'lambert', albedo: { texture: 'wood', scale: 2 } as never } }, TEXTURES))[0]).toMatch(/scale/);
        for (const uvScale of [0, -1, Infinity, [1, 0], [1, 2, 3], 'x']) {
            const msgs = problems(sceneWith({ m: { model: 'lambert', albedo: { texture: 'wood', uvScale } as never } }, TEXTURES));
            expect(msgs.some((m) => /uvScale/.test(m)), JSON.stringify(uvScale)).toBe(true);
        }
    });

    it('takes a texture only in a reflectance color row of the material\'s model', () => {
        const cases: Array<[SceneDescription['materials'][string], RegExp]> = [
            [{ model: 'lambert', albedo: 0.5, emission: { texture: 'wood' } as never }, /emission/],
            [{ model: 'ggx', f0: 0.9, roughness: { texture: 'wood' } as never }, /roughness/],
            [{ model: 'dielectric', ior: { texture: 'wood' } as never }, /ior/],
            [{ model: 'lambert', f0: { texture: 'wood' } as never }, /f0.*lambert/],
        ];
        for (const [mat, pattern] of cases) {
            const msgs = problems(sceneWith({ m: mat }, TEXTURES));
            expect(msgs.length, JSON.stringify(mat)).toBe(1);
            expect(msgs[0]).toMatch(pattern);
        }
    });

    it('rejects a texture on a material a sphere uses, directly or as an instance prototype', () => {
        const sphere = { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' };
        const direct = problems(sceneWith({ m: { model: 'lambert', albedo: { texture: 'wood' } } }, TEXTURES, [sphere]));
        expect(direct).toHaveLength(1);
        expect(direct[0]).toMatch(/sphere/);
        const instanced = problems(sceneWith({ m: { model: 'lambert', albedo: { texture: 'wood' } } }, TEXTURES, [
            { kind: 'instanced', prototype: sphere, placements: [{ position: [3, 0, 0] }] },
        ]));
        expect(instanced).toHaveLength(1);
        expect(instanced[0]).toMatch(/sphere/);
    });

    it('checks every declaration: a url and a colorspace of srgb or linear, nothing else', () => {
        const bad = (decl: unknown) => problems(sceneWith({ m: { model: 'lambert', albedo: 0.5 } }, { t: decl as never }));
        expect(bad({ url: 'a.png' })[0]).toMatch(/colorspace/);
        expect(bad({ url: 'a.png', colorspace: 'rec709' })[0]).toMatch(/colorspace/);
        expect(bad({ colorspace: 'srgb' })[0]).toMatch(/url/);
        expect(bad({ url: 'a.png', colorspace: 'srgb', mips: true })[0]).toMatch(/mips/);
        expect(bad('a.png')[0]).toMatch(/Texture 't'/);
    });
});

describe('image textures: lowering and layers', () => {
    it('lowers each value to the RGB expression that reads its layer, and lists the read images in first-use order', () => {
        const scene = sceneWith({
            a: { model: 'lambert', albedo: { texture: 'data', uvScale: [2, 3] } },
            b: { model: 'ggx', f0: { texture: 'wood' }, roughness: 0.3 },
            c: { model: 'checker', albedo_a: { texture: 'wood', uvScale: 4 }, albedo_b: { texture: 'data' } },
        }, TEXTURES);
        const bag = new DiagnosticBag('test');
        const { scene: lowered, images } = lowerImageTextures(scene, bag);
        expect(bag.getErrors()).toEqual([]);
        expect(images).toEqual([
            { name: 'data', url: 'data.png', colorspace: 'linear' },
            { name: 'wood', url: 'wood.jpg', colorspace: 'srgb' },
        ]);
        expect(lowered.materials.a.albedo).toEqual({ kind: 'glsl', source: 'image_texture(0, uv * vec2(2.0, 3.0), false).rgb' });
        expect(lowered.materials.b.f0).toEqual({ kind: 'glsl', source: 'image_texture(1, uv, true).rgb' });
        expect(lowered.materials.c.albedo_a).toEqual({ kind: 'glsl', source: 'image_texture(1, uv * vec2(4.0, 4.0), true).rgb' });
        expect(lowered.materials.c.albedo_b).toEqual({ kind: 'glsl', source: 'image_texture(0, uv, false).rgb' });
        // The authored scene is not touched.
        expect(scene.materials.a.albedo).toEqual({ texture: 'data', uvScale: [2, 3] });
    });

    it('the scene-data plan lists the read images in layer order; a declared texture nobody reads is absent', () => {
        const scene = sceneWith({ a: { model: 'lambert', albedo: { texture: 'wood' } } }, TEXTURES);
        const { sceneData } = compiler.compileScene(scene, [imageTextureNeeStrategy]);
        expect(sceneData.images).toEqual([{ name: 'wood', url: 'wood.jpg', colorspace: 'srgb' }]);
    });

    it('a scene that declares textures but reads none has no images, no image block and no sampler', () => {
        const scene = sceneWith({ a: { model: 'lambert', albedo: 0.5 } }, TEXTURES);
        expect(compiler.compileScene(scene, [imageTextureNeeStrategy]).sceneData.images).toBeUndefined();
        const frag = fragment(scene, imageTextureNeeStrategy);
        expect(frag).not.toContain('sampler2DArray');
        expect(frag).not.toContain('image_texture(');
    });
});

describe('image textures: generated code', () => {
    it('RGB: the resolver reads the filtered texel, the uv chart is on, the sampler is declared once (highp)', () => {
        const frag = fragment(imageTextureScene, imageTextureMisStrategy);
        expect(frag).toContain('props.albedo = color_lift_reflectance(image_texture(0, uv, true).rgb, wl);');
        expect(frag).toContain('hit.uv = quad_uv(');
        expect(frag.split(SAMPLER).length - 1).toBe(1);
        expect(frag).toMatch(/vec4 image_texture\(int layer, vec2 uv, bool srgb\)/);
    });

    it('spectral: the filtered RGB is lifted as a reflectance, after the blend', () => {
        // The lift takes the value image_texture returns (already blended), never the texels.
        const frag = fragment(imageTextureScene, imageTextureSpectralStrategy);
        expect(frag).toContain('props.albedo = color_lift_reflectance(image_texture(0, uv, true).rgb, wl);');
        expect(frag).not.toMatch(/color_lift_reflectance\([^;]*texelFetch/);
    });

    it('programs without textures declare no 2D-array sampler', () => {
        expect(fragment(exprConstRef, exprTwinStrategy)).not.toContain('sampler2DArray');
    });

    it('compiles under glslang (RGB and spectral)', () => {
        glslangCheck(fragment(imageTextureScene, imageTextureMisStrategy), 'frag', 'image-texture-rgb');
        glslangCheck(fragment(imageTextureScene, imageTextureSpectralStrategy), 'frag', 'image-texture-spectral');
    });
});

describe('sampler budget', () => {
    it('counts sampler2D, usampler2D and sampler2DArray uniforms', () => {
        const source = [
            ...Array.from({ length: 15 }, (_, i) => `uniform sampler2D u_t${i};`),
            'uniform highp usampler2D u_nodes;',
            SAMPLER,
            'uniform vec3 u_color;',
        ].join('\n');
        expect(samplerRoster(source)).toHaveLength(17);
        expect(samplerRoster(source)).toContain('u_material_textures');
    });
});
