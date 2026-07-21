// authoring/loadOBJ.ts — Wavefront OBJ → MeshObject (impl-plan-meshes).
//
// The AUTHORING layer owns file formats (Authoring → App → Engine → Compiler → Components);
// the compiler never parses OBJ. parseOBJ turns OBJ text into the flat, INDEXED buffers a
// MeshObject carries: OBJ keeps separate position/uv/normal index streams, so we unify each
// distinct (v, vt, vn) corner into one output vertex (the standard OBJ → GPU-mesh dedup).
//
// v0 supported: v / vt / vn / f (triangles AND convex polygons, fan-triangulated). Negative
// (relative) indices are resolved. Groups/usemtl/smoothing are ignored (single material per
// mesh is the v0 scope — multi-material via usemtl is the deferred follow-up).

import type { MeshObject, Transform } from '../compiler/types.js';

export interface MeshAuthoring {
    material: string;
    transform?: Transform;
    name?: string;
    /** Synthesize smooth per-vertex normals (area-weighted face-normal averaging) when the
     *  OBJ carries none — a model like the Utah teapot ships position-only. Ignored if the
     *  file already has normals. Off by default (faithful → flat geometric shading). */
    smoothNormals?: boolean;
    /** Declare the mesh a SOLID (fable-mesh-containment) — Validator-proven watertight/
     *  consistently-wound/outward, then it owns an interior region (dielectric/media). */
    closed?: boolean;
}

/** Area-weighted vertex normals from an indexed triangle soup (the cross product's magnitude
 *  IS twice the triangle area, so accumulating the raw cross weights by area for free). */
function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
    const n = new Float32Array(positions.length);
    for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
        const e1x = positions[ib] - positions[ia], e1y = positions[ib + 1] - positions[ia + 1], e1z = positions[ib + 2] - positions[ia + 2];
        const e2x = positions[ic] - positions[ia], e2y = positions[ic + 1] - positions[ia + 1], e2z = positions[ic + 2] - positions[ia + 2];
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        for (const i of [ia, ib, ic]) { n[i] += cx; n[i + 1] += cy; n[i + 2] += cz; }
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
        n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return n;
}

/** Parse OBJ source text into a MeshObject. Normals/UVs are included only if the file has them
 *  (absent → flat geometric normals in-shader; planar/no chart). */
export function parseOBJ(text: string, opts: MeshAuthoring): MeshObject {
    const v: number[] = [];    // flat xyz
    const vt: number[] = [];   // flat uv
    const vn: number[] = [];   // flat xyz

    const outPos: number[] = [];
    const outNrm: number[] = [];
    const outUv: number[] = [];
    const indices: number[] = [];
    const cornerMap = new Map<string, number>();
    let usedNormals = false;
    let usedUvs = false;

    // Resolve a 1-based (or negative relative) OBJ index against a stream length (# of items).
    const resolve = (raw: number, count: number): number => (raw < 0 ? count + raw : raw - 1);

    // Turn one face corner token ("v", "v/vt", "v//vn", "v/vt/vn") into a unified output index.
    const corner = (token: string): number => {
        const existing = cornerMap.get(token);
        if (existing !== undefined) return existing;
        const [vs, vts, vns] = token.split('/');
        const vi = resolve(parseInt(vs, 10), v.length / 3);
        const out = outPos.length / 3;
        outPos.push(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2]);
        if (vts !== undefined && vts !== '') {
            const ti = resolve(parseInt(vts, 10), vt.length / 2);
            outUv.push(vt[ti * 2], vt[ti * 2 + 1]);
            usedUvs = true;
        } else {
            outUv.push(0, 0);
        }
        if (vns !== undefined && vns !== '') {
            const ni = resolve(parseInt(vns, 10), vn.length / 3);
            outNrm.push(vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]);
            usedNormals = true;
        } else {
            outNrm.push(0, 0, 0);
        }
        cornerMap.set(token, out);
        return out;
    };

    for (const line of text.split('\n')) {
        const s = line.trim();
        if (s === '' || s.startsWith('#')) continue;
        const parts = s.split(/\s+/);
        const tag = parts[0];
        if (tag === 'v') {
            v.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        } else if (tag === 'vt') {
            vt.push(parseFloat(parts[1]), parseFloat(parts[2] ?? '0'));
        } else if (tag === 'vn') {
            vn.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        } else if (tag === 'f') {
            const c = parts.slice(1).map(corner);
            // Fan-triangulate a convex polygon (triangles pass through unchanged).
            for (let i = 1; i + 1 < c.length; i++) {
                indices.push(c[0], c[i], c[i + 1]);
            }
        }
        // other tags (o, g, s, usemtl, mtllib) ignored in v0
    }

    if (outPos.length === 0 || indices.length === 0) {
        throw new Error('parseOBJ: no faces found (empty or unsupported OBJ)');
    }

    const mesh: MeshObject = {
        kind: 'mesh',
        positions: new Float32Array(outPos),
        indices: new Uint32Array(indices),
        material: opts.material,
    };
    if (usedNormals) mesh.normals = new Float32Array(outNrm);
    else if (opts.smoothNormals) mesh.normals = computeVertexNormals(mesh.positions, mesh.indices);
    if (usedUvs) mesh.uvs = new Float32Array(outUv);
    if (opts.transform !== undefined) mesh.transform = opts.transform;
    if (opts.name !== undefined) mesh.name = opts.name;
    if (opts.closed !== undefined) mesh.closed = opts.closed;
    return mesh;
}

/** Fetch an OBJ file and parse it into a MeshObject. */
export async function loadOBJ(url: string, opts: MeshAuthoring): Promise<MeshObject> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`loadOBJ: failed to fetch '${url}' (${res.status})`);
    return parseOBJ(await res.text(), opts);
}
