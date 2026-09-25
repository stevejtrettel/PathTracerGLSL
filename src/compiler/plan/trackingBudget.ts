// compiler/plan/trackingBudget.ts
// The collision cap of the null-collision tracking arms, and the Planner's check that no medium
// in the scene can reach it.
//
// Delta and ratio tracking (components/transport/volume/delta_tracking) walk a segment by
// exponential jumps at the majorant rate σ̄. A segment of length L takes Poisson(σ̄·L) tentative
// collisions when every one is null (fewer when a real collision ends the walk). The loops stop at
// MAX_NULL_COLLISIONS, and a walk stopped there drops the rest of its segment: the attenuation
// still owed (so the image reads bright) and the emission not yet collected (dark). Whether that
// happens depends on σ̄, which the scene declares, not on any estimator setting, so it cannot be
// made a measurement field. Instead the cap sits far above what scenes need, and the Planner
// warns when a medium's longest straight segment could reach it: when σ̄·L > MAX_NULL_COLLISIONS/2.
// Below that the chance that a segment reaches the cap is under e^-190 (the Poisson tail bound
// P(X ≥ C) ≤ e^-λ·(eλ/C)^C is e^-0.19·C at λ = C/2).
//
// Only an AUTHORED majorant can make null collisions. For constant and {param} coefficients σ̄ is
// the medium's own σ_t (derivedMajorant), the null rate σ̄ − σ_t is zero, and every walk ends at
// its first tentative collision. So the check covers expression media only, and assumes the worst
// case for them: every collision null, as where the field is near zero. The cap also bounds cost:
// a walk crossing empty space still pays σ̄ per unit length, which is why an ambient expression
// fog is best enclosed in a bounded region around where its density is nonzero.

import type { SceneDescription } from '../types.js';
import { isHeterogeneousMedium, isValueParam, mediumMayScatter, mediumRoutesToTracking } from '../types.js';
import type { ValueParam, Vec3, GlslExpression } from '../types.js';
import type { AABB } from '../../components/accel/bvh/bvh.js';
import { primitiveBounds } from '../../components/geometry/index.js';
import { meshLocalBox } from '../../components/intersection/mesh/topology.js';
import { sceneInstanceBatches, isPackedPlacements } from '../../components/intersection/instancing/instancing.js';
import type { PlannedMaterial, PlannedMedium, PlannedPrimitiveObject, PlannedMesh, PlannedInstanceBatch } from './types.js';
import { isDrivenPlacement } from './types.js';
import { isMeshObject } from '../types.js';

/** Loop bound of every null-collision tracking loop (emitted as the MAX_NULL_COLLISIONS define). */
export const MAX_NULL_COLLISIONS = 1024;

/** The far clip, MAX_DIST in glsl/core/math.glsl (pinned equal by epsilonCoupling.test): the
 *  longest segment an ambient medium can hold, since a ray that meets nothing ends there. */
export const FAR_CLIP = 1000;

/** Resolved max-channel σ_t of a NON-expression medium (constants + {param} substituted
 *  live) — THE derived majorant (impl-plan-env-power-selection batch 2): for constant and
 *  {param}-driven coefficients the exact ceiling IS the live extinction, so σ̄ can never
 *  go stale under a slider. Floored at 1e-6: sliding to vacuum keeps the tracking jump
 *  finite (one giant step → transmitted — the right physics, no ÷0). */
export function derivedMajorant(med: PlannedMedium, params: Record<string, unknown> = {}): number {
    const resolve = (v: Vec3 | GlslExpression | ValueParam<Vec3>): number[] => {
        if (isValueParam(v)) {
            const raw = params[v.param] ?? v.default;
            return typeof raw === 'number' ? [raw, raw, raw] : (raw as number[]) ?? [0, 0, 0];
        }
        return v as Vec3;   // expression media never reach here (authored-σ̄ route)
    };
    const a = resolve(med.sigma_a);
    const s = resolve(med.sigma_s);
    return Math.max(1e-6, ...a.map((x, i) => x + s[i]));
}

/** The σ̄ a tracking-routed medium walks at, with {param} coefficients at their defaults: the
 *  authored ceiling for expression coefficients (Validator-guaranteed present), else the
 *  derived one. */
export function trackingMajorant(med: PlannedMedium): number {
    return isHeterogeneousMedium(med) ? med.majorant! : derivedMajorant(med);
}

/** A region that holds a material's interior, and the longest straight segment inside it. */
interface RegionExtent { materialId: number; chord: number; where: string; ambient?: true }

function diagonal(b: AABB): number {
    return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

/** Every region whose size the compiler can bound, with a chord bound: the diagonal of its world
 *  box, or the far clip for the ambient region. A region with a driven ({param}) placement or an
 *  unbounded shape has no fixed size and is left out. */
function regionExtents(
    scene: SceneDescription, objects: PlannedPrimitiveObject[], meshes: PlannedMesh[],
    batches: PlannedInstanceBatch[], ambientMedium: number,
): RegionExtent[] {
    const out: RegionExtent[] = [];
    if (ambientMedium >= 0) out.push({ materialId: ambientMedium, chord: FAR_CLIP, where: 'the ambient region', ambient: true });
    for (const o of objects) {
        if (o.placement !== undefined && isDrivenPlacement(o.placement)) continue;
        const box = primitiveBounds(o.type, o.parameters);   // local when a frame is kept, else world
        if (box === null) continue;
        out.push({ materialId: o.materialId, chord: diagonal(box) * (o.placement?.scale ?? 1), where: `object '${o.name ?? o.index}'` });
    }
    for (const m of meshes) {
        if (m.localBox === undefined || isDrivenPlacement(m.placement)) continue;   // open meshes hold no interior
        out.push({ materialId: m.materialId, chord: diagonal(m.localBox) * m.placement.scale, where: `mesh '${m.name ?? m.index}'` });
    }
    const authoredBatches = sceneInstanceBatches(scene.objects);
    for (const b of batches) {
        if (b.hasInterior !== true) continue;
        const obj = authoredBatches[b.ordinal];
        const proto = obj.prototype;
        const box = isMeshObject(proto) ? meshLocalBox(proto.positions)
            : b.prototype.backend === 'primitive' ? primitiveBounds(b.prototype.shapeType, b.prototype.parameters) : null;
        if (box === null) continue;
        let maxScale = 1;
        if (isPackedPlacements(obj.placements)) {
            if (obj.placements.sizes !== undefined) maxScale = obj.placements.sizes.reduce((a, x) => Math.max(a, x), 0);
        } else {
            maxScale = obj.placements.reduce((a, t) => Math.max(a, typeof t.scale === 'number' ? t.scale : 1), 0);
        }
        out.push({ materialId: b.materialId, chord: diagonal(box) * maxScale, where: `the instances of batch '${b.name ?? b.index}'` });
    }
    return out;
}

/** One warning per expression medium whose longest segment could reach the collision cap. */
export function trackingBudgetWarnings(
    scene: SceneDescription, materials: PlannedMaterial[], objects: PlannedPrimitiveObject[],
    meshes: PlannedMesh[], batches: PlannedInstanceBatch[], ambientMedium: number, scatteringLive: boolean,
): string[] {
    const warnings: string[] = [];
    const extents = regionExtents(scene, objects, meshes, batches, ambientMedium);
    for (const mat of materials) {
        const med = mat.medium;
        if (med === null || !isHeterogeneousMedium(med)) continue;   // derived σ̄: no null collisions
        if (!mediumRoutesToTracking(med, scatteringLive && mediumMayScatter(med))) continue;
        const sigmaBar = trackingMajorant(med);
        const longest = extents.filter((e) => e.materialId === mat.id).sort((a, b) => b.chord - a.chord)[0];
        if (longest === undefined) continue;
        const expected = sigmaBar * longest.chord;
        if (expected <= MAX_NULL_COLLISIONS / 2) continue;
        const segment = longest.ambient
            ? `A ray that meets nothing in ${longest.where} runs to the far clip, ${FAR_CLIP} units`
            : `A straight segment through ${longest.where} can be ${longest.chord.toPrecision(3)} units long`;
        const remedy = longest.ambient
            ? `Enclose the fog in a bounded region ('none' walls) around where its density is nonzero: segments get short, and the walk stops paying for collisions in empty space.`
            : `Lower medium.majorant toward the field's true maximum, or make the region smaller.`;
        warnings.push(
            `Material '${mat.name}': the medium's tracking walk can reach its collision cap. ${segment}; at the majorant σ̄ = ${sigmaBar.toPrecision(3)}, where the field is near zero that is about ${Math.round(expected)} tentative collisions, against a cap of ${MAX_NULL_COLLISIONS} (this warning starts at ${MAX_NULL_COLLISIONS / 2}). A walk that reaches the cap drops the rest of its segment: attenuation still owed (too bright) and emission not yet collected (too dark). ${remedy}`);
    }
    return warnings;
}
