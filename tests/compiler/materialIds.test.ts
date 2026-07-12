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
    it('assigns dense IDs from 0 in localeCompare order regardless of input order', () => {
        const a = idsByName(['zebra', 'apple', 'mango']);
        expect(a).toEqual({ apple: 0, mango: 1, zebra: 2 });
    });

    it('is order-independent — reordering the input materials does not change IDs', () => {
        expect(idsByName(['apple', 'mango', 'zebra'])).toEqual(idsByName(['zebra', 'mango', 'apple']));
    });

    it('IDs are contiguous starting at 0', () => {
        const scene = sceneWithMaterials(['b', 'a', 'c', 'd']);
        const ids = plan(analyze(scene), scene, strategy, new DiagnosticBag('test')).materials.map(m => m.id).sort((x, y) => x - y);
        expect(ids).toEqual([0, 1, 2, 3]);
    });
});
