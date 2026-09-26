// "Which scene objects are lights?" has ONE answer — samplableEmitterObjects (dataTenants.ts)
// — read by the Analyzer's light count, the Validator's light rules, and lightRosterOf.
// These tests pin the two cases where separate re-derivations used to disagree:
//
//   1. A BLACKBODY material emission. The Planner folded it to a constant spectrum and made
//      the object a light; the Analyzer (raw value) did not count it, and the Validator
//      cast it to a vec3 and crashed with a TypeError.
//   2. An emissive object whose material OMITS sampleAsLight (the default — it is still a
//      light). The equiangular rule only looked for sampleAsLight: true, so the scene got
//      through validation and the generator crashed with a TypeError.
//
// Plus the equiangular + samplable-environment rejection and the maxBounces domain check.

import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { plan } from '../../src/compiler/plan/Planner.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { DiagnosticBag, CompilationError } from '../../src/errors/core/DiagnosticBag.js';
import { lightRosterOf, samplableEmitterObjects } from '../../src/compiler/plan/dataTenants.js';
import { envSelectionProbability } from '../../src/compiler/generate/features/lighting.js';
import type { SceneDescription, RenderStrategy, SpectrumProperty } from '../../src/compiler/types.js';
import type { RenderPlan } from '../../src/compiler/plan/types.js';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';

const BLACKBODY: SpectrumProperty = { blackbody: { kelvin: 3000, scale: 5 } };

function scene(emission: SpectrumProperty, extra: Partial<SceneDescription> = {}): SceneDescription {
    return {
        id: 'census',
        ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1 }, material: 'ground' },
            { type: 'sphere', parameters: { center: [0, 2, 0], radius: 0.5 }, material: 'lamp' },
        ],
        materials: {
            ground: { model: 'lambert', albedo: 0.5 },
            lamp: { model: 'lambert', albedo: 0, emission },
        },
        lights: [],
        ...extra,
    };
}

function strategy(estimator: Partial<RenderStrategy['estimator']> = {}, maxBounces = 4): RenderStrategy {
    return {
        id: 'nee',
        measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces },
        estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' }, ...estimator },
        view: { tonemap: { type: 'reinhard' } },
    };
}

function planOf(s: SceneDescription, st: RenderStrategy) {
    const bag = new DiagnosticBag('test');
    const features = analyze(s);
    validate(features, s, st, bag);
    bag.throwIfErrors();
    return { features, plan: plan(features, s, st, bag) };
}

/** An emitter's light must describe the surface a ray hits (pt ≡ pt-nee needs them equal): its
 *  values are the kind's valuesFromRegion applied to the PLANNED surface's parameters and the
 *  PLANNED material's emission; a mesh light's radiance is its planned material's emission. The
 *  light values and the surface are planned on separate paths (lightRosterOf; the Planner's
 *  object and material planning), so this compares two computations, not one with itself.
 *  Returns how many lights it checked. */
function expectLightsDescribeTheirSurfaces(p: RenderPlan): number {
    let checked = 0;
    for (const l of p.lights) {
        if (l.regionId === undefined) continue;   // delta lights have no surface
        const surface = p.objects.find((o) => o.index === l.regionId) ?? p.meshes.find((m) => m.index === l.regionId);
        expect(surface).toBeDefined();
        const emission = p.materials.find((m) => m.id === surface!.materialId)!.values.emission;
        if (l.kind === 'mesh') {
            expect(l.values.radiance).toEqual(emission);
        } else {
            const fromRegion = LIGHT_KINDS[l.kind].valuesFromRegion;
            if (fromRegion === undefined) continue;   // softbeam: its cone is not a region property
            expect(l.values).toEqual(fromRegion((surface as RenderPlan['objects'][number]).parameters, emission as number[]));
        }
        checked++;
    }
    return checked;
}

/** The compile error's messages, or a failure if it threw anything else (a raw TypeError
 *  is exactly the bug class these tests exist for). */
function compileErrors(s: SceneDescription, st: RenderStrategy): string[] {
    try {
        new Compiler().compile(s, st);
    } catch (e) {
        if (e instanceof CompilationError) return e.getErrors().map((d) => d.message);
        throw e;
    }
    return [];
}

describe('blackbody material emission', () => {
    it('a constant blackbody emitter is a light everywhere: census, Analyzer, Planner, roster', () => {
        const s = scene(BLACKBODY);
        expect(samplableEmitterObjects(s)).toEqual([{ index: 1, kind: 'sphere' }]);
        const { features, plan: p } = planOf(s, strategy());
        expect(features.lighting.totalLightCount).toBe(1);
        expect(p.lights.map((l) => l.kind)).toEqual(['sphere']);
        expect(p.program.estimator.lighting).not.toBeNull();   // NEE really is on
        expect(expectLightsDescribeTheirSurfaces(p)).toBe(1);
        expect(() => new Compiler().compile(s, strategy({ directLighting: 'mis' }))).not.toThrow();
    });

    it('a blackbody MESH emitter joins the roster with its folded radiance (not the raw spelling)', () => {
        const quad: SceneDescription['objects'][number] = {
            kind: 'mesh',
            positions: new Float32Array([-1, 2, -1, 1, 2, -1, 1, 2, 1, -1, 2, 1]),
            indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
            material: 'lamp',
        };
        const s = scene(BLACKBODY);
        s.objects = [s.objects[0], quad];
        const { plan: p } = planOf(s, strategy());
        expect(p.lights.map((l) => l.kind)).toEqual(['mesh']);
        expect(Array.isArray(lightRosterOf(s)[0].values.radiance)).toBe(true);
        expect(expectLightsDescribeTheirSurfaces(p)).toBe(1);
    });

    it('a DRIVEN blackbody is not a samplable light (v1: power must bake) — it is path-found', () => {
        const s = scene({ blackbody: { kelvin: { param: 'lamp.kelvin', default: 3000 }, scale: 5 } });
        s.lights = [{ kind: 'point', position: [0, 4, 0], emission: 10 }];
        expect(samplableEmitterObjects(s)).toEqual([]);
        const { plan: p } = planOf(s, strategy());
        expect(p.lights.map((l) => l.kind)).toEqual(['point']);
    });

    it('a zero-scale blackbody emits nothing and is not a light', () => {
        const s = scene({ blackbody: { kelvin: 3000, scale: 0 } });
        s.lights = [{ kind: 'point', position: [0, 4, 0], emission: 10 }];
        expect(samplableEmitterObjects(s)).toEqual([]);
        expect(compileErrors(s, strategy())).toEqual([]);
    });

    it('blackbody emission on a model that cannot emit is the phantom-light error, not a crash', () => {
        const s = scene(BLACKBODY);
        s.materials.lamp = { model: 'mirror', emission: BLACKBODY };
        s.lights = [{ kind: 'point', position: [0, 4, 0], emission: 10 }];
        expect(compileErrors(s, strategy()).some((m) => /emission dispatch returns zero/.test(m))).toBe(true);
    });
});

describe("an emitter's light values describe its planned surface", () => {
    it('emissive objects (moved, rotated, scaled; scalar, vec3 and blackbody emission), authored area lights, and a mesh', () => {
        const s: SceneDescription = {
            id: 'emitters',
            ambientSpace: { type: 'euclidean' },
            objects: [
                { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1 }, material: 'ground' },
                { type: 'sphere', parameters: { center: [0, 2, 0], radius: 0.5 }, material: 'scalarLamp',
                    transform: { position: [1, 0, -2], scale: 1.5 } },
                { type: 'quad', parameters: { corner: [-0.5, 3, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'colorLamp',
                    transform: { position: [0.3, -0.2, 0.1], rotation: { axis: [0, 1, 1], angle: 0.7 }, scale: 2 } },
                { type: 'disk', parameters: { center: [2, 3, 1], normal: [0, -1, 0], radius: 0.4 }, material: 'blackbodyLamp',
                    transform: { rotation: { axis: [1, 0, 0], angle: 0.4 } } },
                {
                    kind: 'mesh', material: 'colorLamp',
                    positions: new Float32Array([-1, 4, -1, 1, 4, -1, 1, 4, 1, -1, 4, 1]),
                    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
                    transform: { position: [0, 0.5, 0], scale: 0.5 },
                },
            ],
            materials: {
                ground: { model: 'lambert', albedo: 0.5 },
                scalarLamp: { model: 'lambert', albedo: 0, emission: 3 },
                colorLamp: { model: 'lambert', albedo: 0, emission: [1, 2, 3] },
                blackbodyLamp: { model: 'lambert', albedo: 0, emission: { blackbody: { kelvin: 4500, scale: 2 } } },
            },
            lights: [
                { kind: 'quad', corner: [-3, 5, -3], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 4 },
                { kind: 'disk', position: [3, 5, 3], radius: 0.5, normal: [0, -1, 0.2], emission: [2, 1, 0.5] },
            ],
        };
        const { plan: p } = planOf(s, strategy());
        expect(expectLightsDescribeTheirSurfaces(p)).toBe(6);   // 3 objects, 2 authored lights, 1 mesh
    });
});

describe('equiangular medium sampling: only delta lights, found through the census', () => {
    const fog = { fog: { model: 'none', medium: { sigma_a: 0.01, sigma_s: 0.1 } } };
    const equiangular = strategy({ mediumLightSampling: 'equiangular' });

    function fogScene(sampleAsLight: boolean | undefined): SceneDescription {
        const s = scene(10, { ambientMedium: 'fog', lights: [{ kind: 'point', position: [2, 3, 1], emission: 20 }] });
        Object.assign(s.materials, fog);
        if (sampleAsLight !== undefined) s.materials.lamp.sampleAsLight = sampleAsLight;
        return s;
    }

    it('rejects an emissive sphere that is a light by DEFAULT (sampleAsLight omitted) — a diagnostic, not a TypeError', () => {
        expect(compileErrors(fogScene(undefined), equiangular).some((m) => /DELTA lights only/.test(m))).toBe(true);
    });

    it('rejects it with sampleAsLight: true too', () => {
        expect(compileErrors(fogScene(true), equiangular).some((m) => /DELTA lights only/.test(m))).toBe(true);
    });

    it('accepts it once the emitter opts out (sampleAsLight: false — path-traced only)', () => {
        expect(compileErrors(fogScene(false), equiangular)).toEqual([]);
    });

    it('rejects a samplable environment, whose in-medium single scattering nothing would count', () => {
        const s = fogScene(false);
        s.environment = { type: 'constant', color: 0.5, sampleAsLight: true };
        expect(compileErrors(s, equiangular).some((m) => /samplable environment/.test(m))).toBe(true);
        s.environment = { type: 'constant', color: 0.5 };   // not sampled: fine
        expect(compileErrors(s, equiangular)).toEqual([]);
    });
});

describe('constant environment color: every SpectrumValue spelling compiles', () => {
    // Same bug class as the blackbody material: the Planner passed the authored color through
    // unnormalized, so a scalar crashed the GLSL formatter, and the NEE selection-probability
    // closure turned a driven blackbody into NaN.
    const spellings: Array<[string, SpectrumProperty]> = [
        ['scalar', 0.5],
        ['vec3', [0.4, 0.5, 0.6]],
        ['scalar {param}', { param: 'sky.level', default: 0.5 }],
        ['constant blackbody', { blackbody: { kelvin: 6500, scale: 0.5 } }],
        ['driven blackbody', { blackbody: { kelvin: { param: 'sky.kelvin', default: 6500 }, scale: 0.5 } }],
    ];
    for (const [name, color] of spellings) {
        it(`${name}, sampled as a light beside a point light (NEE selection splits power)`, () => {
            const s = scene(0, { environment: { type: 'constant', color: color as never, sampleAsLight: true } });
            s.lights = [{ kind: 'point', position: [0, 4, 0], emission: 10 }];
            expect(compileErrors(s, strategy({ directLighting: 'mis' }))).toEqual([]);
            const { plan: p } = planOf(s, strategy({ directLighting: 'mis' }));
            const pEnv = envSelectionProbability(p);
            expect(Number.isFinite(pEnv) && pEnv > 0 && pEnv < 1, `P(sample env) = ${pEnv}`).toBe(true);
        });
    }
});

describe('measurement.maxBounces', () => {
    it('must be a non-negative integer (it is spliced into the walk as an integer loop bound)', () => {
        const s = scene(10);
        for (const bad of [2.5, -1, Number.NaN]) {
            expect(compileErrors(s, strategy({}, bad)).some((m) => /maxBounces must be an integer from 0 to/.test(m)), `maxBounces ${bad}`).toBe(true);
        }
        expect(compileErrors(s, strategy({}, 0))).toEqual([]);
    });

    it('the walk does maxBounces + 1 intersections and stops NEE/continuation at the budget', () => {
        const r = new Compiler().compile(scene(10), strategy({}, 3));
        const main = [...r.shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment;
        expect(main).toContain('for (int bounce = 0; bounce <= 3; bounce++)');
        const walk = main.slice(main.indexOf('Radiance transport_trace(Ray ray) {'));
        // The budget break sits between scoring emission and the NEE call.
        const emit = walk.indexOf('kernel_score_emitter_hit(');
        const stop = walk.indexOf('if (bounce == 3) break;');
        const nee = walk.indexOf('light_sample_direct(');
        expect(emit).toBeGreaterThan(0);
        expect(stop).toBeGreaterThan(emit);
        expect(nee).toBeGreaterThan(stop);
    });
});

// Batch instance lights are finite lights under 'bvh': with a samplable environment the
// env-vs-finite selection draw is live, so its uniform must be declared. The decision used
// to count only registry lights, so a scene whose only finite lights were a batch linked
// against an undeclared u_envSelectProb (Sep 25 audit, C2).
describe('env selection with batch lights only (bvh)', () => {
    it('declares u_envSelectProb whenever the program reads it', async () => {
        const { instanceLightsTwin, instanceLightsNeeStrategy, instanceLightsMisStrategy } = await import('../witnesses/scenes/instanceLightsWitness.js');
        const withSky: SceneDescription = {
            ...instanceLightsTwin,
            environment: { type: 'constant', color: [0.2, 0.3, 0.5], intensity: 1, sampleAsLight: true },
        };
        for (const strategy of [instanceLightsNeeStrategy, instanceLightsMisStrategy]) {
            const renderer = new Compiler().compile(withSky, strategy);
            const fragment = renderer.shaders.get(`${renderer.id}-main`)!.fragment;
            expect(fragment).toContain('u_envSelectProb');
            expect(fragment).toMatch(/uniform float u_envSelectProb;/);
        }
    });
});
