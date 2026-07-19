// components/lights/power.ts — shared radiometric helpers for the light kinds (D5:
// a family-root shared part, the basis.ts/similarity.ts precedent — occupants import
// from HERE, never from index.ts, so the registry↔occupant ESM cycle is dead).

/** Mean channel of a precomputed radiometric product (intensity or Le) — the scalar
 *  the pbrt power formulas weight by. Shared by every kind's `power` (§2.5 note: a
 *  CPU-side selection heuristic, not a radiometric reduction in GLSL —
 *  spectrum_average's discipline doesn't apply here). */
export function radiantScalar(product: number[]): number {
    return (product[0] + product[1] + product[2]) / 3;
}
