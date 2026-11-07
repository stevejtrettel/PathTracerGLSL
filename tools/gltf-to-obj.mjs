// glTF 2.0 (.gltf + external .bin) → Wavefront OBJ, for src/authoring/loadOBJ.ts.
//
// Usage: node tools/gltf-to-obj.mjs <in.gltf> <out.obj>
//
// What is written: one OBJ holding every triangle primitive reachable from the glTF's default
// scene, with positions and normals carried into scene space by each node's global transform,
// TEXCOORD_0 as `vt`, and the material's texture file names (relative to the .gltf) as header
// comments. Conventions it converts:
//   - uv origin: glTF puts (0,0) at the image's upper-left corner (glTF 2.0 spec §3.8.4, "Texture
//     coordinates"); OBJ and this renderer's image fetch (pbrt's t = 1 − v) put it at the
//     lower-left. So vt = (u, 1 − v).
//   - node transforms: local = T·R·S (or `matrix`, column-major), global = parent · local.
//     Positions map by the global matrix M, normals by (M⁻¹)ᵀ, renormalized.
//   - winding: glTF's front faces are counterclockwise when det M > 0 and clockwise when
//     det M < 0 (spec §3.7.4); OBJ's are counterclockwise, so a primitive under a mirroring
//     transform has each triangle's last two corners swapped.
// What is refused (an error, never a guess): required extensions, non-triangle-list modes,
// skins and morph targets, sparse or non-float attribute accessors, embedded (data:) buffers,
// textures read through a texCoord other than 0, more than one material (loadOBJ gives a mesh
// one material), primitives with and without a material, and a primitive without TEXCOORD_0 when
// another primitive has it or the material has textures (parseOBJ would give its corners uv (0, 0)).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const INDEX_TYPES = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };
const FLOAT = 5126;
const TRIANGLES = 4;

/** 4×4 column-major product a·b. */
function mul(a, b) {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
    }
    return r;
}

/** A node's local matrix: `matrix` as given, else T·R·S from the unit quaternion (x, y, z, w). */
function localMatrix(node) {
    if (node.matrix) return node.matrix.slice();
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale ?? [1, 1, 1];
    // Rotation columns of the quaternion's matrix, each scaled by its axis' scale factor.
    return [
        (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
        (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
        (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
        tx, ty, tz, 1,
    ];
}

/** The upper-left 3×3 of a column-major 4×4 as rows [[m00, m01, m02], …]. */
function linearPart(m) {
    return [0, 1, 2].map((row) => [0, 1, 2].map((col) => m[col * 4 + row]));
}

/** Inverse transpose of a 3×3 (rows), via cofactors: (A⁻¹)ᵀ = cof(A) / det A. */
function normalMatrix(a) {
    const cof = (r, c) => {
        const rs = [0, 1, 2].filter((i) => i !== r), cs = [0, 1, 2].filter((i) => i !== c);
        const minor = a[rs[0]][cs[0]] * a[rs[1]][cs[1]] - a[rs[0]][cs[1]] * a[rs[1]][cs[0]];
        return (r + c) % 2 === 0 ? minor : -minor;
    };
    const C = [0, 1, 2].map((r) => [0, 1, 2].map((c) => cof(r, c)));
    const det = a[0][0] * C[0][0] + a[0][1] * C[0][1] + a[0][2] * C[0][2];
    if (det === 0) throw new Error('gltf-to-obj: a node transform is singular');
    return { n: C.map((row) => row.map((v) => v / det)), det };
}

/** Read an accessor as a flat array (typed by componentType), honoring byteStride. */
function readAccessor(gltf, buffers, index, what) {
    const acc = gltf.accessors[index];
    if (acc.sparse) throw new Error(`gltf-to-obj: ${what}: sparse accessors are not supported`);
    if (acc.bufferView === undefined) throw new Error(`gltf-to-obj: ${what}: accessor has no bufferView`);
    const n = COMPONENTS[acc.type];
    const view = gltf.bufferViews[acc.bufferView];
    const Type = acc.componentType === FLOAT ? Float32Array : INDEX_TYPES[acc.componentType];
    if (!Type) throw new Error(`gltf-to-obj: ${what}: componentType ${acc.componentType} is not supported`);
    const elem = n * Type.BYTES_PER_ELEMENT;
    const stride = view.byteStride ?? elem;
    const buf = buffers[view.buffer];
    const base = buf.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const dv = new DataView(buf.buffer);
    const out = new Type(acc.count * n);
    for (let i = 0; i < acc.count; i++) for (let k = 0; k < n; k++) {
        const at = base + i * stride + k * Type.BYTES_PER_ELEMENT;
        out[i * n + k] = Type === Float32Array ? dv.getFloat32(at, true)
            : Type === Uint8Array ? dv.getUint8(at)
            : Type === Uint16Array ? dv.getUint16(at, true) : dv.getUint32(at, true);
    }
    return { data: out, n, componentType: acc.componentType };
}

/** A float attribute (POSITION, NORMAL, TEXCOORD_0) with the expected component count. */
function floatAttribute(gltf, buffers, index, n, what) {
    const a = readAccessor(gltf, buffers, index, what);
    if (a.componentType !== FLOAT || a.n !== n) {
        throw new Error(`gltf-to-obj: ${what} must be ${n}-component float (componentType ${a.componentType}, ${a.n} components)`);
    }
    return a.data;
}

/** Float32 values print with 9 significant digits, which round-trips them exactly. */
const f = (x) => String(+Math.fround(x).toPrecision(9));

/**
 * Convert a parsed glTF and its buffers (bytes of each `buffers[i]`, in order) to OBJ text.
 * Returns { obj, material, textures }, where textures maps baseColor / metallicRoughness /
 * normal to image uris relative to the .gltf (only the ones the material has).
 */
export function gltfToObj(gltf, buffers) {
    if (gltf.extensionsRequired?.length) {
        throw new Error(`gltf-to-obj: required extensions are not supported: ${gltf.extensionsRequired.join(', ')}`);
    }
    const sceneIndex = gltf.scene ?? 0;
    const roots = gltf.scenes?.[sceneIndex]?.nodes;
    if (!roots) throw new Error('gltf-to-obj: the file has no scene');

    const lines = [];
    const materials = new Set();   // each primitive's material index; undefined for none
    const withoutUv = [];           // primitives with no TEXCOORD_0
    let anyUv = false;
    let nv = 0, nt = 0, nn = 0;   // OBJ stream lengths so far (indices are 1-based)

    const visit = (nodeIndex, parent) => {
        const node = gltf.nodes[nodeIndex];
        const world = mul(parent, localMatrix(node));
        if (node.skin !== undefined) throw new Error(`gltf-to-obj: node ${nodeIndex} is skinned`);
        if (node.mesh !== undefined) {
            const mesh = gltf.meshes[node.mesh];
            const A = linearPart(world);
            const { n: N, det } = normalMatrix(A);
            mesh.primitives.forEach((prim, p) => {
                const what = `mesh ${node.mesh} primitive ${p}`;
                if ((prim.mode ?? TRIANGLES) !== TRIANGLES) throw new Error(`gltf-to-obj: ${what}: mode ${prim.mode} is not a triangle list`);
                if (prim.targets?.length) throw new Error(`gltf-to-obj: ${what}: morph targets are not supported`);
                if (prim.attributes.POSITION === undefined) throw new Error(`gltf-to-obj: ${what}: no POSITION`);
                materials.add(prim.material);
                const P = floatAttribute(gltf, buffers, prim.attributes.POSITION, 3, `${what} POSITION`);
                const Nrm = prim.attributes.NORMAL === undefined ? null
                    : floatAttribute(gltf, buffers, prim.attributes.NORMAL, 3, `${what} NORMAL`);
                const T = prim.attributes.TEXCOORD_0 === undefined ? null
                    : floatAttribute(gltf, buffers, prim.attributes.TEXCOORD_0, 2, `${what} TEXCOORD_0`);
                if (T) anyUv = true; else withoutUv.push(what);
                const count = P.length / 3;
                for (let i = 0; i < count; i++) {
                    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
                    lines.push(`v ${[0, 1, 2].map((r) => f(A[r][0] * x + A[r][1] * y + A[r][2] * z + world[12 + r])).join(' ')}`);
                }
                if (T) for (let i = 0; i < count; i++) lines.push(`vt ${f(T[2 * i])} ${f(1 - T[2 * i + 1])}`);
                if (Nrm) for (let i = 0; i < count; i++) {
                    const x = Nrm[3 * i], y = Nrm[3 * i + 1], z = Nrm[3 * i + 2];
                    const m = [0, 1, 2].map((r) => N[r][0] * x + N[r][1] * y + N[r][2] * z);
                    const len = Math.hypot(m[0], m[1], m[2]);
                    lines.push(`vn ${m.map((c) => f(c / len)).join(' ')}`);
                }
                const idx = prim.indices === undefined
                    ? Uint32Array.from({ length: count }, (_, i) => i)
                    : readAccessor(gltf, buffers, prim.indices, `${what} indices`).data;
                if (idx.length % 3 !== 0) throw new Error(`gltf-to-obj: ${what}: index count ${idx.length} is not a multiple of 3`);
                const corner = (i) => `${nv + i + 1}/${T ? nt + i + 1 : ''}${Nrm ? `/${nn + i + 1}` : ''}`.replace(/\/$/, '');
                for (let t = 0; t < idx.length; t += 3) {
                    const [a, b, c] = det > 0 ? [idx[t], idx[t + 1], idx[t + 2]] : [idx[t], idx[t + 2], idx[t + 1]];
                    lines.push(`f ${corner(a)} ${corner(b)} ${corner(c)}`);
                }
                nv += count;
                if (T) nt += count;
                if (Nrm) nn += count;
            });
        }
        for (const child of node.children ?? []) visit(child, world);
    };
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const r of roots) visit(r, identity);
    if (nv === 0) throw new Error('gltf-to-obj: the scene has no triangle primitives');
    if (materials.has(undefined) && materials.size > 1) {
        throw new Error('gltf-to-obj: primitives with and without a material (the ones without would take the other\'s textures)');
    }
    if (materials.size > 1) {
        throw new Error(`gltf-to-obj: ${materials.size} materials (loadOBJ gives a mesh one material)`);
    }

    const textures = {};
    const [materialIndex] = materials;
    const material = materialIndex === undefined ? undefined : gltf.materials[materialIndex];
    if (material) {
        const slots = {
            baseColor: material.pbrMetallicRoughness?.baseColorTexture,
            metallicRoughness: material.pbrMetallicRoughness?.metallicRoughnessTexture,
            normal: material.normalTexture,
        };
        for (const [role, info] of Object.entries(slots)) {
            if (!info) continue;
            if ((info.texCoord ?? 0) !== 0) throw new Error(`gltf-to-obj: the ${role} texture reads TEXCOORD_${info.texCoord}`);
            if (info.extensions?.KHR_texture_transform) throw new Error(`gltf-to-obj: the ${role} texture has KHR_texture_transform`);
            const uri = gltf.images[gltf.textures[info.index].source].uri;
            if (uri === undefined) throw new Error(`gltf-to-obj: the ${role} image is embedded (no uri)`);
            textures[role] = decodeURIComponent(uri);
        }
    }
    if (withoutUv.length && (anyUv || Object.keys(textures).length)) {
        throw new Error(`gltf-to-obj: ${withoutUv.join(', ')} without TEXCOORD_0, but ${anyUv ? 'another primitive has it' : 'the material has textures'} (parseOBJ would give its corners uv (0, 0))`);
    }
    const header = [
        '# Converted by tools/gltf-to-obj.mjs: vt = (u, 1 - v) of glTF TEXCOORD_0.',
        ...(material ? [`# material: ${material.name ?? '(unnamed)'}`] : []),
        ...Object.entries(textures).map(([role, uri]) => `# ${role}: ${uri}`),
    ];
    return { obj: `${[...header, ...lines].join('\n')}\n`, material: material?.name, textures };
}

/** Convert <in.gltf> (buffers as files beside it) to <out.obj>; returns gltfToObj's result. */
export function convertFile(gltfPath, objPath) {
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));
    const buffers = (gltf.buffers ?? []).map((b, i) => {
        if (b.uri === undefined || b.uri.startsWith('data:')) {
            throw new Error(`gltf-to-obj: buffer ${i} is embedded; only external .bin buffers are supported`);
        }
        const bytes = readFileSync(join(dirname(gltfPath), decodeURIComponent(b.uri)));
        if (bytes.length < b.byteLength) throw new Error(`gltf-to-obj: buffer ${i} has ${bytes.length} bytes, expected ${b.byteLength}`);
        return bytes;
    });
    const result = gltfToObj(gltf, buffers);
    writeFileSync(objPath, result.obj);
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [inPath, outPath] = process.argv.slice(2);
    if (!inPath || !outPath) {
        console.error('usage: node tools/gltf-to-obj.mjs <in.gltf> <out.obj>');
        process.exit(1);
    }
    const { textures, material } = convertFile(inPath, outPath);
    console.log(`wrote ${outPath} (material ${material ?? 'none'})`);
    for (const [role, uri] of Object.entries(textures)) console.log(`  ${role}: ${uri}`);
}
