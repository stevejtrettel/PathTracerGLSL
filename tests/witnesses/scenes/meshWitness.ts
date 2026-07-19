// tests/witnesses/scenes/meshWitness.ts — mesh backend witnesses (impl-plan-meshes).
//
// Two gates:
//  - mesh-furnace: a CLOSED box authored as a triangle mesh (inward normals) with the F-BOX
//    furnace material → the exact 0.4 energy number, now through the mesh engine + emissive-mesh
//    path (region_to = owner on a front hit). The sharpest single gate; any energy leak in
//    mesh intersection / shading / emission shows as ≠ 0.4.
//  - mesh-quad-twin ⇄ mesh-quad-ref: the SAME floor+blocker geometry authored as a triangle
//    mesh vs as analytic quads → must converge to the same image (cross-backend twin, the
//    analytic-minimal discipline). Exercises primary hits, Lambert shading, and NEE occlusion
//    (mesh_intersect_any casts the shadow of the blocker onto the floor).

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { furnaceStrategy } from './furnaceBox.js';
import { withPose } from '../../../src/authoring/strategy.js';

// ---------------------------------------------------------------------------
// Geometry helpers (winding is the correctness-critical part — kept in one place)
// ---------------------------------------------------------------------------

/** Append a quad [C, C+e1, C+e1+e2, C+e2] as two triangles whose geometric normal is
 *  cross(e1, e2) — the SAME convention as the analytic `quad` primitive, so a mesh face and
 *  an analytic quad with matching (corner, edge1, edge2) shade identically. */
function pushQuad(pos: number[], idx: number[], c: number[], e1: number[], e2: number[]): void {
    const base = pos.length / 3;
    const C = c, C1 = add(c, e1), C12 = add(add(c, e1), e2), C2 = add(c, e2);
    pos.push(...C, ...C1, ...C12, ...C2);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function add(a: number[], b: number[]): number[] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

/** Axis-aligned cube [-h,h]³ as 12 triangles. Each face's (edge1, edge2) are ordered so
 *  cross(edge1, edge2) is the OUTWARD normal; `inward` reverses winding (flips every normal),
 *  giving the furnace's inward-facing faces. Verified by the winding scratch check. */
function boxMesh(h: number, inward: boolean): { positions: Float32Array; indices: Uint32Array } {
    const pos: number[] = [];
    const idx: number[] = [];
    // corner, e1, e2 per face — cross(e1,e2) = OUTWARD normal (see table in the plan).
    const faces: Array<[number[], number[], number[]]> = [
        [[h, -h, -h], [0, 2 * h, 0], [0, 0, 2 * h]],    // +X
        [[-h, -h, h], [0, 2 * h, 0], [0, 0, -2 * h]],   // -X
        [[-h, h, -h], [0, 0, 2 * h], [2 * h, 0, 0]],    // +Y
        [[-h, -h, -h], [2 * h, 0, 0], [0, 0, 2 * h]],   // -Y
        [[-h, -h, h], [2 * h, 0, 0], [0, 2 * h, 0]],    // +Z
        [[h, -h, -h], [-2 * h, 0, 0], [0, 2 * h, 0]],   // -Z
    ];
    for (const [c, e1, e2] of faces) {
        // inward = reverse the two in-plane edges → cross flips sign → inward normal.
        if (inward) pushQuad(pos, idx, c, e2, e1);
        else pushQuad(pos, idx, c, e1, e2);
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// ---------------------------------------------------------------------------
// mesh-furnace — F-BOX through the mesh engine (mean 0.4 exactly)
// ---------------------------------------------------------------------------

const furnaceCube = boxMesh(1.0, /*inward*/ true);

export const meshFurnace: SceneDescription = {
    id: 'mesh-furnace',
    name: 'Mesh Furnace (F-BOX via triangle mesh)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'mesh', positions: furnaceCube.positions, indices: furnaceCube.indices, material: 'furnace', name: 'furnace_cube' },
    ],
    materials: {
        // ρ = 0.5, Le = 0.2 → L = 0.2 / (1 − 0.5) = 0.4 exactly (identical to furnaceBox).
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
    },
    lights: [],
    environment: { type: 'none' },
};

// Reuse the furnace estimator (directLighting none, 16 bounces, no RR); camera is at the
// origin inside the cube (furnaceStrategy's default pose), looking down -z.
export const meshFurnaceStrategy: RenderStrategy = { ...furnaceStrategy, id: 'mesh-furnace' };

// ---------------------------------------------------------------------------
// mesh-quad-twin — floor + floating blocker: mesh vs analytic quads
// ---------------------------------------------------------------------------

// Floor at y=-1, normal +y (cross(+z, +x) = +y). Blocker at y=0.2, normal +y, small.
const FLOOR = { c: [-2, -1, -2], e1: [0, 0, 4], e2: [4, 0, 0] };
const BLOCKER = { c: [-0.5, 0.2, -0.5], e1: [0, 0, 1], e2: [1, 0, 0] };

function twinMesh(): { positions: Float32Array; indices: Uint32Array } {
    const pos: number[] = [];
    const idx: number[] = [];
    pushQuad(pos, idx, FLOOR.c, FLOOR.e1, FLOOR.e2);
    pushQuad(pos, idx, BLOCKER.c, BLOCKER.e1, BLOCKER.e2);
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

const twinGeom = twinMesh();

const twinMaterials: SceneDescription['materials'] = { diffuse: { model: 'lambert', albedo: [0.7, 0.7, 0.7] } };
const twinLights: SceneDescription['lights'] = [{ kind: 'point', position: [0.6, 3.0, 0.6], emission: 40 }];
const twinEnv: SceneDescription['environment'] = { type: 'constant', color: [0.04, 0.05, 0.08], intensity: 1.0 };

export const meshQuadTwin: SceneDescription = {
    id: 'mesh-quad-twin',
    name: 'Mesh Quad Twin (floor + blocker as a triangle mesh)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'mesh', positions: twinGeom.positions, indices: twinGeom.indices, material: 'diffuse', name: 'floor_blocker' },
    ],
    materials: twinMaterials,
    lights: twinLights,
    environment: twinEnv,
};

export const meshQuadRef: SceneDescription = {
    id: 'mesh-quad-ref',
    name: 'Mesh Quad Ref (same geometry as analytic quads)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: FLOOR.c, edge1: FLOOR.e1, edge2: FLOOR.e2 }, material: 'diffuse' },
        { type: 'quad', parameters: { corner: BLOCKER.c, edge1: BLOCKER.e1, edge2: BLOCKER.e2 }, material: 'diffuse' },
    ],
    materials: twinMaterials,
    lights: twinLights,
    environment: twinEnv,
};

const meshTwinBase: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// Look down at the floor from the front so the blocker's shadow is visible.
export const meshTwinStrategy: RenderStrategy = withPose(meshTwinBase, [0, 2.2, 4.5], [0, -0.6, 0]);
