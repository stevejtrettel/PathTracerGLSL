// demos/meshScene.ts — the first ACTUAL low-poly mesh in a scene (impl-plan-meshes v0).
//
// Two procedurally-generated meshes on a floor: a flat-shaded ICOSAHEDRON (20 faces — clearly
// a mesh, reads as a d20/gem) and a smooth ICOSPHERE (icosahedron subdivided once, 80 faces,
// per-vertex normals → barycentric-smooth shading). Side by side they show the two normal
// modes the mesh engine supports. Brute-force traversal (no BVH yet) — these are low-poly by
// design, which is exactly the point of standing the backend up before the accelerator.

import type { SceneDescription, RenderStrategy, Vec3 } from '../src/compiler/types.js';

// ---------------------------------------------------------------------------
// Icosahedron / icosphere generators
// ---------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;

// 12 vertices (cyclic perms of (0, ±1, ±φ)), normalized to the unit sphere.
const ICO_VERTS: Vec3[] = ([
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
] as Vec3[]).map(normalize);

// 20 faces, wound CCW → outward geometric normals (the standard table).
const ICO_FACES: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function normalize(v: Vec3): Vec3 {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
}
function mid(a: Vec3, b: Vec3): Vec3 {
    return normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

/** Flat-shaded icosahedron of the given radius, centred at origin. No vertex normals →
 *  the engine uses per-face geometric normals (visible facets). */
function icosahedron(radius: number): { positions: Float32Array; indices: Uint32Array } {
    const pos: number[] = [];
    const idx: number[] = [];
    // De-index per face so each facet is flat (shared vertices would be fine too — normals are
    // geometric here — but per-face keeps it explicit and mirrors how the icosphere carries normals).
    for (const f of ICO_FACES) {
        const base = pos.length / 3;
        for (const vi of f) pos.push(ICO_VERTS[vi][0] * radius, ICO_VERTS[vi][1] * radius, ICO_VERTS[vi][2] * radius);
        idx.push(base, base + 1, base + 2);
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Smooth icosphere: subdivide each icosahedron face `subdiv` times (each → 4), projecting
 *  midpoints to the sphere. Per-vertex normals = the unit position → barycentric-smooth shading. */
function icosphere(radius: number, subdiv: number): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
    let tris: [Vec3, Vec3, Vec3][] = ICO_FACES.map((f) => [ICO_VERTS[f[0]], ICO_VERTS[f[1]], ICO_VERTS[f[2]]]);
    for (let s = 0; s < subdiv; s++) {
        const next: [Vec3, Vec3, Vec3][] = [];
        for (const [a, b, c] of tris) {
            const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
            next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
        }
        tris = next;
    }
    // Dedup vertices (unit-sphere points) so smooth normals average correctly across facets.
    const pos: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const map = new Map<string, number>();
    const vert = (v: Vec3): number => {
        const key = `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
        const hit = map.get(key);
        if (hit !== undefined) return hit;
        const id = pos.length / 3;
        pos.push(v[0] * radius, v[1] * radius, v[2] * radius);
        nrm.push(v[0], v[1], v[2]);   // unit position = smooth normal
        map.set(key, id);
        return id;
    };
    for (const [a, b, c] of tris) idx.push(vert(a), vert(b), vert(c));
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

const gem = icosahedron(0.85);
const ball = icosphere(0.85, 1);   // 80 faces

export const meshDemoScene: SceneDescription = {
    id: 'meshes',
    name: 'Meshes (icosahedron + icosphere)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Floor — an analytic quad (the mesh objects are the stars; the floor is closed-form).
        { type: 'quad', parameters: { corner: [-6, 0, -6], edge1: [0, 0, 12], edge2: [12, 0, 0] }, material: 'floor' },
        // Flat-shaded d20 on the left.
        { kind: 'mesh', positions: gem.positions, indices: gem.indices, material: 'gem', name: 'gem',
          transform: { position: [-1.15, 0.85, 0] } },
        // Smooth icosphere on the right.
        { kind: 'mesh', positions: ball.positions, indices: ball.indices, normals: ball.normals, material: 'ball', name: 'ball',
          transform: { position: [1.15, 0.85, 0] } },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
        gem: { model: 'lambert', albedo: [0.85, 0.35, 0.25] },
        ball: { model: 'lambert', albedo: [0.30, 0.55, 0.85] },
    },
    lights: [
        { kind: 'point', position: [3, 5, 3], emission: 60 },
    ],
    environment: { type: 'constant', color: [0.12, 0.16, 0.28], intensity: 1.0 },
};

export const meshDemoNeeStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.7 }, maxBounces: 6 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const meshDemoPtStrategy: RenderStrategy = {
    ...meshDemoNeeStrategy,
    id: 'pt',
    estimator: { ...meshDemoNeeStrategy.estimator, directLighting: 'none' },
};
