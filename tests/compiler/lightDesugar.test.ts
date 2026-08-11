// Light-desugar invariants (audit H6.2): the §6.2 registry construction in plan/Planner.ts —
// the load-bearing "scene order = light id = CDF order" invariant, the sampleAsLight route,
// and the exact-Le sharing between the emission table and the sampler (any mismatch makes
// pt and pt-nee converge to different images — the Planner's own invariant comment).

import { describe, it, expect } from 'vitest';
import { plan } from '../../src/compiler/plan/Planner.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

const strategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

function baseScene(): SceneDescription {
    return {
        id: 's',
        ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'sphere', parameters: { radius: 1 }, material: 'm' },
        ],
        materials: { m: { model: 'lambert' } },
        lights: [],
    };
}

function runPlan(scene: SceneDescription) {
    return plan(analyze(scene), scene, strategy, new DiagnosticBag('test'));
}

describe('explicit-light desugar (§6.2)', () => {
    it('registry order = light id = scene order, across kinds', () => {
        const scene = baseScene();
        scene.lights = [
            { kind: 'point', position: [0, 5, 0], emission: 1 },
            { kind: 'quad', corner: [0, 4, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 2 },
            { kind: 'sphere', position: [3, 3, 3], radius: 0.5, emission: 3 },
        ];
        const p = runPlan(scene);
        expect(p.lights.map((l) => l.id)).toEqual([0, 1, 2]);
        expect(p.lights.map((l) => l.kind)).toEqual(['point', 'quad', 'sphere']);
    });

    it('desugars quad/sphere lights to __light_n regions with black albedo and Le = color·intensity', () => {
        const scene = baseScene();
        scene.lights = [
            { kind: 'quad', corner: [0, 4, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: [5, 2.5, 1.25] },
        ];
        const p = runPlan(scene);
        const emitter = p.materials.find((m) => m.name.startsWith('__light_'));
        expect(emitter).toBeDefined();
        expect(emitter!.model).toBe('lambert');
        expect(emitter!.values.albedo).toEqual([0, 0, 0]);
        // Le shared EXACTLY between emission table and sampler (the invariant comment)
        expect(emitter!.values.emission).toEqual([5, 2.5, 1.25]);
        const light = p.lights[0];
        expect(light.values.radiance).toEqual([5, 2.5, 1.25]);
        // the synthesized region exists and points at the emitter material
        const region = p.objects.find((o) => o.index === light.regionId);
        expect(region).toBeDefined();
        expect(region!.materialId).toBe(emitter!.id);
        expect(region!.type).toBe('quad');
    });

    it('assigns desugared region ids after user objects, in scene order (globally unique)', () => {
        const scene = baseScene();
        scene.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' });
        scene.lights = [
            { kind: 'quad', corner: [0, 4, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 1 },
            { kind: 'sphere', position: [0, 8, 0], radius: 0.2, emission: 1 },
        ];
        const p = runPlan(scene);
        const allIndices = p.objects.map((o) => o.index).sort((a, b) => a - b);
        expect(allIndices).toEqual([0, 1, 2, 3]);   // dense, no collisions
        expect(p.lights[0].regionId).toBe(2);
        expect(p.lights[1].regionId).toBe(3);
    });
});

describe('sampleAsLight route (§6.2)', () => {
    const emissiveQuadScene = (sampleAsLight: boolean | undefined): SceneDescription => {
        const scene = baseScene();
        scene.materials.glow = { model: 'lambert', albedo: 0, emission: [4, 4, 4], ...(sampleAsLight === undefined ? {} : { sampleAsLight }) };
        scene.objects.push({ type: 'quad', parameters: { corner: [0, 4, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'glow' });
        return scene;
    };

    it("emissive analytic quads join the registry by default carrying the radiance product", () => {
        const p = runPlan(emissiveQuadScene(undefined));
        expect(p.lights).toHaveLength(1);
        expect(p.lights[0].kind).toBe('quad');
                expect(p.lights[0].values.radiance).toEqual([4, 4, 4]);   // the registry stores Le directly
    });

    it('sampleAsLight: false excludes the emitter from the registry (path-only glow)', () => {
        const p = runPlan(emissiveQuadScene(false));
        expect(p.lights).toHaveLength(0);
    });

    it('two objects sharing one emissive material become two registry entries (per REGION)', () => {
        const scene = emissiveQuadScene(undefined);
        scene.objects.push({ type: 'sphere', parameters: { center: [2, 4, 0], radius: 0.5 }, material: 'glow' });
        const p = runPlan(scene);
        expect(p.lights).toHaveLength(2);
        expect(new Set(p.lights.map((l) => l.regionId)).size).toBe(2);
    });

    it('uses the translated analytic geometry for both intersection and light sampling', () => {
        const scene = emissiveQuadScene(undefined);
        const quad = scene.objects[1];
        if ('kind' in quad) throw new Error('fixture must be a primitive');
        quad.transform = { position: [2, 3, 4] };

        const p = runPlan(scene);
        const region = p.objects.find((o) => o.index === p.lights[0].regionId)!;
        expect(region.parameters.corner).toEqual([2, 7, 4]);
        expect(p.lights[0].values.corner).toEqual([2, 7, 4]);
    });

    it('desugared __light_n materials are not re-registered by the sampleAsLight sweep', () => {
        const scene = baseScene();
        scene.lights = [{ kind: 'quad', corner: [0, 4, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 1 }];
        const p = runPlan(scene);
        expect(p.lights).toHaveLength(1);   // exactly one entry, not two
    });

    it('both routes produce identical registry entries for the same physical emitter', () => {
        // Route A: explicit light. Route B: authored emissive quad object with the same Le.
        const sceneA = baseScene();
        sceneA.lights = [{ kind: 'quad', corner: [0, 4, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 4 }];
        const sceneB = emissiveQuadScene(undefined);
        const a = runPlan(sceneA).lights[0];
        const b = runPlan(sceneB).lights[0];
        const LeA = a.values.radiance;
        const LeB = b.values.radiance;
        expect(LeA).toEqual(LeB);
        expect(a.values.corner).toEqual(b.values.corner);
        expect(a.values.edge1).toEqual(b.values.edge1);
        expect(a.values.edge2).toEqual(b.values.edge2);
    });
});
