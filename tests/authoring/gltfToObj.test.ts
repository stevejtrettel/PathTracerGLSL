// tools/gltf-to-obj.mjs: a small glTF built here (interleaved POSITION/NORMAL with a byteStride,
// an accessor byteOffset, uint16 indices, a TRS node hierarchy with a non-uniform scale, and a
// mirrored node) converts to OBJ text that parseOBJ reads back with the expected scene-space
// positions, normals (inverse transpose), uvs (v flipped to the OBJ origin), winding and texture
// names. Unsupported inputs are errors. The last block runs converter → parseOBJ → compileScene
// on a textured mesh.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain-JS module (a node tool), no types
import { gltfToObj } from '../../tools/gltf-to-obj.mjs';
import { parseOBJ } from '../../src/authoring/loadOBJ.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { SceneDescription } from '../../src/compiler/types.js';
import { imageTextureScene, imageTextureNeeStrategy } from '../witnesses/scenes/imageTextureWitness.js';

type Json = Record<string, unknown>;

/** Triangle a=(0,0,0), b=(1,0,0), c=(0,1,1): counterclockwise about its normal (0,−1,1)/√2.
 *  glTF uvs a=(0,0), b=(1,0), c=(0,1), with (0,0) at the image's upper-left corner. */
function triangleGltf(overrides: Json = {}): { gltf: Json; buffers: Uint8Array[] } {
    const s = Math.SQRT1_2;
    // View 0: interleaved [px py pz nx ny nz] × 3 (stride 24). View 1: 8 pad bytes, then uvs
    // (the accessor's byteOffset skips the pad). View 2: uint16 indices.
    const interleaved = new Float32Array([0, 0, 0, 0, -s, s, 1, 0, 0, 0, -s, s, 0, 1, 1, 0, -s, s]);
    const uvs = new Float32Array([0, 0, 0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0]);   // 3 indices + 2 pad bytes
    const bytes = new Uint8Array(72 + 32 + 8);
    bytes.set(new Uint8Array(interleaved.buffer), 0);
    bytes.set(new Uint8Array(uvs.buffer), 72);
    bytes.set(new Uint8Array(indices.buffer), 104);
    const gltf: Json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0, 2] }],
        nodes: [
            // T = (1,2,3), R = 90° about +y, uniform scale 2; its child scales y by 2.
            { translation: [1, 2, 3], rotation: [0, s, 0, s], scale: [2, 2, 2], children: [1] },
            { mesh: 0, scale: [1, 2, 1] },
            // A mirror: x → −x.
            { mesh: 0, scale: [-1, 1, 1] },
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
        materials: [{
            name: 'apple',
            pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
            normalTexture: { index: 2 },
        }],
        textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
        images: [{ uri: 'textures/apple_diff_2k.jpg' }, { uri: 'textures/apple_arm_2k.jpg' }, { uri: 'textures/apple%20nor_gl_2k.jpg' }],
        accessors: [
            { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, byteOffset: 8, componentType: 5126, count: 3, type: 'VEC2' },
            { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 72, byteStride: 24 },
            { buffer: 0, byteOffset: 72, byteLength: 32 },
            { buffer: 0, byteOffset: 104, byteLength: 6 },
        ],
        buffers: [{ uri: 'tri.bin', byteLength: bytes.length }],
        ...overrides,
    };
    return { gltf, buffers: [bytes] };
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vec = (arr: Float32Array, i: number, n = 3) => Array.from(arr.subarray(n * i, n * i + n));

function converted() {
    const { gltf, buffers } = triangleGltf();
    const result = gltfToObj(gltf, buffers);
    const mesh = parseOBJ(result.obj, { material: 'm' });
    return { result, mesh };
}

describe('gltf-to-obj: geometry', () => {
    it('carries positions through the node hierarchy (T·R·S, parent · child)', () => {
        const { mesh } = converted();
        // First instance (nodes 0 → 1): p ↦ T + 2·R_y(90°)·diag(1,2,1)·p, with R_y(90°)(x,y,z) = (z,y,−x).
        const expected = [[1, 2, 3], [1, 2, 1], [3, 6, 3]];
        // Second instance (node 2): p ↦ (−x, y, z); corners b and c are swapped (mirror winding).
        const mirrored = [[0, 0, 0], [0, 1, 1], [-1, 0, 0]];
        const tri = (t: number) => [0, 1, 2].map((k) => vec(mesh.positions, mesh.indices[3 * t + k]));
        expect(mesh.indices.length).toBe(6);
        tri(0).forEach((p, k) => p.forEach((x, i) => expect(x).toBeCloseTo(expected[k][i], 6)));
        tri(1).forEach((p, k) => p.forEach((x, i) => expect(x).toBeCloseTo(mirrored[k][i], 6)));
    });

    it('maps normals by the inverse transpose, and winding agrees with them under a mirror', () => {
        const { mesh } = converted();
        // diag(1,2,1)⁻ᵀ·(0,−1,1) ∝ (0,−1,2); rotated: (2,−1,0)/√5. (M·n would give (0,−2,1) → (1,−2,0).)
        const n0 = vec(mesh.normals!, mesh.indices[0]);
        [2 / Math.sqrt(5), -1 / Math.sqrt(5), 0].forEach((x, i) => expect(n0[i]).toBeCloseTo(x, 6));
        for (let t = 0; t < 2; t++) {
            const [a, b, c] = [0, 1, 2].map((k) => vec(mesh.positions, mesh.indices[3 * t + k]));
            const g = cross(sub(b, a), sub(c, a));
            const n = vec(mesh.normals!, mesh.indices[3 * t]);
            // Counterclockwise about the shading normal, as in the source triangle.
            expect(dot(g, n) / Math.hypot(...g)).toBeCloseTo(1, 6);
        }
    });

    it('flips v: glTF (u, v) becomes OBJ (u, 1 − v)', () => {
        const { mesh } = converted();
        // Corners a, b, c of the first instance.
        const uv = [0, 1, 2].map((k) => vec(mesh.uvs!, mesh.indices[k], 2));
        expect(uv).toEqual([[0, 1], [1, 1], [0, 0]]);
    });

    it('reads a primitive without indices or normals', () => {
        const { gltf, buffers } = triangleGltf({
            scenes: [{ nodes: [0] }],
            nodes: [{ mesh: 0 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, material: 0 }] }],
        });
        const mesh = parseOBJ(gltfToObj(gltf, buffers).obj, { material: 'm' });
        expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
        expect(mesh.normals).toBeUndefined();
        expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 1]);
    });
});

describe('gltf-to-obj: textures', () => {
    it('reports the material\'s texture files (uri-decoded) and writes them in the header', () => {
        const { result } = converted();
        expect(result.material).toBe('apple');
        expect(result.textures).toEqual({
            baseColor: 'textures/apple_diff_2k.jpg',
            metallicRoughness: 'textures/apple_arm_2k.jpg',
            normal: 'textures/apple nor_gl_2k.jpg',
        });
        expect(result.obj).toContain('# baseColor: textures/apple_diff_2k.jpg\n');
    });
});

describe('gltf-to-obj: refusals', () => {
    const refuse = (overrides: Json, pattern: RegExp) => {
        const { gltf, buffers } = triangleGltf(overrides);
        expect(() => gltfToObj(gltf, buffers)).toThrow(pattern);
    };
    const base = triangleGltf().gltf as { meshes: Array<{ primitives: Json[] }>; materials: Json[]; accessors: Json[] };
    const prim = base.meshes[0].primitives[0];

    it('refuses required extensions', () => refuse({ extensionsRequired: ['KHR_draco_mesh_compression'] }, /required extensions/));
    it('refuses non-triangle modes', () => refuse({ meshes: [{ primitives: [{ ...prim, mode: 1 }] }] }, /mode 1/));
    it('refuses morph targets', () => refuse({ meshes: [{ primitives: [{ ...prim, targets: [{ POSITION: 0 }] }] }] }, /morph/));
    it('refuses more than one material', () => refuse({
        meshes: [{ primitives: [prim, { ...prim, material: 1 }] }],
        materials: [base.materials[0], { name: 'b' }],
    }, /2 materials/));
    it('refuses a texture read through TEXCOORD_1', () => refuse({
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } } }],
    }, /TEXCOORD_1/));
    it('refuses KHR_texture_transform', () => refuse({
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { scale: [2, 2] } } } } }],
    }, /KHR_texture_transform/));
    it('refuses quantized (non-float) uvs', () => refuse({
        accessors: base.accessors.map((a, i) => (i === 2 ? { ...a, componentType: 5123, normalized: true } : a)),
    }, /TEXCOORD_0 must be 2-component float/));
});

describe('gltf-to-obj → parseOBJ → compiler', () => {
    it('a converted mesh with an image-textured albedo compiles and lists its image', () => {
        const { mesh } = converted();
        const scene: SceneDescription = {
            ...imageTextureScene,
            id: 'gltf-mesh-texture',
            textures: { diffuse: { url: 'trial/models/apple/textures/apple_diff_2k.jpg', colorspace: 'srgb' } },
            objects: [{ ...mesh, material: 'skin' }],
            materials: { skin: { model: 'lambert', albedo: { texture: 'diffuse' } } },
        };
        const compiled = new Compiler().compileScene(scene, [imageTextureNeeStrategy]);
        expect(compiled.sceneData.images?.map((i) => i.url)).toEqual(['trial/models/apple/textures/apple_diff_2k.jpg']);
        const fragment = [...compiled.renderers[0].shaders.values()].map((s) => s.fragment).join('\n');
        expect(fragment).toContain('image_texture(0, uv, true)');
    });
});
