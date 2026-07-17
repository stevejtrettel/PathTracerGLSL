import { describe, it, expect } from 'vitest';
import { plan } from '../../src/compiler/plan/Planner.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

const strategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

function sceneWithMaterials(order: string[]): SceneDescription {
    const materials: SceneDescription['materials'] = {};
    for (const name of order) materials[name] = { model: 'lambert' };
    return {
        id: 's',
        ambientSpace: { type: 'euclidean' },
        objects: [],
        materials,
        lights: [],
    };
}

function idsByName(order: string[]): Record<string, number> {
    const scene = sceneWithMaterials(order);
    const p = plan(analyze(scene), scene, strategy, new DiagnosticBag('test'));
    const map: Record<string, number> = {};
    for (const m of p.materials) map[m.name] = m.id;
    return map;
}

describe('material ID assignment', () => {
    // Naming batch N1 (audit P1): identity is STRUCTURAL — authored (insertion) order
    // assigns ids, symmetric with objects/regions. Names are provenance: renaming a
    // material does NOT renumber; reordering the description DOES (it is a different
    // description). Integer-like names (JS iterates them first) are Validator-rejected.
    it('assigns dense IDs from 0 in AUTHORED (insertion) order', () => {
        const a = idsByName(['zebra', 'apple', 'mango']);
        expect(a).toEqual({ zebra: 0, apple: 1, mango: 2 });
    });

    it('renaming a material does not change any id (names are provenance, not identity)', () => {
        const before = idsByName(['floor', 'clay', 'glass']);
        const after = idsByName(['floor', 'zzz_clay', 'glass']);
        expect([before.floor, before.glass]).toEqual([after.floor, after.glass]);
        expect(after.zzz_clay).toBe(before.clay);
    });

    it('IDs are contiguous starting at 0', () => {
        const scene = sceneWithMaterials(['b', 'a', 'c', 'd']);
        const ids = plan(analyze(scene), scene, strategy, new DiagnosticBag('test')).materials.map(m => m.id).sort((x, y) => x - y);
        expect(ids).toEqual([0, 1, 2, 3]);
    });
});
