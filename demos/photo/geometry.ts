// demos/photo/geometry.ts — triangle meshes built from parametric surfaces for the photo scenes.
//
// Every builder samples a map (s, t) ↦ P(s, t) on a regular grid and returns positions, smooth
// per-vertex normals and indices. Normals are the unit cross product ∂P/∂s × ∂P/∂t, taken by
// central differences of the map itself (not by averaging faces), so shading is exactly as smooth
// as the surface. Triangles are wound so that (b − a) × (c − a) points along that normal.
//
// A grid that is periodic in a parameter (a tube around a closed curve, a torus) shares the seam
// vertices, so the mesh is watertight and can be declared `closed`. Lengths are meters.

import type { MeshObject, Vec3 } from '../../src/compiler/types.js';

type Map2 = (s: number, t: number) => Vec3;

export interface MeshArrays {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};

/**
 * Grid mesh of P over [s0, s1] × [t0, t1] with ns × nt cells. `periodicS` / `periodicT` mark a
 * parameter whose ends are the same points: the last column (row) then reuses the first one's
 * vertices. `flip` reverses the orientation (normals and winding together).
 */
export function gridMesh(
    P: Map2,
    [s0, s1]: [number, number], ns: number, periodicS: boolean,
    [t0, t1]: [number, number], nt: number, periodicT: boolean,
    flip = false,
): MeshArrays {
    const cs = periodicS ? ns : ns + 1;
    const ct = periodicT ? nt : nt + 1;
    const hs = (s1 - s0) * 1e-4, ht = (t1 - t0) * 1e-4;
    const pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < cs; i++) {
        const s = s0 + ((s1 - s0) * i) / ns;
        for (let j = 0; j < ct; j++) {
            const t = t0 + ((t1 - t0) * j) / nt;
            const p = P(s, t);
            const ds = sub(P(s + hs, t), P(s - hs, t));
            const dt = sub(P(s, t + ht), P(s, t - ht));
            let n = unit(cross(ds, dt));
            if (flip) n = [-n[0], -n[1], -n[2]];
            pos.push(...p);
            nrm.push(...n);
        }
    }
    const id = (i: number, j: number) => (i % cs) * ct + (j % ct);
    const idx: number[] = [];
    for (let i = 0; i < ns; i++) {
        for (let j = 0; j < nt; j++) {
            const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
            // (b − a) ~ ∂P/∂s and (d − a) ~ ∂P/∂t, so a, b, d winds along ∂s × ∂t.
            if (flip) idx.push(a, d, b, b, d, c);
            else idx.push(a, b, d, b, c, d);
        }
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/** A mesh object from arrays (one material; the scene places it with `transform`). */
export function meshObject(m: MeshArrays, material: string, name: string, extra: Partial<MeshObject> = {}): MeshObject {
    return { kind: 'mesh', positions: m.positions, normals: m.normals, indices: m.indices, material, name, ...extra };
}

/**
 * A photographer's paper sweep: a flat floor running from z = `front` back to z = 0, a
 * quarter-circle cove of radius `cove` bending up, and a vertical wall from y = cove to
 * y = `height` at z = −cove. It spans x ∈ [−width/2, width/2]; the paper faces +y on the floor
 * and +z on the wall (toward a camera on the +z side).
 */
export function paperSweep(width: number, front: number, cove: number, height: number): MeshArrays {
    const floorLen = front, arcLen = (Math.PI / 2) * cove, wallLen = height - cove;
    const total = floorLen + arcLen + wallLen;
    // Arc length u along the profile, from the front edge of the floor to the top of the wall.
    const profile = (u: number): [number, number] => {
        if (u <= floorLen) return [0, front - u];
        if (u <= floorLen + arcLen) {
            const a = (u - floorLen) / cove;   // angle swept up the cove
            return [cove - cove * Math.cos(a), -cove * Math.sin(a)];
        }
        return [cove + (u - floorLen - arcLen), -cove];
    };
    // s runs along x, t along the profile: ∂s × ∂t = x̂ × (0, 0, −1) = +y on the floor and
    // x̂ × ŷ = +z on the wall.
    const P: Map2 = (s, t) => {
        const [y, z] = profile(Math.min(Math.max(t, 0), total));
        return [s, y, z];
    };
    return gridMesh(P, [-width / 2, width / 2], 8, false, [0, total], 160, false);
}

/**
 * A round tube of radius `r` around a closed curve C(t), t ∈ [0, 2π), with a rotation-minimizing
 * frame (double reflection, Wang et al. 2008) closed up by spreading the holonomy over the curve.
 * The mesh is watertight with outward normals.
 */
export function tubeMesh(C: (t: number) => Vec3, r: number, nAlong: number, nAround: number): MeshArrays {
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const tangent = (t: number): Vec3 => unit(sub(C(t + 1e-4), C(t - 1e-4)));
    const N = nAlong;
    const ts = Array.from({ length: N + 1 }, (_, i) => (2 * Math.PI * i) / N);
    const pts = ts.map(C), tans = ts.map(tangent);
    // Initial normal: any unit vector perpendicular to the first tangent.
    const t0 = tans[0];
    const seed: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const rs: Vec3[] = [unit(sub(seed, t0.map((x) => x * dot(seed, t0)) as Vec3))];
    for (let i = 0; i < N; i++) {
        const v1 = sub(pts[i + 1], pts[i]);
        const c1 = dot(v1, v1);
        const rL = sub(rs[i], v1.map((x) => (2 / c1) * dot(v1, rs[i]) * x) as Vec3);
        const tL = sub(tans[i], v1.map((x) => (2 / c1) * dot(v1, tans[i]) * x) as Vec3);
        const v2 = sub(tans[i + 1], tL);
        const c2 = dot(v2, v2);
        rs.push(c2 > 0 ? sub(rL, v2.map((x) => (2 / c2) * dot(v2, rL) * x) as Vec3) : rL);
    }
    // Holonomy: the angle from the transported end frame back to the start frame.
    const sEnd = cross(tans[N], rs[N]);
    const twist = Math.atan2(dot(rs[0], sEnd), dot(rs[0], rs[N]));
    const frame = (t: number): { p: Vec3; n: Vec3; b: Vec3 } => {
        const f = ((t / (2 * Math.PI)) * N) % N;
        const i = Math.floor(f);
        const w = f - i;
        // Interpolate the transported normal between samples, then re-orthogonalize.
        const tt = tangent(t);
        let n = unit(rs[i].map((x, k) => x * (1 - w) + rs[i + 1][k] * w) as Vec3);
        n = unit(sub(n, tt.map((x) => x * dot(n, tt)) as Vec3));
        let b = cross(tt, n);
        const a = (twist * t) / (2 * Math.PI);
        const ca = Math.cos(a), sa = Math.sin(a);
        [n, b] = [n.map((x, k) => ca * x + sa * b[k]) as Vec3, b.map((x, k) => -sa * n[k] + ca * x) as Vec3];
        return { p: C(t), n, b };
    };
    // s along the curve, u around it: with (tangent, n, b) right-handed, ∂s × ∂u is a positive
    // multiple of −(n cos u + b sin u), the inward normal, so the grid is flipped.
    const P: Map2 = (s, u) => {
        const { p, n, b } = frame(((s % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
        return [0, 1, 2].map((k) => p[k] + r * (Math.cos(u) * n[k] + Math.sin(u) * b[k])) as Vec3;
    };
    return gridMesh(P, [0, 2 * Math.PI], nAlong, true, [0, 2 * Math.PI], nAround, true, true);
}

/**
 * The "bottle" immersion of the Klein bottle (the glass-blower's shape), from the closed form
 * popularized by Robert Israel: u ∈ [0, π), v ∈ [0, 2π). It spans y ∈ [0, 4.21], x ∈ [−1.52, 1.82]
 * and z ∈ [−0.73, 0.73] in the formula's units; u = 0 is a ring of radius 0.4 on y = 0 (the base).
 * The caller scales and places it. The surface is non-orientable and
 * self-intersecting, so it is only usable as a thin sheet (not `closed`).
 */
export function kleinBottle(nu: number, nv: number): MeshArrays {
    const P: Map2 = (u, v) => {
        const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
        const x = -(2 / 15) * cu * (3 * cv - 30 * su + 90 * cu ** 4 * su - 60 * cu ** 6 * su + 5 * cu * cv * su);
        const y = -(1 / 15) * su * (3 * cv - 3 * cu ** 2 * cv - 48 * cu ** 4 * cv + 48 * cu ** 6 * cv - 60 * su
            + 5 * cu * cv * su - 5 * cu ** 3 * cv * su - 80 * cu ** 5 * cv * su + 80 * cu ** 7 * cv * su);
        const z = (2 / 15) * (3 + 5 * cu * su) * sv;
        return [x, y, z];
    };
    return gridMesh(P, [0, Math.PI], nu, false, [0, 2 * Math.PI], nv, true);
}
