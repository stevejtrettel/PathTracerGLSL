// demos/dataScenes.ts — instance-cloud DATA scenes (fable-instance-clouds §7): async
// registry entries whose scenes are built at click-through from untracked `.inst` files
// in test-data/ (served by the dev server; converted from collaborator JSON by
// tools/convert-pointset.mjs). Supersedes the pages/clebsch.ts one-off probe (deleted).
//
// Sizes/colors are BAKED in the files (render-ready — the radius laws live in the
// converter); `height` rides along as a named scalar column, so retuning a law is a
// one-line `size:` hook here + reload, never a re-conversion. The room/lamp/palette
// below are the Aug 7 2026 session's tuned look: dark colored walls (deep teal/wine/
// navy against the warm points), one small bright ceiling quad for crisp shadows.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../tests/witnesses/types.js';
import { loadInstances } from '../src/authoring/loadInstances.js';
import { instanceCloud, type InstanceCloudOptions } from '../src/authoring/instance.js';
import { withPose } from '../src/authoring/strategy.js';

interface CloudSceneConfig {
    /** `.inst` URL (dev-server path into test-data/). */
    url: string;
    pose: { position: [number, number, number]; target: [number, number, number] };
    fov: number;
    room: {
        floorY: number; ceilingY: number; wallX: number; wallZ: number;
        /** Lamp: square half-size, hung just below ceilingY, emitted radiance. */
        lampHalf: number; lampEmission: number;
    };
    /** Batch albedo for files WITHOUT a colors column (steiner: all points one class —
     *  the converter omits the column, the material carries the look). */
    pointAlbedo?: [number, number, number];
    /** Per-entry instanceCloud overrides — size/color HOOKS against the file's scalar
     *  columns (CPU-only at pack time), sizeScale, colorDrives. The retune surface:
     *  edit + reload, never re-convert (c32 is the first user — sizing/colormapping
     *  a limit set by its `hits` density column). */
    cloud?: Partial<InstanceCloudOptions>;
}

const CONFIGS: Record<string, CloudSceneConfig> = {
    clebsch: {
        url: '/test-data/clebsch.inst',
        // 194k points in [-10,10]³ (the Clebsch cubic's algebraic points; 370 white
        // rationals at r=0.15, orange quadratics sized by 0.15/√h).
        pose: { position: [24, 18, 28], target: [0, 0, 0] },
        fov: 0.8,
        room: { floorY: -11.5, ceilingY: 25, wallX: 30, wallZ: 30, lampHalf: 4, lampEmission: 36 },
    },
    croissant: {
        url: '/test-data/croissant.inst',
        // 289k points, x/y ±3, z ±10 — the pink S4 torus shell + the white rational
        // skewer along z; sizes clamp(0.425/√h, 0.01, 0.0225).
        pose: { position: [10, 5, 14], target: [0, 0, 0] },
        fov: 1.0,
        room: { floorY: -4, ceilingY: 10, wallX: 16, wallZ: 16, lampHalf: 2.5, lampEmission: 20 },
    },
    steiner: {
        url: '/test-data/steiner.inst',
        // 724k points of the quartic Steiner surface, ALL one Galois class (no colors
        // column — pointAlbedo below carries the look; SIZE is the only signal, log law
        // over nine height decades). Converter scale ×10 → extent ±7.
        pose: { position: [16, 12, 19], target: [0, 0, 0] },
        fov: 0.8,
        room: { floorY: -8, ceilingY: 18, wallX: 22, wallZ: 22, lampHalf: 3, lampEmission: 30 },
        pointAlbedo: [0.9, 0.88, 0.84],   // warm white
    },
    crixxi: {
        url: '/test-data/crixxi.inst',
        // 744k points of the sextic Crixxi surface, pink-dominant + rare classes
        // (8.8k rationals, 32 green / 40 blue / 8 orange). Converter scale ×5 → ±5–7.
        pose: { position: [13, 8, 17], target: [0, 0, 0] },
        fov: 0.9,
        room: { floorY: -8.5, ceilingY: 16, wallX: 20, wallZ: 20, lampHalf: 2.5, lampEmission: 28 },
    },
    octic: {
        url: '/test-data/octic.inst',
        // 1.4M points of the hyperoctahedral octic — the batch that triggered the
        // DATA_TEX_WIDTH 4096 bump. Gold-recolored (v2); expect a LONG one-time TLAS
        // build at load (~half a minute — the SoA SAH builder is the deferred fix).
        // Converter scale ×8 (v3: cloud doubled so ALL points — floor-dust included —
        // halve relative to the surface) → extent ±16; room/pose doubled to match.
        pose: { position: [27, 18, 33], target: [0, 0, 0] },
        fov: 0.85,
        room: { floorY: -19, ceilingY: 40, wallX: 50, wallZ: 50, lampHalf: 7, lampEmission: 32 },
    },
    c32: {
        url: '/test-data/c32.inst',
        // 5.6k points of a Kleinian limit set (limit-sets sp6/c32, depth 14) — the FIRST
        // externally-generated .inst (the one-pager doing its job). Flat cloud (x ±10,
        // y ±0.3, z ±2.2); baked sizes are a uniform 0.01 floor, but the file ships a
        // `hits` density column (1 → 234k) — hooks below size AND colormap by log-hits.
        // Floor sits close under the flat set for shadow contact.
        pose: { position: [5, 4, 8], target: [0, 0, 0] },
        fov: 0.85,
        room: { floorY: -1.5, ceilingY: 12, wallX: 16, wallZ: 16, lampHalf: 3, lampEmission: 14 },
        cloud: {
            // t = log-normalized visitation density in [0,1] (max hits 234598 → log10 ≈ 5.37).
            size: (cols, i) => 0.018 + 0.022 * (Math.log10(cols.hits[i]) / 5.37),
            color: (cols, i) => {
                const t = Math.log10(cols.hits[i]) / 5.37;
                // Ember→gold ramp: rarely-visited points smolder dark, dense core glows.
                return [0.15 + 0.85 * t, 0.04 + 0.66 * Math.pow(t, 1.5), 0.02 + 0.30 * Math.pow(t, 2.5)];
            },
        },
    },
};

async function buildCloudScene(id: string, cfg: CloudSceneConfig): Promise<SceneDescription> {
    const table = await loadInstances(cfg.url);
    const { floorY, ceilingY, wallX, wallZ, lampHalf, lampEmission } = cfg.room;
    return {
        id,
        name: `${id} cloud (${table.count} points)`,
        provenance: table.provenance,
        ambientSpace: { type: 'euclidean' },
        objects: [
            // The room: one-sided planes facing inward (cornellBox pattern). The camera
            // pose must stay INSIDE these bounds.
            { type: 'plane', parameters: { normal: [0, 1, 0], offset: -floorY }, material: 'floor' },
            { type: 'plane', parameters: { normal: [0, -1, 0], offset: ceilingY }, material: 'ceiling' },
            { type: 'plane', parameters: { normal: [1, 0, 0], offset: wallX }, material: 'wine' },   // x = -wallX
            { type: 'plane', parameters: { normal: [-1, 0, 0], offset: wallX }, material: 'teal' },  // x = +wallX
            { type: 'plane', parameters: { normal: [0, 0, 1], offset: wallZ }, material: 'navy' },   // z = -wallZ (facing camera)
            { type: 'plane', parameters: { normal: [0, 0, -1], offset: wallZ }, material: 'teal' },  // z = +wallZ (behind camera)
            instanceCloud(table, { shape: 'sphere', material: 'point', name: 'cloud', ...cfg.cloud }),
        ],
        materials: {
            // Overridden per instance when the file carries colors; THE look otherwise.
            point: { model: 'lambert', albedo: cfg.pointAlbedo ?? [0.85, 0.55, 0.25] },
            floor: { model: 'lambert', albedo: [0.16, 0.15, 0.17] },     // dark slate
            ceiling: { model: 'lambert', albedo: [0.30, 0.30, 0.32] },
            teal: { model: 'lambert', albedo: [0.06, 0.16, 0.18] },
            wine: { model: 'lambert', albedo: [0.20, 0.07, 0.09] },
            navy: { model: 'lambert', albedo: [0.07, 0.09, 0.17] },
        },
        // Ceiling lamp: quad hung just below the ceiling plane (flush would z-fight and
        // self-block shadow rays); cross(edge1, edge2) points DOWN (one-sided pin).
        lights: [{
            kind: 'quad',
            corner: [-lampHalf, ceilingY - 0.1, -lampHalf],
            edge1: [2 * lampHalf, 0, 0],
            edge2: [0, 0, 2 * lampHalf],
            emission: lampEmission,
        }],
    };
}

function cloudStrategy(id: string, cfg: CloudSceneConfig): RenderStrategy {
    const base: RenderStrategy = {
        id: `pt-nee-${id}`,
        measurement: { camera: { type: 'pinhole', fov: cfg.fov }, maxBounces: 6 },
        estimator: {
            directLighting: 'nee',
            russianRoulette: { startDepth: 3 },
            instanceAccel: 'tlas',
            accumulation: { type: 'average' },
        },
        view: { tonemap: { type: 'reinhard' } },
    };
    return withPose(base, cfg.pose.position, cfg.pose.target);
}

function cloudEntry(id: string, blurb: string): AsyncSceneSuiteEntry {
    const cfg = CONFIGS[id];
    return {
        scene: () => buildCloudScene(id, cfg),
        name: `${id} point cloud (.inst)`,
        strategies: [cloudStrategy(id, cfg)],
        exercises: blurb,
    };
}

export const dataScenes: Record<string, AsyncSceneSuiteEntry> = {
    clebsch: cloudEntry('clebsch',
        'DATA — instance clouds end to end (fable-instance-clouds): 194k algebraic points of the Clebsch cubic from an untracked .inst file (runtime fetch → packed placements → per-instance albedo → per-batch TLAS). Baked sizes encode arithmetic height; the height scalar column enables size: hooks without re-conversion.'),
    croissant: cloudEntry('croissant',
        'DATA — the 289k-point arm (fable-instance-clouds): the S4-quartic torus shell + the rational skewer along z.'),
    steiner: cloudEntry('steiner',
        'DATA — the no-colors-column arm (fable-instance-clouds): 724k points of the quartic Steiner surface, ALL one Galois class — the batch material carries the look and SIZE is the only signal (log radius law over NINE height decades, 1→2×10⁹).'),
    crixxi: cloudEntry('crixxi',
        'DATA — 744k points of the sextic Crixxi surface: pink S4 shell with rare classes (8.8k rationals + handfuls of green/blue/orange) — needle-in-haystack coloring at scale.'),
    octic: cloudEntry('octic',
        'DATA — the 1.4M-point ceiling-breaker (fable-instance-clouds §8): the hyperoctahedral octic, the batch that triggered DATA_TEX_WIDTH 2048→4096. One-time TLAS build at load takes tens of seconds (the SoA SAH builder is the deferred fix).'),
    c32: cloudEntry('c32',
        'DATA — the first EXTERNALLY-generated .inst (the inst-onepager interchange working): a Kleinian limit set from the limit-sets tool, 5.6k points. Both HOOKS live against the shipped `hits` scalar column — size + ember→gold colormap by log visitation density; edit the hooks in dataScenes.ts + reload to retune (never re-convert).'),
};
