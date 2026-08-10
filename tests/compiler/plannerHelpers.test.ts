import { describe, it, expect } from 'vitest';
import {
    placementOf,
    resolveSDFPlacement,
    resolveColorProperty,
    resolveScalarProperty,
} from '../../src/compiler/plan/Planner.js';
import { isDrivenPlacement, type PlannedPlacement } from '../../src/compiler/plan/types.js';
import { keepsLocalFrame } from '../../src/compiler/plan/dataTenants.js';
import type { SceneDescription, PrimitiveObject } from '../../src/compiler/types.js';
import { foldPlacementIntoParameters } from '../../src/components/geometry/index.js';
import { classifySimilarity, similarityApplyPoint, type Similarity } from '../../src/components/geometry/similarity.js';
import type { GlslExpression, ValueParam, Vec3 } from '../../src/compiler/types.js';
type StandardSDF = { type: string; parameters: Record<string, number | number[]> };   // local test shape (the input union died with B1)

/** Narrow a constant placement (throws on driven — these tests author constants). */
function sim(p: PlannedPlacement): Similarity {
    if (isDrivenPlacement(p)) throw new Error('expected a constant placement');
    return p;
}

const glsl: GlslExpression = { kind: 'glsl', source: 'vec3(1.0)' };
const param: ValueParam<Vec3> = { param: 'mat.albedo' };

describe('placementOf', () => {
    it('no transform → identity', () => {
        expect(classifySimilarity(placementOf(undefined))).toBe('identity');
    });
    it('lowers axis-angle sugar to a unit quaternion', () => {
        const g = placementOf({ rotation: { axis: [0, 0, 2], angle: Math.PI / 2 } });
        const p = similarityApplyPoint(g, [1, 0, 0]);
        expect(p[0]).toBeCloseTo(0, 12);
        expect(p[1]).toBeCloseTo(1, 12);
    });
    it('normalizes a non-unit quaternion', () => {
        const g = placementOf({ rotation: [0, 0, 0, 2] });
        expect(classifySimilarity(g)).toBe('identity');
    });
    it('applies the TRS pin: scale, then rotate, then translate', () => {
        const g = placementOf({ position: [10, 0, 0], rotation: { axis: [0, 0, 1], angle: Math.PI / 2 }, scale: 2 });
        expect(similarityApplyPoint(g, [1, 0, 0]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([10, 2, 0]);
    });
});

describe('resolveSDFPlacement (maximal fold — impl-plan-placement-fold stage 2)', () => {
    it('untransformed sphere: center stays in parameters, NO wrapper (identity residual)', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { center: [1, 2, 3], radius: 1 } };
        const { parameters, placement } = resolveSDFPlacement(sdf.type, sdf.parameters, undefined, 0);
        expect(classifySimilarity(sim(placement))).toBe('identity');
        expect(parameters.center).toEqual([1, 2, 3]);
        expect(parameters.radius).toBe(1);
    });

    it('translated+scaled box folds T,s into center/halfSize — identity residual (s·d tier dead)', () => {
        const sdf: StandardSDF = { type: 'box', parameters: { center: [1, 1, 1], halfSize: [0.5, 0.5, 0.5] } };
        const { parameters, placement } = resolveSDFPlacement(sdf.type, sdf.parameters, { position: [10, 20, 30], scale: 2 }, 0);
        expect(classifySimilarity(sim(placement))).toBe('identity');
        expect(parameters.center).toEqual([12, 22, 32]);   // g·center = s·center + t
        expect(parameters.halfSize).toEqual([1, 1, 1]);
    });

    it('ROTATED box: T,s fold, residual is the pure rotation about the folded center (rigid tier)', () => {
        const sdf: StandardSDF = { type: 'box', parameters: { center: [1, 0, 0], halfSize: [0.5, 0.5, 0.5] } };
        const { parameters, placement } = resolveSDFPlacement(sdf.type, sdf.parameters, { rotation: { axis: [0, 0, 1], angle: Math.PI / 2 } }, 0);
        const g = sim(placement);
        expect(classifySimilarity(g)).toBe('rigid');
        expect(g.scale).toBe(1);
        // center' = R·center = (0,1,0); residual translation = (I−R)·center'
        expect((parameters.center as number[])[0]).toBeCloseTo(0, 12);
        expect((parameters.center as number[])[1]).toBeCloseTo(1, 12);
        // residual maps the folded center to itself (rotation ABOUT c′)
        const back = similarityApplyPoint(g, parameters.center as [number, number, number]);
        expect(back[0]).toBeCloseTo(0, 12);
        expect(back[1]).toBeCloseTo(1, 12);
    });

    it('plane (closed, coupled fold): translation folds into the offset, no wrapper', () => {
        const sdf: StandardSDF = { type: 'plane', parameters: { normal: [0, 2, 0], offset: 2 } };
        const { parameters, placement } = resolveSDFPlacement(sdf.type, sdf.parameters, { position: [0, 3, 0] }, 0);
        expect(classifySimilarity(sim(placement))).toBe('identity');
        expect(parameters.normal).toEqual([0, 1, 0]);
        // dot(p,n)+d=0 convention: d' = d − ⟨t, n̂⟩ = 1 − 3
        expect(parameters.offset).toBe(-2);
    });

    it('RETAINED frame (keepsLocalFrame): the historical wrapper emission — center pre-folds into the placement', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { center: [1, 0, 0], radius: 1 } };
        const { parameters, placement } = resolveSDFPlacement(sdf.type, sdf.parameters, { rotation: { axis: [0, 0, 1], angle: Math.PI / 2 } }, 0, true);
        // local origin maps to R·center = (0,1,0); params center zeroed
        expect(parameters.center).toEqual([0, 0, 0]);
        expect(sim(placement).translation[0]).toBeCloseTo(0, 12);
        expect(sim(placement).translation[1]).toBeCloseTo(1, 12);
    });

    it('DRIVEN: keeps parameters local (no center fold) and builds the uniform record', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { center: [1, 2, 3], radius: 1 } };
        const { parameters, placement } = resolveSDFPlacement(
            sdf.type, sdf.parameters, { position: { param: 'rig.pos', default: [5, 0, 0] }, scale: 2 }, 7);
        expect(parameters.center).toEqual([1, 2, 3]);   // LOCAL — untouched
        expect(isDrivenPlacement(placement)).toBe(true);
        if (isDrivenPlacement(placement)) {
            expect(placement.uniformQ).toBe('u_object7PlacementQ');
            expect(placement.uniforms[0].parameterPaths).toEqual(['rig.pos']);
            // defaults: identity rotation, t_rigid = −Rᵀt = −default, s = 2
            expect(placement.uniforms[0].default).toEqual([-0, -0, -0, 1]);
            expect(placement.uniforms[1].default).toEqual([-5, -0, -0, 2]);
            // live recompute: position moves, scale constant baked in
            expect(placement.uniforms[1].compute!({ 'rig.pos': [1, 1, 0] })).toEqual([-1, -1, -0, 2]);
        }
    });
});

describe('foldPlacementIntoParameters (fable-transforms §5.1: the primitive set is similarity-closed)', () => {
    it('folds translation into a sphere center', () => {
        const folded = foldPlacementIntoParameters('sphere', { center: [1, 2, 3], radius: 2 }, placementOf({ position: [10, 20, 30] }));
        expect(folded).toEqual({ center: [11, 22, 33], radius: 2 });
    });

    it('scales a sphere radius by exactly s', () => {
        const folded = foldPlacementIntoParameters('sphere', { center: [0, 0, 0], radius: 2 }, placementOf({ scale: 3 }));
        expect(folded.radius).toBe(6);
    });

    it('folds a full similarity into quad corner + edges (lengths scale by s)', () => {
        const g = placementOf({ position: [0, 5, 0], rotation: { axis: [0, 0, 1], angle: Math.PI / 2 }, scale: 2 });
        const folded = foldPlacementIntoParameters('quad', { corner: [1, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, g);
        const corner = folded.corner as number[];
        const edge1 = folded.edge1 as number[];
        expect(corner[0]).toBeCloseTo(0, 12);
        expect(corner[1]).toBeCloseTo(7, 12);   // 2·R(1,0,0) + (0,5,0)
        expect(Math.hypot(...edge1)).toBeCloseTo(2, 12);
        expect(edge1[1]).toBeCloseTo(2, 12);    // rotated +X → +Y, scaled
    });

    it('normalizes and translates a plane without changing its geometric locus', () => {
        const folded = foldPlacementIntoParameters('plane', { normal: [0, 2, 0], offset: 2 }, placementOf({ position: [0, 3, 0] }));
        expect(folded.normal).toEqual([0, 1, 0]);
        expect(folded.offset).toBe(-2); // y=-1 translated +3 -> y=2 => y-2=0
    });

    it('fold agrees with direct point mapping (sphere surface stays on the folded sphere)', () => {
        const g = placementOf({ position: [1, -2, 3], rotation: { axis: [1, 2, 3], angle: 0.7 }, scale: 1.5 });
        const folded = foldPlacementIntoParameters('sphere', { center: [2, 0, -1], radius: 0.5 }, g);
        const center = folded.center as number[];
        // a point on the local sphere surface, mapped through g, must lie at distance s·r from the folded center
        const world = similarityApplyPoint(g, [2.5, 0, -1]);
        const d = Math.hypot(world[0] - center[0], world[1] - center[1], world[2] - center[2]);
        expect(d).toBeCloseTo(folded.radius as number, 9);
    });
});

describe('keepsLocalFrame (fable-imagery P1b — patterned+rotated shapes are not folded, so never tabled)', () => {
    const scene = (model: string): SceneDescription => ({
        id: 't', name: 't', ambientSpace: { type: 'euclidean' }, objects: [], lights: [],
        materials: { m: { model } as SceneDescription['materials'][string] },
    });
    const rot = { rotation: { axis: [1, 0, 0] as [number, number, number], angle: 0.5 } };
    const sphere = (transform?: PrimitiveObject['transform']): PrimitiveObject =>
        ({ type: 'sphere', parameters: { radius: 1 }, material: 'm', transform });

    it('checker + rotated sphere → keeps its frame (retained placement, residual arm)', () => {
        expect(keepsLocalFrame(sphere(rot), scene('checker'))).toBe(true);
    });
    it('checker + UNrotated sphere → folds (no rotation to preserve)', () => {
        expect(keepsLocalFrame(sphere({ position: [1, 0, 0] }), scene('checker'))).toBe(false);
    });
    it('lambert + rotated sphere → folds (material does not read uv)', () => {
        expect(keepsLocalFrame(sphere(rot), scene('lambert'))).toBe(false);
    });
    it('checker + rotated PLANE → folds (plane declares no uv chart)', () => {
        const plane: PrimitiveObject = { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'm', transform: rot };
        expect(keepsLocalFrame(plane, scene('checker'))).toBe(false);
    });
    // P2: an EXPRESSION material is procedural — a uv-formula on a rotated shape must keep its
    // frame too, else it silently falls back to an axis-aligned chart (re-introducing the P1b limit).
    const exprScene = (): SceneDescription => ({
        id: 't', name: 't', ambientSpace: { type: 'euclidean' }, objects: [], lights: [],
        materials: { m: { model: 'lambert', albedo: { kind: 'glsl', source: 'vec3(uv.x)' } } as SceneDescription['materials'][string] },
    });
    it('formula (lambert + expression albedo) + rotated sphere → keeps its frame (P2)', () => {
        expect(keepsLocalFrame(sphere(rot), exprScene())).toBe(true);
    });
});

describe('resolveColorProperty', () => {
    it('returns the fallback when undefined', () => {
        expect(resolveColorProperty(undefined, [0.8, 0.8, 0.8])).toEqual([0.8, 0.8, 0.8]);
    });
    it('broadcasts a scalar number to a vec3', () => {
        expect(resolveColorProperty(0.5, [0, 0, 0])).toEqual([0.5, 0.5, 0.5]);
    });
    it('passes a Vec3 through', () => {
        expect(resolveColorProperty([0.1, 0.2, 0.3], [0, 0, 0])).toEqual([0.1, 0.2, 0.3]);
    });
    it('preserves GlslExpression and ValueParam (emitted as uniforms)', () => {
        expect(resolveColorProperty(glsl, [0, 0, 0])).toBe(glsl);
        expect(resolveColorProperty(param, [0, 0, 0])).toBe(param);
    });
    it('broadcasts a scalar ValueParam default for its vec3 uniform', () => {
        expect(resolveColorProperty({ param: 'mat.albedo', default: 0.5 }, [0, 0, 0]))
            .toEqual({ param: 'mat.albedo', default: [0.5, 0.5, 0.5] });
    });
});

describe('resolveScalarProperty', () => {
    it('returns the fallback when undefined', () => {
        expect(resolveScalarProperty(undefined, 1.0)).toBe(1.0);
    });
    it('passes a number through', () => {
        expect(resolveScalarProperty(0.4, 1.0)).toBe(0.4);
    });
    it('rejects a Vec3 instead of silently truncating it', () => {
        expect(() => resolveScalarProperty([0.7, 0.2, 0.9], 1.0)).toThrow(/cannot be a vector/);
    });
    it('preserves GlslExpression and ValueParam', () => {
        expect(resolveScalarProperty(glsl, 1.0)).toBe(glsl);
        const p: ValueParam<number> = { param: 'mat.roughness' };
        expect(resolveScalarProperty(p, 1.0)).toBe(p);
    });
});
