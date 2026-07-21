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
export function boxMesh(h: number, inward: boolean): { positions: Float32Array; indices: Uint32Array } {
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

// ---------------------------------------------------------------------------
// Containment witnesses (fable-mesh-containment §7): a CLOSED cube mesh must behave
// exactly like the same cube authored as an SDF box — the exact-geometry cross-backend
// twin discipline, applied to the three things containment unlocks:
//   mesh-glass-box  — a dielectric interior (ior_of row + the exit-hit classification)
//   mesh-fog        — an interior medium behind a null interface (the medium walker)
//   mesh-submerged  — innermost-wins ORDERING (the closed mesh nested inside water —
//                     the closest-distance query's |d| ranks the containers)
// ---------------------------------------------------------------------------

const solidCube = boxMesh(0.7, /*inward*/ false);

const containFloor = { type: 'quad', parameters: { corner: [-4, 0, -4], edge1: [0, 0, 8], edge2: [8, 0, 0] }, material: 'floor' };
const containMaterials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.6, 0.6, 0.62] },
    glass: { model: 'dielectric', ior: 1.5 },
    fog: { model: 'none', medium: { sigma_a: [1.2, 0.7, 0.4] } },
    water: { model: 'dielectric', ior: 1.33 },
};
const containLights: SceneDescription['lights'] = [{ kind: 'point', position: [2.5, 4.5, 2.5], emission: 50 }];
const containEnv: SceneDescription['environment'] = { type: 'constant', color: [0.35, 0.42, 0.55], intensity: 1.0 };

/** Scene pair builder: the centerpiece as a closed cube MESH vs the same cube as an SDF box. */
function containPair(id: string, name: string, material: string, extra: SceneDescription['objects'] = []): { mesh: SceneDescription; ref: SceneDescription } {
    const common = { ambientSpace: { type: 'euclidean' } as const, materials: containMaterials, lights: containLights, environment: containEnv };
    return {
        mesh: {
            id, name, ...common,
            objects: [
                containFloor,
                { kind: 'mesh', positions: solidCube.positions, indices: solidCube.indices, material, closed: true, transform: { position: [0, 0.75, 0] as [number, number, number] }, name: 'cube' },
                ...extra,
            ],
        },
        ref: {
            id: `${id}-ref`, name: `${name} Ref (SDF box)`, ...common,
            objects: [
                containFloor,
                { type: 'box', parameters: { center: [0, 0.75, 0], halfSize: [0.7, 0.7, 0.7] }, material },
                ...extra,
            ],
        },
    };
}

export const meshGlassPair = containPair('mesh-glass-box', 'Mesh Glass Box (closed mesh dielectric)', 'glass');
export const meshFogPair = containPair('mesh-fog', 'Mesh Fog Box (interior medium in a closed mesh)', 'fog');
// Submerged: the closed cube (glass) INSIDE a water sphere — the R-SUBMERGED exercise with
// a mesh as the inner region (innermost-wins must rank mesh-vs-sphere by |d|).
const waterSphere = { type: 'sphere', parameters: { center: [0, 0.9, 0], radius: 1.6 }, material: 'water' };
export const meshSubmergedPair = {
    mesh: {
        ...containPair('mesh-submerged', 'Mesh Submerged (closed mesh inside water)', 'glass').mesh,
        objects: [
            containFloor,
            waterSphere,
            { kind: 'mesh' as const, positions: solidCube.positions, indices: solidCube.indices, material: 'glass', closed: true, transform: { position: [0, 0.9, 0] as [number, number, number], scale: 0.6 }, name: 'cube' },
        ],
    },
    ref: {
        ...containPair('mesh-submerged', 'x', 'glass').ref,
        id: 'mesh-submerged-ref', name: 'Mesh Submerged Ref (SDF box inside water)',
        objects: [
            containFloor,
            waterSphere,
            { type: 'box' as const, parameters: { center: [0, 0.9, 0], halfSize: [0.42, 0.42, 0.42] }, material: 'glass' },
        ],
    },
};

const containBase: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.85 }, maxBounces: 10 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const containStrategy: RenderStrategy = withPose(containBase, [1.8, 2.2, 3.6], [0, 0.75, 0]);

// ---------------------------------------------------------------------------
// mesh-light-twin ⇄ mesh-light-ref — the mesh AREA LIGHT (fable-mesh-lights §7).
//
// An emissive TWO-TRIANGLE mesh panel with identical corner/edges/Le vs the analytic
// quad (both via the sampleAsLight material route) — an EXACT cross-kind twin: the
// mesh kind's CDF sampler, identity-free pdf (r²/(cosθ·A_total)), and power formula
// must all agree with the quad's closed forms, under pt-nee, pt-mis, AND pt. The
// panel faces DOWN (cross(e1,e2) = −y — the one-sided pin, same convention both kinds).
// ---------------------------------------------------------------------------

const PANEL = { c: [-0.75, 2.49, -0.75], e1: [1.5, 0, 0], e2: [0, 0, 1.5] };   // cross(e1,e2) = (0,−2.25,0) ↓

function panelMesh(): { positions: Float32Array; indices: Uint32Array } {
    const pos: number[] = [];
    const idx: number[] = [];
    pushQuad(pos, idx, PANEL.c, PANEL.e1, PANEL.e2);
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
const panelGeom = panelMesh();

const lampMaterials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.62, 0.62, 0.64] },
    ball: { model: 'lambert', albedo: [0.75, 0.45, 0.3] },
    lamp: { model: 'lambert', albedo: [0.78, 0.78, 0.78], emission: [5, 5, 5] },   // sampleAsLight defaults ON
};
const lampObjects: SceneDescription['objects'] = [
    { type: 'quad', parameters: { corner: [-4, 0, -4], edge1: [0, 0, 8], edge2: [8, 0, 0] }, material: 'floor' },
    { type: 'sphere', parameters: { center: [0, 0.6, 0], radius: 0.6 }, material: 'ball' },
];

export const meshLightTwin: SceneDescription = {
    id: 'mesh-light-twin',
    name: 'Mesh Light Twin (emissive 2-triangle panel)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        ...lampObjects,
        { kind: 'mesh', positions: panelGeom.positions, indices: panelGeom.indices, material: 'lamp', name: 'panel' },
    ],
    materials: lampMaterials,
    lights: [],
    environment: { type: 'none' },
};

export const meshLightRef: SceneDescription = {
    id: 'mesh-light-ref',
    name: 'Mesh Light Ref (analytic quad emitter)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        ...lampObjects,
        { type: 'quad', parameters: { corner: PANEL.c, edge1: PANEL.e1, edge2: PANEL.e2 }, material: 'lamp' },
    ],
    materials: lampMaterials,
    lights: [],
    environment: { type: 'none' },
};

const lampBase = (id: string, direct: 'nee' | 'mis' | 'none'): RenderStrategy => withPose({
    id,
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 5 },
    estimator: { directLighting: direct, russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
}, [0, 2.2, 4.2], [0, 0.8, 0]);
export const meshLightStrategies: RenderStrategy[] = [lampBase('pt-nee', 'nee'), lampBase('pt-mis', 'mis'), lampBase('pt', 'none')];

// The estimator-swap arm (taxonomy obligation: estimator fields are bias-free by
// contract, so swapping the traversal engine must not change the image). Identical
// RNG stream + identical candidate set → near-bit-exact agreement; the only things
// that can separate the arms are real traversal bugs (dropped subtrees at stack
// depth, slab-test edge cases, a wrong leaf range). Distinct id — renderer IDs are
// `${strategy.id}-${scene.id}` and collisions silently clobber programs.
export const meshTwinBruteStrategy: RenderStrategy = {
    ...meshTwinStrategy,
    id: 'pathtracer-brute',
    estimator: { ...meshTwinStrategy.estimator, meshTraversal: 'brute' },
};
