// authoring/instance.ts — instancing sugar (impl-plan-instancing).
//
// The AUTHORING layer builds an InstancedObject (one prototype + a placement LIST) — the compiler
// sees a flat batch. `instance()` is the raw constructor; `grid`/`scatter` GENERATE common
// placement lists so a forest or a lattice is one call. Constant placements only (v1).

import type { InstancedObject, PrimitiveObject, MeshObject, Transform, Vec3 } from '../compiler/types.js';
import { foldPlacementIntoParameters } from '../components/geometry/index.js';
import type { PrimitiveValues } from '../components/descriptors.js';
import type { InstanceTable } from './loadInstances.js';

/** One prototype placed at N transforms, sharing the geometry. The prototype's material becomes
 *  the batch material; its transform (if any) is ignored — the placements carry world placement.
 *  The third argument is a provenance name, or an options record carrying `name` and/or
 *  per-instance `attributes` (fable-instance-attributes — arrays parallel to placements). */
export function instance(
    prototype: PrimitiveObject | MeshObject,
    placements: Transform[],
    opts?: string | { name?: string; attributes?: InstancedObject['attributes'] },
): InstancedObject {
    const o = typeof opts === 'string' ? { name: opts } : opts ?? {};
    return {
        kind: 'instanced', prototype, placements,
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.attributes !== undefined ? { attributes: o.attributes } : {}),
    };
}

/** Axis-aligned lattice of placements: counts per axis, uniform spacing, centred at `center`.
 *  A quick way to fill space (a grid of teapots). Optional per-instance uniform scale. */
export function grid(counts: [number, number, number], spacing: number, center: Vec3 = [0, 0, 0], scale?: number): Transform[] {
    const [nx, ny, nz] = counts;
    const out: Transform[] = [];
    const off = (n: number) => (n - 1) / 2;
    for (let x = 0; x < nx; x++) {
        for (let y = 0; y < ny; y++) {
            for (let z = 0; z < nz; z++) {
                out.push({
                    position: [
                        center[0] + (x - off(nx)) * spacing,
                        center[1] + (y - off(ny)) * spacing,
                        center[2] + (z - off(nz)) * spacing,
                    ],
                    ...(scale !== undefined ? { scale } : {}),
                });
            }
        }
    }
    return out;
}

/** UNIT prototypes for instanceCloud — `size` multiplies these, so size = sphere RADIUS.
 *  v1 is sphere-only: 'cube' needs an analytic box intersector, and box is DELIBERATELY
 *  SDF-only today (params not closed under rotation — the top-level analytic fold would
 *  silently drop a rotated box's rotation). The instanced local-frame arm is rotation-safe,
 *  so cube's real prerequisite is a per-context backend fact (fable-instance-clouds §8). */
const CLOUD_SHAPES: Record<string, { type: string; parameters: PrimitiveValues }> = {
    sphere: { type: 'sphere', parameters: { radius: 1.0 } },
};

export interface InstanceCloudOptions {
    /** Global shape choice (fable-instance-clouds pin 6 — scene-side, never in the file). */
    shape: keyof typeof CLOUD_SHAPES | string;
    /** Scene material id — the batch material (the file stays renderer-agnostic). */
    material: string;
    name?: string;
    /** Which schema row the color column overrides ('albedo' on lambert, 'f0' on
     *  mirror, …). Default 'albedo' when colors exist. */
    colorDrives?: string;
    /** The cheap dial: multiplies baked/hooked sizes; with NO per-instance size source it
     *  folds into the unit prototype's parameters instead (no sizes column, s = 1 records). */
    sizeScale?: number;
    /** CPU size hook (pack-time, NEVER on the GPU — pin 3): overrides baked sizes,
     *  reading named scalar columns. A hook touching an absent column yields NaN and the
     *  Validator rejects loudly. */
    size?: (cols: Record<string, Float32Array>, i: number) => number;
    /** CPU color hook (colormaps) — overrides the baked color column, LINEAR RGB. */
    color?: (cols: Record<string, Float32Array>, i: number) => [number, number, number];
}

/** One `.inst` instance table as ONE batch (fable-instance-clouds §4): packed placements
 *  (never 300k Transform objects), colors as a packed per-instance attribute on
 *  `colorDrives`. Priority per the doc: hook > baked column > default (size 1 / no color). */
export function instanceCloud(table: InstanceTable, opts: InstanceCloudOptions): InstancedObject {
    const proto = CLOUD_SHAPES[opts.shape];
    if (proto === undefined) {
        throw new Error(`instanceCloud: unknown shape '${opts.shape}' — known: ${Object.keys(CLOUD_SHAPES).join(', ')}`);
    }
    const n = table.count;

    let sizes = table.sizes;
    if (opts.size !== undefined) {
        sizes = new Float32Array(n);
        for (let i = 0; i < n; i++) sizes[i] = opts.size(table.scalars, i);
    }
    let parameters = { ...proto.parameters };
    if (opts.sizeScale !== undefined && opts.sizeScale !== 1) {
        if (sizes !== undefined) {
            const scaled = new Float32Array(n);
            for (let i = 0; i < n; i++) scaled[i] = opts.sizeScale * sizes[i];
            sizes = scaled;
        } else {
            // No per-instance size source: fold the uniform scale into the UNIT
            // prototype's parameters (the ONE kind-derived fold, under a pure-scale
            // similarity) instead of materializing an N-array of one constant.
            parameters = foldPlacementIntoParameters(proto.type, parameters, {
                rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: opts.sizeScale,
            });
        }
    }

    let colors = table.colors;
    if (opts.color !== undefined) {
        colors = new Float32Array(3 * n);
        for (let i = 0; i < n; i++) {
            const [r, g, b] = opts.color(table.scalars, i);
            colors[3 * i] = r; colors[3 * i + 1] = g; colors[3 * i + 2] = b;
        }
    }

    return {
        kind: 'instanced',
        prototype: { type: proto.type, parameters, material: opts.material } as PrimitiveObject,
        placements: {
            count: n,
            positions: table.positions,
            ...(sizes !== undefined ? { sizes } : {}),
            ...(table.orientations !== undefined ? { orientations: table.orientations } : {}),
        },
        ...(colors !== undefined ? { attributes: { [opts.colorDrives ?? 'albedo']: colors } } : {}),
        ...(opts.name !== undefined ? { name: opts.name } : {}),
    };
}

/** `count` placements scattered on the y=`y` plane within a `[-extent, extent]²` square, with a
 *  random Y-rotation and a scale in `[scaleMin, scaleMax]`. Deterministic (seeded) so a scene is
 *  reproducible — a forest of props from one call. */
export function scatter(
    count: number,
    extent: number,
    opts: { y?: number; seed?: number; scaleMin?: number; scaleMax?: number } = {},
): Transform[] {
    const { y = 0, seed = 1, scaleMin = 1, scaleMax = 1 } = opts;
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const out: Transform[] = [];
    for (let i = 0; i < count; i++) {
        const px = (rnd() * 2 - 1) * extent;
        const pz = (rnd() * 2 - 1) * extent;
        const angle = rnd() * Math.PI * 2;
        const scale = scaleMin + rnd() * (scaleMax - scaleMin);
        out.push({ position: [px, y, pz], rotation: { axis: [0, 1, 0], angle }, scale });
    }
    return out;
}
