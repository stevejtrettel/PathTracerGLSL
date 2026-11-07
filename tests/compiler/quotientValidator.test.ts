// The Validator's quotient rules (compiler/analyze/quotient.ts; their reasons are in
// docs/claude-2026-11-review/quotients-plan.md, Q1.5): each rule produces its
// error, and a jungle-gym scene and a wall scene pass. Meshes and instance batches that cross a
// face exercise the world-box code (positions × placement; placements × the prototype's box).

import { describe, it, expect } from 'vitest';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { QUOTIENT_MARGIN } from '../../src/compiler/analyze/quotient.js';
import type { SceneDescription, RenderStrategy, ObjectDescription, PrimitiveObject } from '../../src/compiler/types.js';

// D = [−0.5, 0.5] × [−0.6, 0.6] × [−0.4, 0.4]; 2·diam(D) = 2·√(1 + 1.44 + 0.64) = 3.51.
const SIZE: [number, number, number] = [1.0, 1.2, 0.8];

function scene(): SceneDescription {
    return {
        id: 'q',
        ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: SIZE } },
        objects: [
            { type: 'sphere', parameters: { center: [0.1, 0.1, 0], radius: 0.2 }, material: 'm' },
        ],
        materials: { m: { model: 'lambert', albedo: 0.6 }, glow: { model: 'lambert', albedo: 0, emission: 5 } },
        lights: [{ kind: 'sphere', position: [-0.3, -0.3, 0.1], radius: 0.05, emission: 10 }],
        environment: { type: 'none' },
    };
}

function strategy(): RenderStrategy {
    return {
        id: 'pt-mis',
        measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4, farClip: 4 },
        estimator: { directLighting: 'mis', russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}

function errors(mutate: (s: SceneDescription, st: RenderStrategy) => void = () => {}): string[] {
    const s = scene(), st = strategy();
    mutate(s, st);
    const bag = new DiagnosticBag('test');
    validate(analyze(s), s, st, bag);
    return bag.getErrors().map((e) => e.message);
}
const quotientErrors = (mutate: (s: SceneDescription, st: RenderStrategy) => void = () => {}) =>
    errors(mutate).filter((m) => /quotient/.test(m));

const beam = (axis: 0 | 1 | 2, center: [number, number, number]): ObjectDescription => {
    const half: [number, number, number] = [0.05, 0.05, 0.05];
    half[axis] = SIZE[axis] / 2 + 0.01;
    return { type: 'box', parameters: { center, halfSize: half }, material: 'm' };
};

describe('quotient Validator rules', () => {
    it('accepts the base scene, a jungle gym and a wall scene', () => {
        expect(errors()).toEqual([]);
        expect(errors((s) => {
            s.objects.push(beam(0, [0, -0.3, -0.2]), beam(1, [0.3, 0, -0.2]), beam(2, [0.3, -0.3, 0]));
        })).toEqual([]);
        // A wall: an unrotated box spanning two periods (x and y), thin along z.
        expect(errors((s) => {
            s.objects.push({ type: 'box', parameters: { center: [0, 0, -0.3], halfSize: [0.51, 0.61, 0.02] }, material: 'm' });
        })).toEqual([]);
        expect(QUOTIENT_MARGIN).toBe(0.001);   // EPS_INTERFACE, read from core math
    });

    it('rejects delta lights', () => {
        for (const light of [
            { kind: 'point', position: [0, 0, 0], emission: 1 },
            { kind: 'spot', position: [0, 0, 0], direction: [0, -1, 0], angle: 0.5, emission: 1 },
            { kind: 'directional', direction: [0, -1, 0], emission: 1 },
        ]) {
            expect(quotientErrors((s) => { s.lights.push(light as never); }).some((m) => /delta light/.test(m)), light.kind).toBe(true);
        }
    });

    it('rejects an environment', () => {
        expect(quotientErrors((s) => { s.environment = { type: 'constant', color: [1, 1, 1] }; }).some((m) => /no sky/.test(m))).toBe(true);
    });

    it('requires farClip ≥ 2·diam(D)', () => {
        expect(quotientErrors((_s, st) => { delete st.measurement.farClip; }).some((m) => /farClip is required/.test(m))).toBe(true);
        expect(quotientErrors((_s, st) => { st.measurement.farClip = 3.5; }).some((m) => /below 2·diam/.test(m))).toBe(true);
        expect(quotientErrors((_s, st) => { st.measurement.farClip = 3.52; })).toEqual([]);
    });

    it('accepts a homogeneous ambient fog: absorbing, scattering, emitting, or with {param} coefficients', () => {
        for (const medium of [
            { sigma_a: 0.1 },
            { sigma_a: 0.1, sigma_s: 0.3, phase_g: 0.4 },
            { sigma_a: 0.5, emission: 0.5 },
            { sigma_a: { param: 'fog.absorption', default: 0.1 }, sigma_s: 0.2 },
        ]) {
            expect(errors((s) => {
                s.materials.fog = { model: 'none', medium };
                s.ambientMedium = 'fog';
            }), JSON.stringify(medium)).toEqual([]);
        }
        // An emitting, scattering fog takes the tracking arms (constant coefficients), which
        // need volumeSampling 'delta-tracking' and, as everywhere, NEE rather than MIS.
        expect(errors((s, st) => {
            s.materials.fog = { model: 'none', medium: { sigma_a: 0.1, sigma_s: 0.2, emission: [0.1, 0.2, 0.3] } };
            s.ambientMedium = 'fog';
            st.estimator.directLighting = 'nee';
            st.estimator.volumeSampling = 'delta-tracking';
        })).toEqual([]);
    });

    it('rejects a heterogeneous or GRIN ambient medium, objects with media, null interfaces and GRIN', () => {
        expect(quotientErrors((s) => {
            s.materials.fog = { model: 'none', medium: { sigma_a: { kind: 'glsl', source: '0.1 + 0.05 * p.x' }, majorant: 0.2 } };
            s.ambientMedium = 'fog';
        }).some((m) => /ambientMedium 'fog' is heterogeneous/.test(m))).toBe(true);
        expect(quotientErrors((s) => {
            s.materials.fog = { model: 'none', medium: { sigma_a: 0.1, ior: 1.2 } };
            s.ambientMedium = 'fog';
        }).some((m) => /ambientMedium 'fog' is a gradient-index/.test(m))).toBe(true);
        // A medium-filled object, whatever its medium, and an object made of the ambient fog.
        expect(quotientErrors((s) => {
            s.materials.ink = { model: 'none', medium: { sigma_a: 0.1, sigma_s: 0.2 } };
            s.objects.push({ type: 'sphere', parameters: { center: [-0.2, 0.3, 0], radius: 0.1 }, material: 'ink' });
        }).some((m) => /material 'ink' has a medium/.test(m))).toBe(true);
        expect(quotientErrors((s) => {
            s.materials.fog = { model: 'none', medium: { sigma_a: 0.1 } };
            s.ambientMedium = 'fog';
            s.objects.push({ type: 'sphere', parameters: { center: [-0.2, 0.3, 0], radius: 0.1 }, material: 'fog' });
        }).some((m) => /material 'fog' has a medium/.test(m))).toBe(true);
        expect(quotientErrors((s) => {
            s.materials.lens = { model: 'dielectric', ior: 1.5, medium: { sigma_a: 0, ior: { kind: 'glsl', source: '1.5 - 0.2 * dot(p, p)' } } };
        }).some((m) => /material 'lens' has a medium/.test(m))).toBe(true);
    });

    it('rejects unbounded primitives', () => {
        expect(quotientErrors((s) => {
            s.objects.push({ type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'm' });
        }).some((m) => /unbounded/.test(m))).toBe(true);
    });

    it('rejects objects that cross a face, including within the margin, and rotated spanning boxes', () => {
        expect(quotientErrors((s) => {
            s.objects.push({ type: 'sphere', parameters: { center: [0.45, 0, 0], radius: 0.1 }, material: 'm' });
        }).some((m) => /crosses a face/.test(m))).toBe(true);
        expect(quotientErrors((s) => {
            s.objects.push({ type: 'sphere', parameters: { center: [0.4, 0, 0], radius: 0.1 - QUOTIENT_MARGIN / 2 }, material: 'm' });
        }).some((m) => /crosses a face/.test(m))).toBe(true);
        expect(quotientErrors((s) => {
            s.objects.push({ ...(beam(0, [0, -0.3, -0.2]) as PrimitiveObject), transform: { rotation: { axis: [1, 0, 0], angle: 0.3 } } });
        }).some((m) => /crosses a face/.test(m))).toBe(true);
        // A beam that spans its axis but pokes out of D on another axis.
        expect(quotientErrors((s) => { s.objects.push(beam(0, [0, 0.58, 0])); }).some((m) => /crosses a face/.test(m))).toBe(true);
        // A placed sphere: the transform moves it across the face.
        expect(quotientErrors((s) => {
            s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.1 }, material: 'm', transform: { position: [0, 0, 0.35] } });
        }).some((m) => /crosses a face/.test(m))).toBe(true);
    });

    it('computes world boxes of meshes and instance batches', () => {
        const tri = (dx: number): ObjectDescription => ({
            kind: 'mesh', material: 'm',
            positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]),
            indices: new Uint32Array([0, 1, 2]),
            transform: { position: [dx, 0, 0] },
        });
        expect(quotientErrors((s) => { s.objects.push(tri(0.2)); })).toEqual([]);
        expect(quotientErrors((s) => { s.objects.push(tri(0.45)); }).some((m) => /crosses a face/.test(m))).toBe(true);
        const batch = (dz: number): ObjectDescription => ({
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.05 }, material: 'm' },
            placements: [{ position: [0.2, 0.2, 0] }, { position: [-0.2, 0.1, dz] }],
        });
        expect(quotientErrors((s) => { s.objects.push(batch(0.2)); })).toEqual([]);
        expect(quotientErrors((s) => { s.objects.push(batch(0.37)); }).some((m) => /crosses a face/.test(m))).toBe(true);
        const packed: ObjectDescription = {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.05 }, material: 'm' },
            placements: { count: 2, positions: new Float32Array([0, 0, 0, 0, 0.58, 0]) },
        };
        expect(quotientErrors((s) => { s.objects.push(packed); }).some((m) => /crosses a face/.test(m))).toBe(true);
    });

    it('requires every emitter inside D, a spanning box included', () => {
        expect(quotientErrors((s) => { s.lights[0] = { kind: 'sphere', position: [0.47, 0, 0], radius: 0.05, emission: 10 }; })
            .some((m) => /light 0 \(sphere\) is not inside D/.test(m))).toBe(true);
        expect(quotientErrors((s) => {
            s.objects.push({ type: 'sphere', parameters: { center: [0, 0.55, 0], radius: 0.1 }, material: 'glow' });
        }).some((m) => /emits but is not inside D/.test(m))).toBe(true);
        expect(quotientErrors((s) => { s.objects.push({ ...(beam(0, [0, -0.3, -0.2]) as PrimitiveObject), material: 'glow' }); })
            .some((m) => /emits but is not inside D/.test(m))).toBe(true);
    });

    it('rejects driven placements and parameters', () => {
        expect(quotientErrors((s) => {
            s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.1 }, material: 'm', transform: { position: { param: 'p', default: [0, 0, 0] } } });
        }).some((m) => /driven/.test(m))).toBe(true);
    });

    it('rejects an unknown kind and a kind on the wrong space', () => {
        expect(quotientErrors((s) => { s.ambientSpace.quotient = { kind: 'klein' as 'torus', size: SIZE }; }).some((m) => /unknown kind/.test(m))).toBe(true);
        expect(errors((s) => { s.ambientSpace.type = 'hyperbolic'; }).some((m) => /acts on the euclidean space/.test(m))).toBe(true);
        expect(quotientErrors((s) => { s.ambientSpace.quotient = { kind: 'torus', size: [1, 0, 1] }; }).some((m) => /size must be/.test(m))).toBe(true);
    });
});
