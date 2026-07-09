import { describe, it, expect } from 'vitest';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

function baseScene(): SceneDescription {
    return {
        id: 's',
        ambientSpace: { type: 'euclidean' },
        objects: [{ kind: 'sdf', sdf: { type: 'sphere', parameters: { radius: 1 } }, material: 'm' }],
        materials: { m: { model: 'lambert' } },
        lights: [{ kind: 'point', position: [0, 5, 0], intensity: 10 }],
    };
}

function baseStrategy(): RenderStrategy {
    return {
        id: 'pt',
        transport: { maxBounces: 4, directLighting: 'nee', russianRoulette: { enabled: false, startDepth: 0 }, samplesPerFrame: 1 },
        camera: { type: 'pinhole', fov: 0.8 },
        accumulation: { type: 'average' },
        display: { type: 'reinhard' },
    };
}

/** Run analyze + validate on (possibly mutated) scene/strategy; return the bag. */
function run(mutate: (s: SceneDescription, st: RenderStrategy) => void = () => {}): DiagnosticBag {
    const scene = baseScene();
    const strategy = baseStrategy();
    mutate(scene, strategy);
    const bag = new DiagnosticBag('test');
    validate(analyze(scene), scene, strategy, bag);
    return bag;
}

const codes = (bag: DiagnosticBag) => bag.getErrors().map(e => e.code);

describe('Validator', () => {
    it('accepts a valid scene + strategy with no diagnostics', () => {
        const bag = run();
        expect(bag.isEmpty()).toBe(true);
    });

    it('rejects non-euclidean ambient space', () => {
        const bag = run(s => { s.ambientSpace = { type: 'hyperbolic' }; });
        expect(codes(bag)).toContain('invalid-setting');
        expect(bag.getErrors().some(e => /ambient space/i.test(e.message))).toBe(true);
    });

    it('rejects mesh geometry', () => {
        const bag = run(s => { s.objects.push({ kind: 'mesh', data: new Float32Array(0), material: 'm' }); });
        expect(bag.getErrors().some(e => e.code === 'missing-geometry' && /mesh/i.test(e.message))).toBe(true);
    });

    it('rejects analytic geometry', () => {
        const bag = run(s => { s.objects.push({ kind: 'analytic', shape: { type: 'sphere', parameters: {} }, material: 'm' }); });
        expect(bag.getErrors().some(e => e.code === 'missing-geometry' && /analytic/i.test(e.message))).toBe(true);
    });

    it('rejects directional lights', () => {
        const bag = run(s => { s.lights.push({ kind: 'directional', direction: [0, -1, 0], intensity: 1 }); });
        expect(bag.getErrors().some(e => e.code === 'invalid-setting' && /directional/i.test(e.message))).toBe(true);
    });

    it('rejects direct lighting requested with no lights', () => {
        const bag = run(s => { s.lights = []; });
        expect(codes(bag)).toContain('incompatible-options');
    });

    it('rejects the disney material model', () => {
        const bag = run(s => { s.materials.m = { model: 'disney' }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-setting' && /disney/i.test(e.message))).toBe(true);
    });

    it('rejects the dielectric material model', () => {
        const bag = run(s => { s.materials.m = { model: 'dielectric' }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-setting' && /dielectric/i.test(e.message))).toBe(true);
    });

    it('warns (does not error) on an empty scene', () => {
        const bag = run(s => { s.objects = []; });
        expect(bag.hasErrors()).toBe(false);
        expect(bag.getWarnings().some(w => w.code === 'empty-scene')).toBe(true);
    });

    it('rejects non-average accumulation', () => {
        const bag = run((_s, st) => { st.accumulation = { type: 'variance' }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-setting' && /accumulation/i.test(e.message))).toBe(true);
    });

    it('rejects unsupported tonemap types (allows reinhard/none)', () => {
        expect(run((_s, st) => { st.display = { type: 'aces' }; }).getErrors()
            .some(e => e.code === 'invalid-setting' && /tonemap|display/i.test(e.message))).toBe(true);
        expect(run((_s, st) => { st.display = { type: 'none' }; }).isEmpty()).toBe(true);
    });

    it('rejects an object referencing an unknown material (with a suggestion)', () => {
        const bag = run(s => { s.objects[0].material = 'ghost'; });
        const err = bag.getErrors().find(e => e.code === 'missing-material');
        expect(err).toBeDefined();
        expect(err!.suggestions?.length).toBeGreaterThan(0);
    });

    it('rejects rotation and scale transforms', () => {
        expect(run(s => { s.objects[0].transform = { rotation: [0, 1, 0] }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /rotation/i.test(e.message))).toBe(true);
        expect(run(s => { s.objects[0].transform = { scale: 2 }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /scale/i.test(e.message))).toBe(true);
    });

    it('accumulates multiple independent errors in one pass', () => {
        const bag = run(s => {
            s.ambientSpace = { type: 'spherical' };
            s.objects.push({ kind: 'mesh', data: new Float32Array(0), material: 'm' });
        });
        expect(bag.count('error')).toBeGreaterThanOrEqual(2);
    });
});
