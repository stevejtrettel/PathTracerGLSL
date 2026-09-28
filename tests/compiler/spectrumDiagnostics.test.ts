// What the compiler says about spectrum values it should not accept. Each case records, in both
// colour models, the validator's sorted errors and warnings and the outcome of a full compile:
// its warnings, or the message it throws. A change to any diagnostic shows up here.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

function baseScene(): SceneDescription {
    return {
        id: 'diagnostics', ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' },
            { type: 'sphere', parameters: { center: [3, 0, 0], radius: 1 }, material: 'glass' },
            { type: 'sphere', parameters: { center: [-3, 0, 0], radius: 1 }, material: 'fog' },
        ],
        materials: {
            m: { model: 'lambert', albedo: 0.5 },
            glass: { model: 'dielectric', ior: 1.5 },
            fog: { model: 'none', medium: { sigma_a: 0.1 } },
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

type Mutation = (s: SceneDescription) => void;
const blackbody = (kelvin: unknown, scale?: unknown) => ({ blackbody: { kelvin, ...(scale === undefined ? {} : { scale }) } });
const quad = (edge2: [number, number, number], emission: unknown) => ({
    kind: 'quad', corner: [-0.5, 4, -0.5], edge1: [1, 0, 0], edge2, emission,
});
// Authored values are deliberately outside the declared types: these are the inputs a scene
// author can write by mistake.
const set = (path: (s: any) => void): Mutation => (s) => path(s as any);

const cases: Record<string, Mutation> = {
    // A kind in a slot that does not take it.
    'blackbody as albedo': set((s) => { s.materials.m.albedo = blackbody(3000); }),
    'blackbody as medium sigma_a': set((s) => { s.materials.fog.medium.sigma_a = blackbody(3000); }),
    'blackbody as medium emission': set((s) => { s.materials.fog.medium.emission = blackbody(3000); }),
    'blackbody as surface ior': set((s) => { s.materials.glass.ior = blackbody(3000); }),
    'cauchy as albedo': set((s) => { s.materials.m.albedo = { cauchy: [1.5, 0.004] }; }),
    'cauchy as material emission': set((s) => { s.materials.m.emission = { cauchy: [1.5, 0.004] }; }),
    'cauchy as light emission': set((s) => { s.lights[0].emission = { cauchy: [1.5, 0.004] }; }),
    'cauchy as sky color': set((s) => { s.environment.color = { cauchy: [1.5, 0.004] }; }),
    'cauchy as medium emission': set((s) => { s.materials.fog.medium.emission = { cauchy: [1.5, 0.004] }; }),
    'cauchy as medium ior': set((s) => { s.materials.fog.medium.ior = { cauchy: [1.5, 0.004] }; }),
    'sellmeier as albedo': set((s) => { s.materials.m.albedo = { sellmeier: { B: [1, 0, 0], C: [0.01, 0, 0] } }; }),
    'sellmeier as medium ior': set((s) => { s.materials.fog.medium.ior = { sellmeier: { B: [1, 0, 0], C: [0.01, 0, 0] } }; }),
    // Bad numbers inside a kind.
    'blackbody kelvin below range': set((s) => { s.lights[0].emission = blackbody(500); }),
    'blackbody kelvin slider default above range': set((s) => { s.lights[0].emission = blackbody({ param: 'lamp.k', default: 50000 }); }),
    'blackbody kelvin slider min above max': set((s) => { s.lights[0].emission = blackbody({ param: 'lamp.k', default: 3000, min: 5000, max: 2000 }); }),
    'blackbody negative scale': set((s) => { s.lights[0].emission = blackbody(3000, -1); }),
    'blackbody negative scale on a non-emitting model': set((s) => { s.materials.glass.emission = blackbody(3000, -1); }),
    'cauchy nonpositive A': set((s) => { s.materials.glass.ior = { cauchy: [0, 0.004] }; }),
    'cauchy negative B': set((s) => { s.materials.glass.ior = { cauchy: [1.5, -0.004] }; }),
    'cauchy too few coefficients': set((s) => { s.materials.glass.ior = { cauchy: [1.5] }; }),
    'sellmeier pole inside the visible range': set((s) => { s.materials.glass.ior = { sellmeier: { B: [1, 0, 0], C: [0.25, 0, 0] } }; }),
    'sellmeier negative B': set((s) => { s.materials.glass.ior = { sellmeier: { B: [-1, 0, 0], C: [0.01, 0, 0] } }; }),
    'sellmeier wrong length': set((s) => { s.materials.glass.ior = { sellmeier: { B: [1, 0], C: [0.01, 0] } }; }),
    // Light shape checks with and without a blackbody.
    'zero-area quad light, RGB emission': set((s) => { s.lights.push(quad([0, 0, 0], 5)); }),
    'zero-area quad light, blackbody emission': set((s) => { s.lights.push(quad([0, 0, 0], blackbody(3000))); }),
    // Values no kind recognizes, or two kinds' keys at once.
    'unknown object as albedo': set((s) => { s.materials.m.albedo = { foo: 1 }; }),
    'unknown object as light emission': set((s) => { s.lights[0].emission = { foo: 1 }; }),
    'unknown object as surface ior': set((s) => { s.materials.glass.ior = { foo: 1 }; }),
    'blackbody and Cauchy keys together': set((s) => { s.lights[0].emission = { ...blackbody(3000), cauchy: [1.5, 0.01] }; }),
    'blackbody and param keys together': set((s) => { s.lights[0].emission = { ...blackbody(3000), param: 'lamp.x', default: [1, 1, 1] }; }),
    // Role domains: the same in both colour models, except reflectance above 1 (spectral only).
    'material emission slider default -1': set((s) => { s.materials.m.emission = { param: 'm.glow', default: -1 }; }),
    'medium emission -1': set((s) => { s.materials.fog.medium.emission = -1; }),
    'albedo 1.5': set((s) => { s.materials.m.albedo = 1.5; }),
    'albedo -0.1': set((s) => { s.materials.m.albedo = -0.1; }),
    'glass tint -0.2': set((s) => { s.materials.glass.transmittance = -0.2; }),
    'albedo slider max -1': set((s) => { s.materials.m.albedo = { param: 'm.a', default: 0.5, max: -1 }; }),
    'albedo slider max not a number': set((s) => { s.materials.m.albedo = { param: 'm.a', default: 0.5, min: 0, max: 'x' }; }),
    'light emission slider min -1': set((s) => { s.lights[0].emission = { param: 'lamp.e', default: 5, min: -1 }; }),
    'light emission slider min above max': set((s) => { s.lights[0].emission = { param: 'lamp.e', default: 5, min: 9, max: 2 }; }),
    'emission slider min -1 on a non-emitting model': set((s) => { s.materials.glass.emission = { param: 'g.e', default: 1, min: -1 }; }),
    'expression as sky color': set((s) => { s.environment.color = { kind: 'glsl', source: 'vec3(0.1)' }; }),
    'expression and blackbody keys together': set((s) => { s.materials.m.emission = { kind: 'glsl', source: 'vec3(1.0)', ...blackbody(3000) }; }),
};

function outcome(mutate: Mutation, color: 'rgb' | 'spectral') {
    const scene = baseScene();
    mutate(scene);
    const bag = new DiagnosticBag('test');
    let validator: unknown;
    try {
        validate(analyze(scene), scene, strategy(color), bag);
        validator = {
            errors: bag.getErrors().map((d) => d.message).sort(),
            warnings: bag.getWarnings().map((d) => d.message).sort(),
        };
    } catch (err) {
        validator = { threw: String(err) };
    }
    let compile: unknown;
    try {
        compile = { warnings: [...new Compiler().compileScene(scene, [strategy(color)]).warnings].sort() };
    } catch (err) {
        compile = { threw: String(err) };
    }
    return { validator, compile };
}

describe('spectrum diagnostics', () => {
    it('the base scene compiles cleanly in both colour models', () => {
        for (const color of ['rgb', 'spectral'] as const) {
            expect(outcome(() => {}, color).validator).toEqual({ errors: [], warnings: [] });
        }
    });
    for (const [name, mutate] of Object.entries(cases)) {
        it(name, () => {
            expect({ rgb: outcome(mutate, 'rgb'), spectral: outcome(mutate, 'spectral') }).toMatchSnapshot();
        });
    }
});
