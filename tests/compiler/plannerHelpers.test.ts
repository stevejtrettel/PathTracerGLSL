import { describe, it, expect } from 'vitest';
import {
    placementOf,
    resolveSDFPlacement,
    resolveColorProperty,
    resolveScalarProperty,
} from '../../src/compiler/plan/Planner.js';
import { foldAnalyticParameters } from '../../src/components/geometry/index.js';
import { classifySimilarity, similarityApplyPoint } from '../../src/components/geometry/similarity.js';
import type { StandardSDF, GlslExpression, ValueParam, Vec3 } from '../../src/compiler/types.js';

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

describe('resolveSDFPlacement', () => {
    it('folds a sphere center into the placement and zeroes center in parameters', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { center: [1, 2, 3], radius: 1 } };
        const { parameters, placement } = resolveSDFPlacement(sdf, undefined);
        expect(placement.translation).toEqual([1, 2, 3]);
        expect(classifySimilarity(placement)).toBe('translation');
        expect(parameters.center).toEqual([0, 0, 0]);
        expect(parameters.radius).toBe(1);
    });

    it('sums transform.position and center into a single translation', () => {
        const sdf: StandardSDF = { type: 'box', parameters: { center: [1, 1, 1], half: [0.5, 0.5, 0.5] } };
        const { placement } = resolveSDFPlacement(sdf, { position: [10, 20, 30] });
        expect(placement.translation).toEqual([11, 21, 31]);
    });

    it('center is a PRE-translation: the object rotates about its local origin carrying center', () => {
        const sdf: StandardSDF = { type: 'box', parameters: { center: [1, 0, 0], halfSize: [0.5, 0.5, 0.5] } };
        const { placement } = resolveSDFPlacement(sdf, { rotation: { axis: [0, 0, 1], angle: Math.PI / 2 } });
        // local origin maps to R·center = (0,1,0)
        expect(placement.translation[0]).toBeCloseTo(0, 12);
        expect(placement.translation[1]).toBeCloseTo(1, 12);
    });

    it('normalizes plane normal+offset together and keeps the whole placement for the wrapper', () => {
        const sdf: StandardSDF = { type: 'plane', parameters: { normal: [0, 2, 0], offset: 2 } };
        const { parameters, placement } = resolveSDFPlacement(sdf, { position: [1, 0, 0] });
        expect(parameters.normal).toEqual([0, 1, 0]);
        expect(parameters.offset).toBe(1);
        expect(placement.translation).toEqual([1, 0, 0]);
    });

    it('passes parameters through when there is no center', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { radius: 2 } };
        const { parameters, placement } = resolveSDFPlacement(sdf, { position: [1, 2, 3] });
        expect(parameters).toBe(sdf.parameters);
        expect(placement.translation).toEqual([1, 2, 3]);
    });
});

describe('foldAnalyticParameters (fable-transforms §5.1: the primitive set is similarity-closed)', () => {
    it('folds translation into a sphere center', () => {
        const folded = foldAnalyticParameters('sphere', { center: [1, 2, 3], radius: 2 }, placementOf({ position: [10, 20, 30] }));
        expect(folded).toEqual({ center: [11, 22, 33], radius: 2 });
    });

    it('scales a sphere radius by exactly s', () => {
        const folded = foldAnalyticParameters('sphere', { center: [0, 0, 0], radius: 2 }, placementOf({ scale: 3 }));
        expect(folded.radius).toBe(6);
    });

    it('folds a full similarity into quad corner + edges (lengths scale by s)', () => {
        const g = placementOf({ position: [0, 5, 0], rotation: { axis: [0, 0, 1], angle: Math.PI / 2 }, scale: 2 });
        const folded = foldAnalyticParameters('quad', { corner: [1, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, g);
        const corner = folded.corner as number[];
        const edge1 = folded.edge1 as number[];
        expect(corner[0]).toBeCloseTo(0, 12);
        expect(corner[1]).toBeCloseTo(7, 12);   // 2·R(1,0,0) + (0,5,0)
        expect(Math.hypot(...edge1)).toBeCloseTo(2, 12);
        expect(edge1[1]).toBeCloseTo(2, 12);    // rotated +X → +Y, scaled
    });

    it('normalizes and translates a plane without changing its geometric locus', () => {
        const folded = foldAnalyticParameters('plane', { normal: [0, 2, 0], offset: 2 }, placementOf({ position: [0, 3, 0] }));
        expect(folded.normal).toEqual([0, 1, 0]);
        expect(folded.offset).toBe(-2); // y=-1 translated +3 -> y=2 => y-2=0
    });

    it('fold agrees with direct point mapping (sphere surface stays on the folded sphere)', () => {
        const g = placementOf({ position: [1, -2, 3], rotation: { axis: [1, 2, 3], angle: 0.7 }, scale: 1.5 });
        const folded = foldAnalyticParameters('sphere', { center: [2, 0, -1], radius: 0.5 }, g);
        const center = folded.center as number[];
        // a point on the local sphere surface, mapped through g, must lie at distance s·r from the folded center
        const world = similarityApplyPoint(g, [2.5, 0, -1]);
        const d = Math.hypot(world[0] - center[0], world[1] - center[1], world[2] - center[2]);
        expect(d).toBeCloseTo(folded.radius as number, 9);
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
