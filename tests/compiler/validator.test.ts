import { describe, it, expect } from 'vitest';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

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

    it('rejects mesh geometry', () => {
        const bag = run(s => { s.objects.push({ kind: 'mesh', data: new Float32Array(0), material: 'm' }); });
        expect(bag.getErrors().some(e => e.code === 'missing-geometry' && /mesh/i.test(e.message))).toBe(true);
    });

    it('accepts analytic geometry (closed-form sphere/plane backend)', () => {
        const bag = run(s => { s.objects.push({ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'm' }); });
        expect(bag.hasErrors()).toBe(false);
    });

    it('rejects directional lights', () => {
        const bag = run(s => { s.lights.push({ kind: 'directional', direction: [0, -1, 0], emission: 1 }); });
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

    it('warns (does not error) on an empty scene', () => {
        const bag = run(s => { s.objects = []; });
        expect(bag.hasErrors()).toBe(false);
        expect(bag.getWarnings().some(w => w.code === 'empty-scene')).toBe(true);
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
        const bag = run(s => { s.objects[0].material = 'ghost'; });
        const err = bag.getErrors().find(e => e.code === 'missing-material');
        expect(err).toBeDefined();
        expect(err!.suggestions?.length).toBeGreaterThan(0);
    });

    it('accepts rotation and scale transforms (fable-transforms §7)', () => {
        expect(run(s => { s.objects[0].transform = { rotation: { axis: [0, 1, 0], angle: 1.2 } }; }).isEmpty()).toBe(true);
        expect(run(s => { s.objects[0].transform = { rotation: [0, 0, 0, 1] }; }).isEmpty()).toBe(true);
        expect(run(s => { s.objects[0].transform = { scale: 2 }; }).isEmpty()).toBe(true);
    });

    it('rejects a malformed rotation (3-vector Euler is not in the language)', () => {
        expect(run(s => { s.objects[0].transform = { rotation: [0, 1, 0] as any }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /axis-angle|quaternion/i.test(e.message))).toBe(true);
    });

    it('rejects a degenerate quaternion and a zero rotation axis', () => {
        expect(run(s => { s.objects[0].transform = { rotation: [0, 0, 0, 0] }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /degenerate/i.test(e.message))).toBe(true);
        expect(run(s => { s.objects[0].transform = { rotation: { axis: [0, 0, 0], angle: 1 } }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /axis/i.test(e.message))).toBe(true);
    });

    it('warns on a non-unit quaternion (compiler normalizes)', () => {
        const bag = run(s => { s.objects[0].transform = { rotation: [0, 0, 0, 2] }; });
        expect(bag.getErrors().length).toBe(0);
        expect(bag.getWarnings().some(w => /normalizing/i.test(w.message))).toBe(true);
    });

    it('rejects reflections (s <= 0) and nonuniform scale (§1 one-way doors)', () => {
        expect(run(s => { s.objects[0].transform = { scale: -1 }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /reflection/i.test(e.message))).toBe(true);
        expect(run(s => { s.objects[0].transform = { scale: 0 }; }).getErrors()
            .some(e => e.code === 'invalid-transform')).toBe(true);
        expect(run(s => { s.objects[0].transform = { scale: [1, 2, 1] as any }; }).getErrors()
            .some(e => e.code === 'invalid-transform' && /nonuniform/i.test(e.message))).toBe(true);
    });

    it('warns on extreme scale (fixed world-space epsilons)', () => {
        const bag = run(s => { s.objects[0].transform = { scale: 1000 }; });
        expect(bag.getErrors().length).toBe(0);
        expect(bag.getWarnings().some(w => /extreme/i.test(w.message))).toBe(true);
    });

    it('accepts driven transform fields (fable-transforms §6)', () => {
        const bag = run(s => {
            s.objects[0].transform = {
                position: { param: 'rig.pos', default: [0, 1, 0] },
                rotation: { axis: [0, 1, 0], angle: { param: 'rig.angle', default: 0, min: 0, max: 6.3 } },
                scale: { param: 'rig.scale', default: 1, min: 0.1, max: 10 },
            };
        });
        expect(bag.getErrors().length).toBe(0);
    });

    it('accepts a driven quaternion (the graph port); rejects a degenerate default', () => {
        expect(run(s => { s.objects[0].transform = { rotation: { param: 'rig.q', default: [0, 0, 0, 1] } }; }).getErrors().length).toBe(0);
        expect(run(s => { s.objects[0].transform = { rotation: { param: 'rig.q', default: [0, 0, 0, 0] } }; }).getErrors()
            .some(e => /degenerate/i.test(e.message))).toBe(true);
    });

    it('rejects GLSL expressions in transform fields (§6.1: deformation is not a placement)', () => {
        const bag = run(s => { s.objects[0].transform = { position: { kind: 'glsl', source: 'vec3(sin(p.x))' } as any }; });
        expect(bag.getErrors().some(e => e.code === 'invalid-transform' && /deformation/i.test(e.message))).toBe(true);
    });

    it('warns when driven scale has no positive min (runtime floor policy)', () => {
        const bag = run(s => { s.objects[0].transform = { scale: { param: 'rig.s', default: 1 } }; });
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
            s.objects.push({ kind: 'mesh', data: new Float32Array(0), material: 'm' });
        });
        expect(bag.count('error')).toBeGreaterThanOrEqual(2);
    });
});

// --- Audit-hardening H1: the July 2026 validator pack ---
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
        }).getErrors().some(e => /parameter 'halfSize' components must be > 0/.test(e.message))).toBe(true);
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
        const bag = run(s => { s.objects[0].transform = { position: [1, 2] as never }; });
        expect(bag.getErrors().some(e => /transform\.position must be a vec3/.test(e.message))).toBe(true);
    });
});
