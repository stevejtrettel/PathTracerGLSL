import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import type { SceneDescription, GlslExpression, ValueParam } from '../../src/compiler/types.js';

function scene(partial: Partial<SceneDescription>): SceneDescription {
    return {
        id: 's',
        ambientSpace: { type: 'euclidean' },
        objects: [],
        materials: {},
        lights: [],
        ...partial,
    };
}

describe('analyze — geometry', () => {
    it('counts RESOLVED backends (B1: auto = analytic if provided, else sdf; pins override)', () => {
        const f = analyze(scene({
            objects: [
                { type: 'sphere', parameters: {}, material: 'm' },                    // auto → analytic
                { type: 'box', parameters: {}, material: 'm' },                       // sdf-only → sdf
                { type: 'sphere', parameters: {}, material: 'm', backend: 'sdf' },    // pinned → sdf
                { kind: 'mesh', data: new Float32Array(0), material: 'm' },
            ],
        }));
        expect(f.geometry.sdfCount).toBe(2);
        expect(f.geometry.analyticCount).toBe(1);
        expect(f.geometry.hasSDFs).toBe(true);
        expect(f.geometry.hasAnalytic).toBe(true);
        expect(f.geometry.hasMeshes).toBe(true);
    });

    it('empty scene → all geometry false / zero', () => {
        const f = analyze(scene({}));
        expect(f.geometry.hasSDFs).toBe(false);
        expect(f.geometry.hasAnalytic).toBe(false);
        expect(f.geometry.hasMeshes).toBe(false);
        expect(f.geometry.sdfCount).toBe(0);
    });
});

describe('analyze — materials & procedural detection', () => {
    it('sets per-model booleans from material.model', () => {
        const f = analyze(scene({
            materials: {
                a: { model: 'lambert' },
                b: { model: 'dielectric' },
            },
        }));
        expect(f.materials.hasLambert).toBe(true);
        expect(f.materials.hasDielectric).toBe(true);
        expect(f.materials.hasDisney).toBe(false);
        expect(f.materials.hasEmissive).toBe(false);
    });

    it('flags hasProcedural only for GlslExpression properties', () => {
        const glsl: GlslExpression = { kind: 'glsl', source: 'vec3(0.5)' };
        const f = analyze(scene({ materials: { a: { model: 'lambert', albedo: glsl } } }));
        expect(f.materials.hasProcedural).toBe(true);
    });

    it('does NOT count a ValueParam ({param}) as procedural', () => {
        const p: ValueParam<number> = { param: 'a.roughness' };
        const f = analyze(scene({ materials: { a: { model: 'lambert', roughness: p } } }));
        expect(f.materials.hasProcedural).toBe(false);
    });

    it('does not count constant numeric/vec properties as procedural', () => {
        const f = analyze(scene({ materials: { a: { model: 'lambert', albedo: [0.5, 0.5, 0.5], roughness: 0.3 } } }));
        expect(f.materials.hasProcedural).toBe(false);
    });
});

describe('analyze — lighting', () => {
    it('counts point vs directional and keeps totalLightCount consistent', () => {
        const f = analyze(scene({
            lights: [
                { kind: 'point', position: [0, 0, 0], emission: 1 },
                { kind: 'point', position: [1, 0, 0], emission: 1 },
                { kind: 'directional', direction: [0, -1, 0], emission: 1 },
            ],
        }));
        expect(f.lighting.pointLightCount).toBe(2);
        expect(f.lighting.directionalLightCount).toBe(1);
        expect(f.lighting.totalLightCount).toBe(3);
        expect(f.lighting.totalLightCount).toBe(
            f.lighting.pointLightCount + f.lighting.directionalLightCount,
        );
    });
});

describe('analyze — ambient space', () => {
    it('passes the ambient space type through', () => {
        expect(analyze(scene({ ambientSpace: { type: 'hyperbolic' } })).ambientSpace).toBe('hyperbolic');
    });
});
