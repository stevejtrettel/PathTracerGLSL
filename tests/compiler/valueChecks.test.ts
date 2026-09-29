// Each value is checked once (docs/claude-spectrum-fields.md, "Step 4 in full"): a value has only
// its form's keys, and a slider's default lies between its own min and max. These hold for a
// setting's own value, a named kind's numbers and a formula's parameters, in both color models.
// Each case pairs a mistaken value with the same value corrected, which gets no error.

import { describe, it, expect } from 'vitest';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

function scene(): SceneDescription {
    return {
        id: 'value-checks', ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' },
            { type: 'sphere', parameters: { center: [3, 0, 0], radius: 1 }, material: 'glass' },
        ],
        materials: {
            m: { model: 'lambert', albedo: 0.5 },
            glass: { model: 'dielectric', ior: 1.5 },
        },
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

// Authored values are deliberately outside the declared types.
type Mutation = (s: any) => void;
const albedo = (value: unknown): Mutation => (s) => { s.materials.m.albedo = value; };
const lamp = (value: unknown): Mutation => (s) => { s.lights[0].emission = value; };
const glassIor = (value: unknown): Mutation => (s) => { s.materials.glass.ior = value; };
const formula = (param: object) => ({ kind: 'glsl', source: 'vec3(u_m_g)', params: [{ param: 'm.g', ...param }] });

/** [what is mistaken, the mistaken value, the corrected value, what the error names] */
const cases: Array<[string, Mutation, Mutation, RegExp]> = [
    ['a key beside a named kind',
        lamp({ blackbody: { kelvin: 3000 }, scale: 5 }), lamp({ blackbody: { kelvin: 3000, scale: 5 } }), /'scale'/],
    ['an unknown key inside a Gaussian',
        albedo({ gaussian: { center: 600, width: 20, peak: 0.8, flor: 0.1 } }),
        albedo({ gaussian: { center: 600, width: 20, peak: 0.8, floor: 0.1 } }), /'flor'/],
    ['an unknown key inside a Sellmeier',
        glassIor({ sellmeier: { B: [1, 0, 0], C: [0.01, 0, 0], D: [1, 1, 1] } }),
        glassIor({ sellmeier: { B: [1, 0, 0], C: [0.01, 0, 0] } }), /'D'/],
    ['a misspelled slider key',
        albedo({ param: 'm.a', default: 0.5, mn: 0 }), albedo({ param: 'm.a', default: 0.5, min: 0 }), /'mn'/],
    ['a misspelled key on a blackbody slider',
        lamp({ blackbody: { kelvin: { param: 'l.k', default: 3000, mn: 1000 } } }),
        lamp({ blackbody: { kelvin: { param: 'l.k', default: 3000, min: 1000 } } }), /'mn'/],
    ['a misspelled key on a formula',
        albedo({ kind: 'glsl', source: 'vec3(0.5)', sorce: 'vec3(0.5)' }), albedo({ kind: 'glsl', source: 'vec3(0.5)' }), /'sorce'/],
    ['a misspelled key on a formula parameter',
        albedo(formula({ default: 0.5, mn: 0 })), albedo(formula({ default: 0.5, min: 0 })), /'mn'/],
    ['a slider default above its max',
        albedo({ param: 'm.a', default: 0.9, min: 0, max: 0.5 }), albedo({ param: 'm.a', default: 0.9, min: 0, max: 1 }), /default must be <= max/],
    ['a blackbody slider default above its max',
        lamp({ blackbody: { kelvin: { param: 'l.k', default: 6000, min: 2000, max: 4000 } } }),
        lamp({ blackbody: { kelvin: { param: 'l.k', default: 6000, min: 2000, max: 8000 } } }), /default must be <= max/],
    ['a formula whose params is not a list',
        albedo({ kind: 'glsl', source: 'vec3(0.5)', params: 'abc' }), albedo({ kind: 'glsl', source: 'vec3(0.5)' }), /params must be a list/],
    ['a formula parameter default above its max',
        albedo(formula({ default: 5, min: 0, max: 1 })), albedo(formula({ default: 0.5, min: 0, max: 1 })), /default must be <= max/],
];

function errors(mutate: Mutation, color: 'rgb' | 'spectral'): string[] {
    const s = scene();
    mutate(s);
    const bag = new DiagnosticBag('test');
    validate(analyze(s), s, strategy(color), bag);
    return bag.getErrors().map((d) => d.message);
}

describe('each value is checked once', () => {
    for (const [name, mistaken, corrected, names] of cases) for (const color of ['rgb', 'spectral'] as const) {
        it(`${name} is an error (${color})`, () => {
            const found = errors(mistaken, color);
            expect(found.some((m) => names.test(m)), found.join('\n')).toBe(true);
            expect(errors(corrected, color)).toEqual([]);
        });
    }
});

describe('a slider default of the wrong shape', () => {
    it('gets only its shape message, not a comparison with the bounds', () => {
        for (const color of ['rgb', 'spectral'] as const) {
            expect(errors(glassIor({ param: 'g.n', default: [2, 2, 2], max: 1.5 }), color)).toEqual(["Material 'glass': ior must be a finite number"]);
        }
    });
});
