import { describe, it, expect } from 'vitest';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy, PrimitiveObject } from '../../src/compiler/types.js';

function baseScene(): SceneDescription {
    return {
        id: 's',
        ambientSpace: { type: 'euclidean' },
        objects: [{ type: 'sphere', parameters: { radius: 1 }, material: 'm' }],
        materials: { m: { model: 'lambert' } },
        lights: [{ kind: 'point', position: [0, 5, 0], emission: 10 }],
    };
}

function baseStrategy(): RenderStrategy {
    return {
        id: 'pt',
        measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
        estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
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

    it('accepts a well-formed mesh; rejects a malformed one (impl-plan-meshes)', () => {
        const ok = run(s => { s.objects.push({ kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 'm' }); });
        expect(ok.getErrors().length).toBe(0);
        // Out-of-range vertex index must error (would texelFetch garbage on the GPU).
        const bad = run(s => { s.objects.push({ kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 9]), material: 'm' }); });
        expect(bad.getErrors().some(e => e.code === 'invalid-setting' && /index .* out of range/i.test(e.message))).toBe(true);
    });

    it('accepts analytic geometry (closed-form sphere/plane backend)', () => {
        const bag = run(s => { s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' }); });
        expect(bag.hasErrors()).toBe(false);
    });

    it('accepts directional lights (the reserved word became the registered kind — impl-plan-directional-beam)', () => {
        const bag = run(s => { s.lights.push({ kind: 'directional', direction: [0, -1, 0], emission: 1 }); });
        expect(bag.hasErrors()).toBe(false);
    });

    it('accepts beam lights and rejects a non-positive beam radius (row constraint)', () => {
        const ok = run(s => { s.lights.push({ kind: 'beam', position: [0, 2, 0], direction: [0, -1, 0], radius: 0.2, emission: 1 }); });
        expect(ok.hasErrors()).toBe(false);
        const bad = run(s => { s.lights.push({ kind: 'beam', position: [0, 2, 0], direction: [0, -1, 0], radius: 0, emission: 1 }); });
        expect(bad.getErrors().some(e => e.code === 'invalid-setting' && /radius/.test(e.message))).toBe(true);
    });

    it('rejects unknown light kinds with the registered list (never a silent skip)', () => {
        const bag = run(s => { s.lights.push({ kind: 'quadd', corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 1 } as unknown as SceneDescription['lights'][number]); });
        expect(bag.getErrors().some(e => /unknown light kind 'quadd'/.test(e.message) && /point, quad, sphere/.test(e.message))).toBe(true);
    });

    it('rejects a light missing a required authored field (schema-driven, W2)', () => {
        const bag = run(s => { s.lights = [{ kind: 'sphere', position: [0, 5, 0], emission: 5 } as unknown as SceneDescription['lights'][number]]; });
        expect(bag.getErrors().some(e => /required field 'radius' is missing/.test(e.message))).toBe(true);
    });

    it('rejects a light field of the wrong shape (no raw crash — the quad TypeError class)', () => {
        const bag = run(s => { s.lights = [{ kind: 'quad', corner: [0, 0, 0], edge1: [1, 0], edge2: [0, 0, 1], emission: 5 } as unknown as SceneDescription['lights'][number]]; });
        expect(bag.getErrors().some(e => /field 'edge1' must be a vec3/.test(e.message))).toBe(true);
    });

    it('rejects a light with no emission (required, B2 universal word)', () => {
        const bag = run(s => { s.lights = [{ kind: 'point', position: [0, 5, 0] } as unknown as SceneDescription['lights'][number]]; });
        expect(bag.getErrors().some(e => /required field 'emission' is missing/.test(e.message))).toBe(true);
    });

    it("rejects equiangular with an anisotropic delta light (the isotropy pin — spot declares no deltaQuery)", () => {
        const bag = run((s, st) => {
            st.estimator.mediumLightSampling = 'equiangular';
            s.lights = [{ kind: 'spot', position: [0, 5, 0], direction: [0, -1, 0], angle: 0.5, emission: 5 } as unknown as SceneDescription['lights'][number]];
        });
        expect(bag.getErrors().some(e => /ISOTROPIC delta lights/.test(e.message) && /'spot'/.test(e.message))).toBe(true);
    });

    it('warns on unknown light fields (typo class)', () => {
        const bag = run(s => { s.lights = [{ kind: 'point', position: [0, 5, 0], intensity: 3, emission: 5 } as unknown as SceneDescription['lights'][number]]; });
        expect(bag.getWarnings().some(w => /unknown field 'intensity'/.test(w.message))).toBe(true);
    });

    it('rejects direct lighting requested with no lights', () => {
        const bag = run(s => { s.lights = []; });
        expect(codes(bag)).toContain('incompatible-options');
    });

    it('rejects the disney material model', () => {
        const bag = run(s => { s.materials.m = { model: 'disney' }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-setting' && /disney/i.test(e.message))).toBe(true);
    });

    it('accepts the dielectric material model (supported since the dielectric item)', () => {
        const bag = run(s => { s.materials.m = { model: 'dielectric', ior: 1.5 }; });
        expect(bag.getErrors().some(e => /dielectric/i.test(e.message))).toBe(false);
    });

    it('rejects a GLSL-expression ior on a dielectric (ior_of is region-indexed)', () => {
        const bag = run(s => { s.materials.m = { model: 'dielectric', ior: { kind: 'glsl', source: '1.5' } }; });
        expect(bag.getErrors().some(e => /ior/i.test(e.message))).toBe(true);
    });

    it('warns (does not error) on ior set on a non-dielectric material', () => {
        const bag = run(s => { s.materials.m = { model: 'lambert', ior: 1.5 }; });
        expect(bag.hasErrors()).toBe(false);
        expect(bag.getWarnings().some(w => /ior/i.test(w.message))).toBe(true);
    });

    it('rejects an empty scene up front (it cannot link: the intersection program is generated from the objects)', () => {
        const bag = run(s => { s.objects = []; });
        expect(bag.getErrors().some(e => e.code === 'empty-scene')).toBe(true);
    });

    it('rejects unsupported accumulation (allows average/variance)', () => {
        const bag = run((_s, st) => { st.estimator.accumulation = { type: 'exponential', alpha: 0.1 }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-setting' && /accumulation/i.test(e.message))).toBe(true);
        expect(run((_s, st) => { st.estimator.accumulation = { type: 'variance' }; }).isEmpty()).toBe(true);
    });

    it('rejects unsupported tonemap types (allows the built roster)', () => {
        // Registry-driven gate: an out-of-registry type is rejected (cast past the union).
        expect(run((_s, st) => { st.view.tonemap = { type: 'spectral' } as any; }).getErrors()
            .some(e => e.code === 'invalid-setting' && /tonemap|display/i.test(e.message))).toBe(true);
        // Every built occupant is accepted (the roster: none/reinhard + aces/agx/khronos/hable/gt).
        for (const type of ['none', 'reinhard', 'aces', 'agx', 'khronos', 'hable', 'gt'] as const) {
            expect(run((_s, st) => { st.view.tonemap = { type }; }).isEmpty(), `tonemap '${type}' should be accepted`).toBe(true);
        }
    });

    it('rejects an object referencing an unknown material (with a suggestion)', () => {
        const bag = run(s => { (s.objects[0] as { material: string }).material = 'ghost'; });
        const err = bag.getErrors().find(e => e.code === 'missing-material');
        expect(err).toBeDefined();
        expect(err!.suggestions?.length).toBeGreaterThan(0);
    });

    it('accepts rotation and scale transforms (fable-transforms §7)', () => {
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: { axis: [0, 1, 0], angle: 1.2 } }; }).isEmpty()).toBe(true);
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: [0, 0, 0, 1] }; }).isEmpty()).toBe(true);
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { scale: 2 }; }).isEmpty()).toBe(true);
    });

    it('rejects a malformed rotation (3-vector Euler is not in the language)', () => {
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: [0, 1, 0] as any }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /axis-angle|quaternion/i.test(e.message))).toBe(true);
    });

    it('rejects a degenerate quaternion and a zero rotation axis', () => {
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: [0, 0, 0, 0] }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /degenerate/i.test(e.message))).toBe(true);
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: { axis: [0, 0, 0], angle: 1 } }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /axis/i.test(e.message))).toBe(true);
    });

    it('warns on a non-unit quaternion (compiler normalizes)', () => {
        const bag = run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: [0, 0, 0, 2] }; });
        expect(bag.getErrors().length).toBe(0);
        expect(bag.getWarnings().some(w => /normalizing/i.test(w.message))).toBe(true);
    });

    it('rejects reflections (s <= 0) and nonuniform scale (§1 one-way doors)', () => {
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { scale: -1 }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /reflection/i.test(e.message))).toBe(true);
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { scale: 0 }; }).getErrors()
            .some(e => e.code === 'invalid-transform')).toBe(true);
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { scale: [1, 2, 1] as any }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /nonuniform/i.test(e.message))).toBe(true);
    });

    it('warns on extreme scale (fixed world-space epsilons)', () => {
        const bag = run(s => { (s.objects[0] as PrimitiveObject).transform = { scale: 1000 }; });
        expect(bag.getErrors().length).toBe(0);
        expect(bag.getWarnings().some(w => /extreme/i.test(w.message))).toBe(true);
    });

    it('accepts driven transform fields (fable-transforms §6)', () => {
        const bag = run(s => {
            (s.objects[0] as PrimitiveObject).transform = {
                position: { param: 'rig.pos', default: [0, 1, 0] },
                rotation: { axis: [0, 1, 0], angle: { param: 'rig.angle', default: 0, min: 0, max: 6.3 } },
                scale: { param: 'rig.scale', default: 1, min: 0.1, max: 10 },
            };
        });
        expect(bag.getErrors().length).toBe(0);
    });

    it('accepts a driven quaternion (the graph port); rejects a degenerate default', () => {
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: { param: 'rig.q', default: [0, 0, 0, 1] } }; }).getErrors().length).toBe(0);
        expect(run(s => { (s.objects[0] as PrimitiveObject).transform = { rotation: { param: 'rig.q', default: [0, 0, 0, 0] } }; }).getErrors()
            .some(e => /degenerate/i.test(e.message))).toBe(true);
    });

    it('rejects GLSL expressions in transform fields (§6.1: deformation is not a placement)', () => {
        const bag = run(s => { (s.objects[0] as PrimitiveObject).transform = { position: { kind: 'glsl', source: 'vec3(sin(p.x))' } as any }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-transform' && /deformation/i.test(e.message))).toBe(true);
    });

    it('warns when driven scale has no positive min (runtime floor policy)', () => {
        const bag = run(s => { (s.objects[0] as PrimitiveObject).transform = { scale: { param: 'rig.s', default: 1 } }; });
        expect(bag.getErrors().length).toBe(0);
        expect(bag.getWarnings().some(w => /min/i.test(w.message))).toBe(true);
    });

    it('rejects a driven transform on a SAMPLABLE emitter; accepts with sampleAsLight false', () => {
        const lamp = (sampleAsLight: boolean | undefined) => (s: SceneDescription) => {
            s.materials.glow = { model: 'lambert', albedo: [0, 0, 0], emission: [5, 5, 5], ...(sampleAsLight !== undefined ? { sampleAsLight } : {}) };
            s.objects.push({
                type: 'quad', parameters: { corner: [0, 2, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] },
                material: 'glow',
                transform: { position: { param: 'lamp.pos', default: [0, 0, 0] } },
            });
        };
        expect(run(lamp(undefined)).getErrors()
            .some(e => e.code === 'invalid-transform' && /samplable emitter/i.test(e.message))).toBe(true);
        expect(run(lamp(false)).getErrors().length).toBe(0);
    });

    it('accumulates multiple independent errors in one pass', () => {
        const bag = run(s => {
            s.ambientSpace = { type: 'spherical' };
            s.objects.push({ kind: 'mesh', positions: new Float32Array(0), indices: new Uint32Array(0), material: 'm' });
        });
        expect(bag.count('error')).toBeGreaterThanOrEqual(2);
    });
});

// --- Audit-hardening H1: the July 2026 validator pack ---
describe('Validator — variable-IOR (deflecting) media, GRIN v1 scope (fable-variable-ior §7)', () => {
    // A GRIN region: model 'none' container whose medium carries an ior formula over p.
    const grinMedium = (extra: object = {}) => ({
        model: 'none',
        medium: { ior: { kind: 'glsl' as const, source: 'sqrt(max(2.0 - dot(p, p), 0.0))' }, ...extra },
    });

    it('accepts an ior expression WITHOUT a majorant (n is not extinction — nothing clamps it)', () => {
        const bag = run(s => { s.materials.lens = grinMedium(); s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' }); });
        expect(bag.hasErrors()).toBe(false);
    });

    // --- impl-plan-grin-media: the emission/scattering batches flipped the v1 blankets ---

    it('accepts constant sigma_s on a deflecting medium (batch 2: arc-length channel-MIS)', () => {
        const bag = run(s => { s.materials.lens = grinMedium({ sigma_s: [0.5, 0.5, 0.5], phase_g: 0.3 }); s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' }); });
        expect(bag.hasErrors()).toBe(false);
    });

    it('accepts emission on a deflecting medium (batch 1: per-step collection), expression ε sans majorant', () => {
        const bag = run(s => { s.materials.lens = grinMedium({ emission: { kind: 'glsl', source: '0.16 * max(2.0 - dot(p, p), 0.0)' } }); s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' }); });
        expect(bag.hasErrors()).toBe(false);
    });

    it('rejects emission AND sigma_s together on a deflecting medium (emissive bent scattering deferred)', () => {
        const bag = run(s => { s.materials.lens = grinMedium({ emission: [1, 1, 1], sigma_s: [0.5, 0.5, 0.5] }); s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' }); });
        expect(bag.getErrors().some(e => /scatter AND emit/i.test(e.message))).toBe(true);
    });

    it('rejects EXPRESSION sigma_s on a deflecting medium (null-collision on bent arcs deferred)', () => {
        const bag = run(s => { s.materials.lens = grinMedium({ sigma_s: { kind: 'glsl', source: '0.5 + p.y' }, majorant: 4 }); s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' }); });
        expect(bag.getErrors().some(e => /CONSTANT.*coefficients|bent arc/i.test(e.message))).toBe(true);
    });

    it('accepts sigma_a alongside ior (Beer–Lambert along the bent path is v1)', () => {
        const bag = run(s => { s.materials.lens = grinMedium({ sigma_a: [0.0, 0.02, 0.05] }); s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' }); });
        expect(bag.hasErrors()).toBe(false);
    });

    // --- The hard-interface batch (impl-plan-grin-interface) ---

    it('accepts a dielectric wall on a deflecting medium (the hard-interface authoring)', () => {
        const bag = run(s => {
            s.materials.lens = { model: 'dielectric', medium: { ior: { kind: 'glsl', source: 'sqrt(max(2.0 - dot(p, p), 0.0))' } } };
            s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' });
        });
        expect(bag.hasErrors()).toBe(false);
    });

    it('rejects ior authored on BOTH the material and its medium (one interface truth)', () => {
        const bag = run(s => {
            s.materials.lens = { model: 'dielectric', ior: 1.5, medium: { ior: { kind: 'glsl', source: 'sqrt(max(2.0 - dot(p, p), 0.0))' } } };
            s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' });
        });
        expect(bag.getErrors().some(e => /both the material and its medium/i.test(e.message))).toBe(true);
    });

    it('accepts a constant-number medium ior on a dielectric wall (the glass-twin degenerate case)', () => {
        const bag = run(s => {
            s.materials.lens = { model: 'dielectric', medium: { ior: 1.5 } };
            s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'lens' });
        });
        expect(bag.hasErrors()).toBe(false);
    });
});

describe('Validator — hardening pack (H1)', () => {
    it('rejects a samplable emitter whose model cannot emit (the phantom-light rule)', () => {
        const bag = run(s => {
            s.materials.glow = { model: 'dielectric', ior: 1.5, emission: [5, 5, 5] };
            s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'glow' });
        });
        expect(bag.getErrors().some(e => /emission dispatch returns zero/.test(e.message))).toBe(true);
    });

    it('accepts the same emitter with sampleAsLight: false, but warns the emission is dead', () => {
        const bag = run(s => {
            s.materials.glow = { model: 'dielectric', ior: 1.5, emission: [5, 5, 5], sampleAsLight: false };
            s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'glow' });
        });
        expect(bag.hasErrors()).toBe(false);
        expect(bag.getWarnings().some(w => /emission is ignored/.test(w.message))).toBe(true);
    });

    it('accepts a lambert emitter on an analytic shape (the legitimate registry route)', () => {
        const bag = run(s => {
            s.materials.glow = { model: 'lambert', albedo: 0, emission: [5, 5, 5] };
            s.objects.push({ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 1, 0] }, material: 'glow' });
        });
        expect(bag.hasErrors()).toBe(false);
    });

    it("reserves the '__light_' material-name prefix", () => {
        const bag = run(s => { s.materials['__light_0'] = { model: 'lambert' }; });
        expect(bag.getErrors().some(e => /__light_/.test(e.message))).toBe(true);
    });

    it('rejects |phase_g| beyond the NaN margin, as constant and as {param} default', () => {
        expect(run(s => {
            s.materials.fog = { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], phase_g: 1.0 } };
        }).getErrors().some(e => /phase_g/.test(e.message))).toBe(true);
        expect(run(s => {
            s.materials.fog = { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], phase_g: { param: 'fog.g', default: 0.995 } } };
        }).getErrors().some(e => /phase_g/.test(e.message))).toBe(true);
        expect(run(s => {
            s.materials.fog = { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], phase_g: 0.9 } };
        }).hasErrors()).toBe(false);
    });

    it('rejects negative light emission and negative material emission', () => {
        expect(run(s => { s.lights[0] = { kind: 'point', position: [0, 5, 0], emission: -1 }; })
            .getErrors().some(e => /emission must be >= 0/.test(e.message))).toBe(true);
        expect(run(s => { s.materials.m.emission = [-1, 0, 0]; })
            .getErrors().some(e => /emission components must be >= 0/.test(e.message))).toBe(true);
    });

    it('rejects non-finite scene numbers with a path in the message', () => {
        const bag = run(s => {
            s.lights[0] = { kind: 'point', position: [0, Number.NaN, 0], emission: 10 };
        });
        expect(bag.getErrors().some(e => /not finite/.test(e.message) && /lights\[0\]\.position\[1\]/.test(e.message))).toBe(true);
    });

    it('rejects degenerate and near-degenerate analytic quad objects', () => {
        expect(run(s => {
            s.objects.push({ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [2, 0, 0] }, material: 'm' });
        }).getErrors().some(e => /near-parallel/.test(e.message))).toBe(true);
        expect(run(s => {
            s.objects.push({ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [1e-11, 1e-11, 0] }, material: 'm' });
        }).getErrors().some(e => /near-parallel/.test(e.message))).toBe(true);
    });

    it('rejects a near-degenerate quad LIGHT that the exact-zero test used to pass', () => {
        const bag = run(s => {
            s.lights.push({ kind: 'quad', corner: [0, 5, 0], edge1: [1, 0, 0], edge2: [1e-11, 1e-11, 0], emission: 5 });
        });
        expect(bag.getErrors().some(e => /near-parallel/.test(e.message))).toBe(true);
    });

    it('rejects an analytic sphere object with non-positive radius', () => {
        const bag = run(s => {
            s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 0 }, material: 'm' });
        });
        expect(bag.getErrors().some(e => /sphere.*radius/.test(e.message))).toBe(true);
    });
});

describe('Validator — primitive parameter schemas (R3 / review C7)', () => {
    it('errors on a missing required parameter (the { r: 2 } unit-sphere hole)', () => {
        const bag = run(s => {
            s.objects = [{ type: 'sphere', parameters: { r: 2 } as never, material: 'm' }];
        });
        expect(bag.getErrors().some(e => /required parameter 'radius' is missing/.test(e.message))).toBe(true);
    });

    it('warns on an unknown parameter key, naming the valid ones', () => {
        const bag = run(s => {
            s.objects = [{ type: 'sphere', parameters: { radius: 1, radios: 2 } as never, material: 'm' }];
        });
        expect(bag.getWarnings().some(w => /unknown parameter 'radios'.*valid: center, radius/.test(w.message))).toBe(true);
    });

    it('errors on a wrong-shape parameter', () => {
        const bag = run(s => {
            s.objects = [{ type: 'box', parameters: { halfSize: 2 } as never, material: 'm' }];
        });
        expect(bag.getErrors().some(e => /'halfSize' must be a vec3/.test(e.message))).toBe(true);
    });
});

describe('Validator — schema discipline warnings (R2)', () => {
    it("warns when a {param}-driven property has no reader in the material's model", () => {
        const bag = run(s => {
            s.materials['m'] = { model: 'lambert', roughness: { param: 'm.rough', default: 0.5 } };
        });
        expect(bag.getWarnings().some(w => /'roughness' is \{param\}-driven but model 'lambert' does not read it/.test(w.message))).toBe(true);
    });

    it('warns when a non-emissive-capable model carries an emission value', () => {
        const bag = run(s => {
            s.materials['m'] = { model: 'dielectric', ior: 1.5, emission: [1, 1, 1] };
        });
        expect(bag.getWarnings().some(w => /model 'dielectric' cannot emit/.test(w.message))).toBe(true);
    });
});

describe('Validator — correctness domains', () => {
    it('rejects non-positive SDF radii and box half-sizes', () => {
        expect(run(s => {
            s.objects = [{ type: 'sphere', parameters: { radius: 0 }, material: 'm' }];
        }).getErrors().some(e => /parameter 'radius' must be > 0/.test(e.message))).toBe(true);
        expect(run(s => {
            s.objects = [{ type: 'box', parameters: { halfSize: [1, 0, 1] }, material: 'm' }];
        }).getErrors().some(e => /parameter 'halfSize' must be > 0/.test(e.message))).toBe(true);   // D1: one constraint voice (per-component check unchanged)
    });

    it('rejects zero plane normals but accepts non-unit normals for canonical normalization', () => {
        expect(run(s => {
            s.objects = [{ type: 'plane', parameters: { normal: [0, 0, 0], offset: 1 }, material: 'm' }];
        }).getErrors().some(e => /parameter 'normal' length/.test(e.message))).toBe(true);
        expect(run(s => {
            s.objects = [{ type: 'plane', parameters: { normal: [0, 2, 0], offset: 2 }, material: 'm' }];
        }).hasErrors()).toBe(false);
    });

    it('rejects negative extinction and non-positive dielectric IOR', () => {
        expect(run(s => {
            s.materials.fog = { model: 'none', medium: { sigma_a: [-0.1, 0, 0] } };
        }).getErrors().some(e => /medium\.sigma_a components must be >= 0/.test(e.message))).toBe(true);
        expect(run(s => {
            s.materials.m = { model: 'dielectric', ior: 0 };
        }).getErrors().some(e => /ior must be > 0/.test(e.message))).toBe(true);
        expect(run(s => {
            s.materials.m = { model: 'dielectric', ior: { param: 'glass.ior', default: 1.5, min: 0, max: 3 } };
        }).getErrors().some(e => /ior parameter min must be > 0/.test(e.message))).toBe(true);
    });

    it('rejects scalar/vector property mismatches, including ValueParam defaults', () => {
        expect(run(s => {
            s.materials.m = { model: 'ggx', roughness: [0.2, 0.3, 0.4] as never };
        }).getErrors().some(e => /roughness must be a finite number/.test(e.message))).toBe(true);
        expect(run(s => {
            s.materials.m = { model: 'lambert', albedo: { param: 'm.albedo', default: 0.5 } };
        }).hasErrors()).toBe(false); // scalar-to-spectrum broadcast remains intentional
        expect(run(s => {
            s.materials.m = { model: 'lambert', albedo: { param: 'm.albedo', default: [0.5, 0.5] as never } };
        }).getErrors().some(e => /albedo must be a finite number or vec3/.test(e.message))).toBe(true);
    });

    it('rejects malformed transform.position values from untyped scene input', () => {
        const bag = run(s => { (s.objects[0] as PrimitiveObject).transform = { position: [1, 2] as never }; });
        expect(bag.getErrors().some(e => /transform\.position must be a vec3/.test(e.message))).toBe(true);
    });
});

// Audit batch 1 (validation): the shared per-object geometry validation (A3), the
// bounds-required instance-prototype rule (A1), the unified transmissive-on-thin
// warning (A2), and the meshTraversal/instanceAccel axis rules (A4).
describe('Validator — mesh/instancing validation batch', () => {
    const placements = [{ position: [0, 1, 0] as [number, number, number] }];

    it('A1: rejects an unbounded instance prototype (plane has no bounds); accepts a bounded one', () => {
        const bad = run(s => {
            s.objects.push({ kind: 'instanced', prototype: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'm' }, placements });
        });
        expect(bad.getErrors().some(e => /declares no local bounds/.test(e.message))).toBe(true);
        const ok = run(s => {
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'm' }, placements });
        });
        expect(ok.hasErrors()).toBe(false);
    });

    it('A3: an instanced ANALYTIC prototype gets full schema validation (missing required param)', () => {
        const bag = run(s => {
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: {}, material: 'm' }, placements });
        });
        expect(bag.getErrors().some(e => /Object 1 prototype \(sphere\): required parameter 'radius' is missing/.test(e.message))).toBe(true);
    });

    it('A3: an instanced MESH prototype gets full buffer sanity (out-of-range index)', () => {
        const bag = run(s => {
            s.objects.push({
                kind: 'instanced',
                prototype: { kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 9]), material: 'm' },
                placements,
            });
        });
        expect(bag.getErrors().some(e => /Object 1 prototype \(mesh\): vertex index 9 out of range/.test(e.message))).toBe(true);
    });

    it('A2: warns on a transmissive material across the WHOLE thin set (quad, mesh, instanced), not on solids', () => {
        const glassOnThin = (mutate: (s: SceneDescription) => void) => run(s => {
            s.materials.glass = { model: 'dielectric', ior: 1.5 };
            mutate(s);
        }).getWarnings().some(w => /refract as η = 1/.test(w.message));
        // Zero-thickness primitive.
        expect(glassOnThin(s => { s.objects.push({ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'glass' }); })).toBe(true);
        // v0 mesh.
        expect(glassOnThin(s => { s.objects.push({ kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 'glass' }); })).toBe(true);
        // A solid (sphere object) must NOT warn — it has a real interior region.
        expect(glassOnThin(s => { s.objects.push({ type: 'sphere', parameters: { radius: 0.5 }, material: 'glass' }); })).toBe(false);
        // ...and NEITHER does a solid-prototype BATCH any more (impl-plan-instanced-
        // containment): a glass sphere batch claims an interior, so it left the thin set
        // by the same fact-flip closed meshes used. The rule still fires for a batch that
        // WANTS an interior but cannot answer containment — the two cases below.
        expect(glassOnThin(s => { s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'glass' }, placements }); })).toBe(false);
        // Thin PRIMITIVE prototype: zero thickness never claims containment.
        expect(glassOnThin(s => { s.objects.push({ kind: 'instanced', prototype: { type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'glass' }, placements }); })).toBe(true);
        // OPEN mesh prototype: no proven watertightness ⇒ no interior.
        expect(glassOnThin(s => {
            s.objects.push({
                kind: 'instanced',
                prototype: { kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 'glass' },
                placements,
            });
        })).toBe(true);
    });

    it('A4: rejects unknown meshTraversal/instanceAccel values (JSON-sourced strategies)', () => {
        const mesh = { kind: 'mesh' as const, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 'm' };
        const bad1 = run((s, st) => { s.objects.push(mesh); st.estimator.meshTraversal = 'bvhx' as never; });
        expect(bad1.getErrors().some(e => /meshTraversal 'bvhx' is not a mesh traversal engine/.test(e.message))).toBe(true);
        const bad2 = run((s, st) => {
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'm' }, placements });
            st.estimator.instanceAccel = 'fast' as never;
        });
        expect(bad2.getErrors().some(e => /instanceAccel 'fast' is not an instance traversal/.test(e.message))).toBe(true);
    });

    it('A4: valid values pass with the geometry present; inert knobs warn without it (C5)', () => {
        const mesh = { kind: 'mesh' as const, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 'm' };
        const ok = run((s, st) => { s.objects.push(mesh); st.estimator.meshTraversal = 'brute'; });
        expect(ok.isEmpty()).toBe(true);
        const inert1 = run((_s, st) => { st.estimator.meshTraversal = 'brute'; });
        expect(inert1.getWarnings().some(w => /meshTraversal controls nothing here/.test(w.message))).toBe(true);
        const inert2 = run((_s, st) => { st.estimator.instanceAccel = 'linear'; });
        expect(inert2.getWarnings().some(w => /instanceAccel controls nothing here/.test(w.message))).toBe(true);
    });

    it("rejects cwbvh × lightSelection 'bvh' on a light-eligible batch (Hit.element light identity rides binary-TLAS order)", () => {
        const glowBatch = (s: SceneDescription) => {
            s.materials.glow = { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [5, 5, 5] };
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'glow' }, placements });
        };
        const bad = run((s, st) => { glowBatch(s); st.estimator.instanceAccel = 'cwbvh'; st.estimator.lightSelection = 'bvh'; });
        expect(bad.getErrors().some(e => /'cwbvh' with lightSelection 'bvh'/.test(e.message))).toBe(true);
        // The same batch under 'tlas', or a non-emissive batch under cwbvh, is fine.
        const okTlas = run((s, st) => { glowBatch(s); st.estimator.instanceAccel = 'tlas'; st.estimator.lightSelection = 'bvh'; });
        expect(okTlas.hasErrors()).toBe(false);
        const okDark = run((s, st) => {
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'm' }, placements });
            st.estimator.instanceAccel = 'cwbvh'; st.estimator.lightSelection = 'bvh';
        });
        expect(okDark.getErrors().some(e => /'cwbvh' with lightSelection 'bvh'/.test(e.message))).toBe(false);
    });

    it("the 'bvh' inert warning counts batch instance lights (a batch-lights-only scene is NOT inert)", () => {
        // lights: [] + one emissive cloud — the clebsch-glow shape. The roster is empty
        // but the tree serves every instance; the knob is anything but inert.
        const bag = run((s, st) => {
            s.lights = [];
            s.materials.glow = { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [5, 5, 5] };
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'glow' }, placements });
            st.estimator.lightSelection = 'bvh';
        });
        expect(bag.getWarnings().some(w => /lightSelection 'bvh' controls nothing here/.test(w.message))).toBe(false);
        expect(bag.hasErrors()).toBe(false);   // L6: batch lights count as NEE targets under the tree
    });
});

// Per-instance attributes (fable-instance-attributes): the fourth storage class's rules.
describe('Validator — instance attributes', () => {
    const placements = [{ position: [0, 1, 0] as [number, number, number] }, { position: [2, 1, 0] as [number, number, number] }];
    const batch = (attributes: Record<string, unknown>, material = 'balls') => (s: SceneDescription) => {
        s.materials.balls = { model: 'lambert', albedo: [0.5, 0.5, 0.5] };
        s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material }, placements, attributes } as never);
    };

    it('accepts a well-formed per-instance albedo (scalar broadcast included)', () => {
        const bag = run(batch({ albedo: [[0.8, 0.2, 0.2], 0.5] }));
        expect(bag.hasErrors()).toBe(false);
    });

    it('rejects unknown rows and region-indexed rows', () => {
        expect(run(batch({ shininess: [1, 2] })).getErrors().some(e => /attributes\.shininess.*not a row of model 'lambert'/.test(e.message))).toBe(true);
        const iorBag = run(s => {
            s.materials.glassy = { model: 'dielectric', ior: 1.5 };
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'glassy' }, placements, attributes: { ior: [1.4, 1.6] } } as never);
        });
        expect(iorBag.getErrors().some(e => /attributes\.ior.*region-indexed/.test(e.message))).toBe(true);
    });

    it('per-instance emission: allowed on params-tier sphere batches, rejected elsewhere (fable-light-bvh §7.1)', () => {
        expect(run(batch({ emission: [[1, 1, 1], [2, 2, 2]] })).hasErrors()).toBe(false);
        // A frame-tier pin makes the same batch ineligible — the tree cannot sample it.
        const framed = run(s => {
            s.materials.balls = { model: 'lambert', albedo: [0.5, 0.5, 0.5] };
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'balls' }, placements, placementRecord: 'frame', attributes: { emission: [[1, 1, 1], [2, 2, 2]] } } as never);
        });
        expect(framed.getErrors().some(e => /per-instance emission is supported only on params-tier SPHERE batches/.test(e.message))).toBe(true);
    });

    it('rejects rows feeding a derived field (ggx roughness → alpha)', () => {
        const bag = run(s => {
            s.materials.metal = { model: 'ggx', roughness: 0.3, f0: [0.9, 0.9, 0.9] };
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'metal' }, placements, attributes: { roughness: [0.1, 0.5] } } as never);
        });
        expect(bag.getErrors().some(e => /feeds the derived field/.test(e.message))).toBe(true);
    });

    it('rejects length mismatch and non-finite entries', () => {
        expect(run(batch({ albedo: [[0.8, 0.2, 0.2]] })).getErrors().some(e => /2 placements.*must be parallel|1 entries for 2 placements/.test(e.message))).toBe(true);
        expect(run(batch({ albedo: [[0.8, 0.2, NaN], 0.5] })).getErrors().some(e => /albedo\[0\] must be a finite/.test(e.message))).toBe(true);
    });

    it('rejects sharing an attribute-carrying batch material with another object', () => {
        const bag = run(s => {
            batch({ albedo: [[0.8, 0.2, 0.2], 0.5] })(s);
            s.objects.push({ type: 'sphere', parameters: { radius: 1 }, material: 'balls' });
        });
        expect(bag.getErrors().some(e => /must be exclusive/.test(e.message))).toBe(true);
    });
});

// Closed-mesh proof (fable-mesh-containment): closed = intent, the Validator makes it fact.
describe('Validator — mesh closedness', () => {
    // The witness cube helper's shape, inlined: an outward unit cube as 12 triangles with
    // SPLIT corners (4 verts/face) — the position-welding case.
    const cube = (inward: boolean) => {
        const pos: number[] = []; const idx: number[] = [];
        const h = 0.5;
        const faces: Array<[number[], number[], number[]]> = [
            [[h, -h, -h], [0, 2 * h, 0], [0, 0, 2 * h]], [[-h, -h, h], [0, 2 * h, 0], [0, 0, -2 * h]],
            [[-h, h, -h], [0, 0, 2 * h], [2 * h, 0, 0]], [[-h, -h, -h], [2 * h, 0, 0], [0, 0, 2 * h]],
            [[-h, -h, h], [2 * h, 0, 0], [0, 2 * h, 0]], [[h, -h, -h], [-2 * h, 0, 0], [0, 2 * h, 0]],
        ];
        for (const [c, e1r, e2r] of faces) {
            const [e1, e2] = inward ? [e2r, e1r] : [e1r, e2r];
            const base = pos.length / 3;
            pos.push(...c, c[0] + e1[0], c[1] + e1[1], c[2] + e1[2],
                c[0] + e1[0] + e2[0], c[1] + e1[1] + e2[1], c[2] + e1[2] + e2[2],
                c[0] + e2[0], c[1] + e2[1], c[2] + e2[2]);
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
    };

    it('accepts a watertight outward closed mesh (welded across split corners)', () => {
        const g = cube(false);
        const bag = run(s => { s.objects.push({ kind: 'mesh', ...g, material: 'm', closed: true }); });
        expect(bag.hasErrors()).toBe(false);
    });

    it('rejects closed: true on a holed mesh, an inward mesh, and a flipped-patch mesh', () => {
        const g = cube(false);
        const holed = run(s => { s.objects.push({ kind: 'mesh', positions: g.positions, indices: g.indices.slice(0, 33), material: 'm', closed: true }); });
        expect(holed.getErrors().some(e => /not watertight.*boundary edge/.test(e.message))).toBe(true);
        const inward = cube(true);
        expect(run(s => { s.objects.push({ kind: 'mesh', ...inward, material: 'm', closed: true }); })
            .getErrors().some(e => /winding is INWARD/.test(e.message))).toBe(true);
        const flipped = new Uint32Array(g.indices);
        [flipped[0], flipped[1]] = [flipped[1], flipped[0]];
        expect(run(s => { s.objects.push({ kind: 'mesh', positions: g.positions, indices: flipped, material: 'm', closed: true }); })
            .getErrors().some(e => /same-direction winding/.test(e.message))).toBe(true);
    });

    it('ACCEPTS a closed mesh prototype on an instanced batch (containment landed)', () => {
        // The inversion of the v1 pin (impl-plan-instanced-containment): solid instances
        // now answer scene_region_at through the same three-tier query their un-instanced
        // siblings use, so `closed: true` is honoured on prototypes too.
        const g = cube(false);
        const bag = run(s => {
            s.objects.push({ kind: 'instanced', prototype: { kind: 'mesh', ...g, material: 'm', closed: true }, placements: [{ position: [0, 1, 0] }] });
        });
        expect(bag.getErrors().some(e => /mesh prototype/.test(e.message))).toBe(false);
    });

    it('transmissive warning: fires on an OPEN mesh, silent on a CLOSED one (the fact flipped)', () => {
        const g = cube(false);
        const warn = (closed: boolean) => run(s => {
            s.materials.glass = { model: 'dielectric', ior: 1.5 };
            s.objects.push({ kind: 'mesh', ...g, material: 'glass', ...(closed ? { closed: true } : {}) });
        }).getWarnings().some(w => /refract as η = 1/.test(w.message));
        expect(warn(false)).toBe(true);
        expect(warn(true)).toBe(false);
    });
});

describe('Validator — lightSelection axis (fable-light-bvh §2/§6)', () => {
    it('rejects an unregistered selection id (registry-derived membership)', () => {
        const bag = run((_, st) => { st.estimator.lightSelection = 'lightcuts'; });
        expect(bag.getErrors().some((e) => e.message.includes("'lightcuts'") && e.message.includes('power, uniform, bvh'))).toBe(true);
    });

    it('accepts bvh on a tree-eligible scene (point light)', () => {
        const bag = run((_, st) => { st.estimator.lightSelection = 'bvh'; });
        expect(bag.getErrors()).toEqual([]);
    });

    it("accepts bvh with a MESH emitter in the roster (treeBounds 'data' — the mesh-treeBounds batch)", () => {
        const bag = run((s, st) => {
            s.materials.lampMesh = { model: 'lambert', albedo: [0, 0, 0], emission: [5, 5, 5] };
            s.objects.push({ kind: 'mesh', positions: new Float32Array([0, 2, 0, 1, 2, 0, 0, 2, 1]), indices: new Uint32Array([0, 1, 2]), material: 'lampMesh' });
            st.estimator.lightSelection = 'bvh';
        });
        expect(bag.getErrors().some((e) => e.message.includes('treeBounds'))).toBe(false);
    });

    it('rejects bvh when a roster kind declares no treeBounds (directional)', () => {
        const bag = run((s, st) => {
            st.estimator.lightSelection = 'bvh';
            s.lights = [{ kind: 'directional', direction: [0, -1, 0], emission: 2 } as never];
        });
        expect(bag.getErrors().some((e) => e.message.includes("'directional'") && e.message.includes('treeBounds'))).toBe(true);
    });

    it('rejects bvh with driven emission (v1: constant Φ payload)', () => {
        const bag = run((s, st) => {
            st.estimator.lightSelection = 'bvh';
            s.lights = [{ kind: 'point', position: [0, 5, 0], emission: { param: 'lamp.e', default: 5 } } as never];
        });
        expect(bag.getErrors().some((e) => e.message.includes('CONSTANT light emission'))).toBe(true);
    });

    it('rejects bvh × equiangular (the medium-vertex tree entry is the mis/tally batch)', () => {
        const bag = run((s, st) => {
            st.estimator.lightSelection = 'bvh';
            st.estimator.mediumLightSampling = 'equiangular';
            s.materials.fog = { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], sigma_s: [0.4, 0.4, 0.4] } };
            s.objects.push({ type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.8 }, material: 'fog' });
        });
        expect(bag.getErrors().some((e) => e.message.includes("'equiangular'") && e.message.includes('bvh'))).toBe(true);
    });

    it('warns (inert) for bvh with no finite lights', () => {
        const bag = run((s, st) => {
            st.estimator.lightSelection = 'bvh';
            s.lights = [];
            s.materials.m = { model: 'lambert', albedo: [0.5, 0.5, 0.5] };
            s.environment = { type: 'constant', color: [1, 1, 1], sampleAsLight: true };
        });
        expect(bag.getErrors()).toEqual([]);
        expect(bag.getWarnings().some((w) => w.message.includes('bvh') && w.message.includes('inert'))).toBe(true);
    });
});

// The Sep 25 2026 audit's validation gaps: each input below used to pass validation and then
// crash the generator, emit unparseable GLSL, or silently render something else.
describe('Validator — Sep 25 audit gaps', () => {
    const errs = (bag: DiagnosticBag) => bag.getErrors().map((e) => e.message).join('\n');

    it('measurement enums', () => {
        expect(errs(run((_s, st) => { (st.measurement as any).scattering = 'none'; }))).toMatch(/measurement\.scattering must be one of/);
        expect(errs(run((_s, st) => { (st.measurement as any).shadows = 'transparent'; }))).toMatch(/measurement\.shadows/);
        expect(run((_s, st) => { st.measurement.scattering = 'ignored'; }).hasErrors()).toBe(false);
    });

    it('russianRoulette.startDepth is a non-negative integer', () => {
        for (const bad of [2.5, -1, Number.NaN]) {
            expect(errs(run((_s, st) => { st.estimator.russianRoulette = { startDepth: bad } as any; }))).toMatch(/startDepth/);
        }
        expect(run((_s, st) => { st.estimator.russianRoulette = { startDepth: 3 } as any; }).hasErrors()).toBe(false);
    });

    it('tonemap exposure is finite and positive', () => {
        for (const bad of [Number.NaN, -1, 0, '2']) {
            expect(errs(run((_s, st) => { (st.view.tonemap as any).exposure = bad; }))).toMatch(/exposure/);
        }
    });

    it('pinhole fov is radians in (0, π)', () => {
        expect(errs(run((_s, st) => { (st.measurement.camera as any).fov = 45; }))).toMatch(/fov/);
        expect(run((_s, st) => { (st.measurement.camera as any).fov = 1.2; }).hasErrors()).toBe(false);
    });

    it('fisheye fov respects each projection', () => {
        const fisheye = (projection: string, fov: number) => run((_s, st) => { st.measurement.camera = { type: 'fisheye', projection, fov } as any; });
        expect(fisheye('orthographic', 4).hasErrors()).toBe(true);
        expect(fisheye('orthographic', 3).hasErrors()).toBe(false);
        expect(fisheye('stereographic', 2 * Math.PI).hasErrors()).toBe(true);
        expect(fisheye('equidistant', 2 * Math.PI).hasErrors()).toBe(false);
    });

    it('procedural environment: no params, integer table size', () => {
        const sky = (extra: object) => run((s) => { s.environment = { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(0.5)', ...extra } as any, ...extra } as any; });
        expect(errs(run((s) => { s.environment = { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(u_gain)', params: { gain: { param: 'sky.gain', default: 1 } } } as any }; }))).toMatch(/cannot declare params/);
        expect(errs(run((s) => { s.environment = { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(0.5)' }, tableSize: [512.5, 256] } as any; }))).toMatch(/tableSize/);
        expect(sky({}).hasErrors()).toBe(false);
    });

    it('parameter paths must become valid GLSL identifiers', () => {
        expect(errs(run((s) => { s.materials.m = { model: 'lambert', albedo: { param: 'key-light.tint', default: [1, 1, 1] } } as any; }))).toMatch(/not a valid name/);
        expect(errs(run((s) => { s.materials.m = { model: 'lambert', albedo: { param: 'a._b', default: [1, 1, 1] } } as any; }))).toMatch(/not a valid name/);
    });

    it('a material {param} needs a default', () => {
        expect(errs(run((s) => { s.materials.m = { model: 'lambert', albedo: { param: 'wall.albedo' } } as any; }))).toMatch(/needs a default/);
    });

    it('Transform[] instance placements are similarities', () => {
        const batch = (placements: unknown[]) => run((s) => {
            s.objects.push({ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 0.1 }, material: 'm' }, placements } as any);
        });
        expect(errs(batch([{ position: [0, 0, 0] }, { position: [1, 0, 0], scale: -1 }]))).toMatch(/placement 1: scale/);
        expect(errs(batch([{ scale: [1, 2, 3] }]))).toMatch(/placement 0: scale must be one number/);
        expect(errs(batch([{ rotation: { axis: [0, 0, 0], angle: 1 } }]))).toMatch(/rotation axis/);
        expect(errs(batch([{ position: [Number.NaN, 0, 0] }]))).toMatch(/position/);
        expect(batch([{ position: [0, 0, 0], scale: 2, rotation: { axis: [0, 1, 0], angle: 1 } }]).hasErrors()).toBe(false);
    });

    it('mesh vertices must be finite', () => {
        const bag = run((s) => {
            s.objects.push({ kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, Number.NaN, 0]), indices: new Uint32Array([0, 1, 2]), material: 'm' } as any);
        });
        expect(errs(bag)).toMatch(/vertex 2 has a non-finite coordinate/);
    });

    it('sampleAsLight on a DRIVEN quad is an error, not a silently ignored flag', () => {
        const bag = run((s) => {
            s.materials.lamp = { model: 'lambert', emission: [5, 5, 5], sampleAsLight: true } as any;
            s.objects.push({ type: 'quad', parameters: { corner: [0, 2, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'lamp',
                transform: { position: { param: 'lamp.pos', default: [0, 0, 0] } } } as any);
        });
        expect(errs(bag)).toMatch(/sampleAsLight requires a samplable object/);
    });
});
