// authoring/instance.ts — instancing sugar (impl-plan-instancing).
//
// The AUTHORING layer builds an InstancedObject (one prototype + a placement LIST) — the compiler
// sees a flat batch. `instance()` is the raw constructor; `grid`/`scatter` GENERATE common
// placement lists so a forest or a lattice is one call. Constant placements only (v1).

import type { InstancedObject, PrimitiveObject, MeshObject, Transform, Vec3 } from '../compiler/types.js';

/** One prototype placed at N transforms, sharing the geometry. The prototype's material becomes
 *  the batch material; its transform (if any) is ignored — the placements carry world placement. */
export function instance(prototype: PrimitiveObject | MeshObject, placements: Transform[], name?: string): InstancedObject {
    return { kind: 'instanced', prototype, placements, ...(name !== undefined ? { name } : {}) };
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
