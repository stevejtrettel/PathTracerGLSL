// Scene-local SDF fields (fable-sdf-contract §5.2) — the defineSDF door.
//
// Two layers of gate, both exercised here:
//   · DEFINITION time: name/row/symbol/bound checks throw in the scene module itself,
//     before any compile can confuse two shapes;
//   · COMPILE time: the Validator samples the definition's own TS twin against the
//     declared bound over each authored object's RESOLVED values — a clipping bound
//     is a compile error naming the object.
// The demo (demos/customFieldsScene.ts) is the standing glslang coverage: it rides
// glsl-compile.test.ts through the demo suite like every other card.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { defineSDF } from '../../src/components/geometry/custom.js';
import { PRIMITIVES } from '../../src/components/geometry/index.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { customFieldsScene, customFieldsStrategy } from '../../demos/customFieldsScene.js';

const compiler = new Compiler();

/** A well-formed local field spec, cloneable per test. The field is a ball of
 *  radius `size` (twin exact), so bound honesty is trivially controllable. */
const ballSpec = (name: string, boundScale = 1.0) => ({
    name,
    params: [
        { name: 'size', kind: 'length' as const, shape: 'number' as const, required: true },
    ],
    glsl: `float ${name}_sdf(vec3 p, ${name[0].toUpperCase() + name.slice(1)} s) { return length(p) - s.size; }`,
    field: (p: number[], v: Record<string, number | number[]>) =>
        Math.hypot(p[0], p[1], p[2]) - (v.size as number),
    marchBound: { type: 'sphere', values: (v: Record<string, number | number[]>) => ({ radius: boundScale * (v.size as number) }) },
});

const sceneWith = (type: string): SceneDescription => ({
    id: `local-${type}`,
    name: `local ${type}`,
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', name: 'ground', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'mat' },
        { type, name: 'blob', parameters: { size: 0.5 }, material: 'mat', transform: { position: [0, 1, 0] } },
    ],
    materials: { mat: { model: 'lambert', albedo: [0.5, 0.5, 0.5] } },
    lights: [{ kind: 'point', position: [0, 3, 0], emission: 5 }],
    environment: { type: 'constant', color: [0.1, 0.1, 0.1], intensity: 1 },
});

const strategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
};

describe('defineSDF — definition-time gates', () => {
    it('registers a well-formed field and returns its type name', () => {
        const type = defineSDF(ballSpec('testball'));
        expect(type).toBe('testball');
        expect(PRIMITIVES.testball?.local).toBe(true);
        expect(PRIMITIVES.testball?.provides).toEqual({ sdf: true, analytic: false });
    });

    it('is idempotent for an identical re-definition (hot reload), rejects a different one', () => {
        expect(defineSDF(ballSpec('testball'))).toBe('testball');
        const changed = { ...ballSpec('testball'), glsl: ballSpec('testball').glsl + '\n// changed' };
        expect(() => defineSDF(changed)).toThrow(/DIFFERENT scene-local field/);
    });

    it('rejects a registry-colliding name', () => {
        expect(() => defineSDF(ballSpec('sphere'))).toThrow(/registry primitive/);
    });

    it('rejects a point row — scene-local fields are canonical', () => {
        const spec = ballSpec('centered');
        spec.params.unshift({ name: 'center', kind: 'point' as never, shape: 'vec3' as never, required: false, default: [0, 0, 0] } as never);
        expect(() => defineSDF(spec)).toThrow(/CANONICAL/);
    });

    it('rejects zero rows, required-with-default, bad names', () => {
        expect(() => defineSDF({ ...ballSpec('norows'), params: [] })).toThrow(/at least one parameter row/);
        const dbl = ballSpec('dblrow');
        dbl.params[0] = { ...dbl.params[0], required: true, default: 1 } as never;
        expect(() => defineSDF(dbl)).toThrow(/required XOR/);
        expect(() => defineSDF(ballSpec('Bad_Name' as string))).toThrow(/identifier/);
    });

    it('rejects glsl without the field signature, or with hand-written march/normal', () => {
        expect(() => defineSDF({ ...ballSpec('nosig'), glsl: 'float wrong(vec3 p) { return 0.0; }' }))
            .toThrow(/must define float nosig_sdf/);
        const withMarch = ballSpec('marched');
        withMarch.glsl += `\nbool marched_sdf_intersect(Ray r, Marched s, float a, float b, out float t) { return false; }`;
        expect(() => defineSDF(withMarch)).toThrow(/GENERATED/);
    });

    it('rejects an unregistered or non-bounding marchBound type', () => {
        const spec = ballSpec('badbound');
        spec.marchBound = { type: 'quad', values: (v: Record<string, number | number[]>) => v } as never;
        expect(() => defineSDF(spec)).toThrow(/bounding primitive/);
    });
});

describe('defineSDF — compile-time gates (the Validator samples the twin)', () => {
    it('an honest bound compiles clean, end to end', () => {
        defineSDF(ballSpec('honest'));
        const result = compiler.compile(sceneWith('honest'), strategy);
        expect(result.shaders.size).toBeGreaterThan(0);
    });

    it('a bound shrunk 10% is a COMPILE ERROR naming the clip', () => {
        defineSDF(ballSpec('clipped', 0.9));
        expect(() => compiler.compile(sceneWith('clipped'), strategy)).toThrow(/CLIPS the field/);
    });

    it('the demo scene compiles (gyroid + tangle through the whole pipeline)', () => {
        const result = compiler.compile(customFieldsScene, customFieldsStrategy);
        expect(result.shaders.size).toBeGreaterThan(0);
    });
});
