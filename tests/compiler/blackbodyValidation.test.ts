// Malformed blackbody values are reported by the Validator in both color models. The census and
// the Validator never throw on them, and a compile stops with a CompilationError rather than
// crashing later. The kelvin slider's range contains its default.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

function scene(): SceneDescription {
    return {
        id: 'blackbody-validation', ambientSpace: { type: 'euclidean' },
        objects: [{ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' }],
        materials: { m: { model: 'lambert', albedo: 0.5 } },
        lights: [{ kind: 'point', position: [0, 5, 0], emission: 10 }],
        environment: { type: 'constant', color: [0.1, 0.1, 0.1] },
    };
}

function strategy(color: 'rgb' | 'spectral'): RenderStrategy {
    return {
        id: color,
        measurement: { color, camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
        estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}

const malformed: Record<string, (s: SceneDescription) => void> = {
    'a numeric kelvin parameter path': (s) => { s.lights[0].emission = { blackbody: { kelvin: { param: 5, default: 3000 } } } as never; },
    'a numeric scale parameter path': (s) => { s.lights[0].emission = { blackbody: { kelvin: 3000, scale: { param: 7, default: 1 } } } as never; },
    'blackbody: null': (s) => { s.lights[0].emission = { blackbody: null } as never; },
    'blackbody: undefined, as the sky': (s) => { s.environment = { type: 'constant', color: { blackbody: undefined } as never }; },
    'blackbody as an array': (s) => { s.lights[0].emission = { blackbody: [3000, 1] } as never; },
    'a misspelled scale': (s) => { s.lights[0].emission = { blackbody: { kelvin: 3000, scael: 5 } } as never; },
    'no kelvin': (s) => { s.lights[0].emission = { blackbody: { scale: 2 } } as never; },
};

describe('malformed blackbody values', () => {
    for (const [name, mutate] of Object.entries(malformed)) for (const color of ['rgb', 'spectral'] as const) {
        it(`${name} (${color}): reported, not thrown`, () => {
            const s = scene();
            mutate(s);
            const bag = new DiagnosticBag('test');
            expect(() => validate(analyze(s), s, strategy(color), bag)).not.toThrow();
            expect(bag.getErrors().some((d) => /blackbody/.test(d.message))).toBe(true);
            let thrown: unknown;
            try { new Compiler().compileScene(s, [strategy(color)]); } catch (err) { thrown = err; }
            expect(String(thrown)).toMatch(/^CompilationError/);
        });
    }
});

describe('kelvin slider', () => {
    const range = (kelvin: object) => {
        const s = scene();
        s.lights[0].emission = { blackbody: { kelvin } } as never;
        return new Compiler().compileScene(s, [strategy('spectral')]).renderers[0].parameters!['lamp.k'].range!;
    };

    it('spans the default UI range when the default lies in it', () => {
        expect(range({ param: 'lamp.k', default: 3000 })).toEqual([1000, 12000]);
    });

    it('a shared temperature slider keeps the range its first declaration gives, in both color models', () => {
        for (const color of ['rgb', 'spectral'] as const) {
            const s = scene();
            s.materials.m.emission = { blackbody: { kelvin: { param: 'lamp.k', default: 3000, min: 2000, max: 5000 } } } as never;
            s.materials.m2 = { model: 'lambert', albedo: 0.5, emission: { blackbody: { kelvin: { param: 'lamp.k', default: 3000 }, scale: 2 } } } as never;
            s.objects.push({ type: 'sphere', parameters: { center: [3, 0, 0], radius: 1 }, material: 'm2' });
            const params = new Compiler().compileScene(s, [strategy(color)]).renderers[0].parameters!;
            expect(params['lamp.k'].range, color).toEqual([2000, 5000]);
        }
    });

    it('reaches a default above that range', () => {
        const [lo, hi] = range({ param: 'lamp.k', default: 20000 });
        expect(lo).toBeLessThanOrEqual(20000);
        expect(hi).toBeGreaterThanOrEqual(20000);
    });
});
