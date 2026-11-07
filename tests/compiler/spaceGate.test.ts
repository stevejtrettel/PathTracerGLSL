// The space gate and the curved-space limitations, exercised with a test-only ambient space.
// This file registers a test-only space, 'testspace', in memory (the
// Euclidean GLSL under a new key; nothing here renders), gives a few occupants a body for it,
// and checks that every occupant without one, and every limitation row, is reported with its
// message, while the same scenes in Euclidean space report nothing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { AMBIENT_SPACES } from '../../src/components/ambient/index.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { PRIMITIVES } from '../../src/components/geometry/index.js';
import { CAMERA_MODELS } from '../../src/components/camera/index.js';
import { OBJECT_DISPATCHES } from '../../src/components/intersection/index.js';
import { LIGHT_KINDS, LIGHT_SELECTIONS } from '../../src/components/lights/index.js';
import type { SpaceBodies, SpaceList } from '../../src/components/descriptors.js';
import type { SceneDescription, RenderStrategy, ObjectDescription, PrimitiveObject } from '../../src/compiler/types.js';

const SPACE = 'testspace';
// The test space's lambert body: the Euclidean file with a marker line, so the compiled
// program shows which body the generator chose.
const LAMBERT_MARKER = '// testspace lambert body';

type Writable<T> = { -readonly [K in keyof T]: T[K] };
const restore: Array<() => void> = [];
function addBody(glsl: SpaceBodies, marker = ''): void {
    const bodies = glsl as Writable<SpaceBodies>;
    bodies[SPACE] = { origin: glsl.euclidean!.origin, source: marker + glsl.euclidean!.source };
    restore.push(() => { delete bodies[SPACE]; });
}

beforeAll(() => {
    AMBIENT_SPACES[SPACE] = { ...AMBIENT_SPACES.euclidean, type: SPACE };
    restore.push(() => { delete AMBIENT_SPACES[SPACE]; });
    addBody(MATERIAL_MODELS.lambert!.glsl, LAMBERT_MARKER + '\n');
    addBody(PRIMITIVES.sphere.glsl);
    addBody(CAMERA_MODELS.pinhole.glsl);
    const unrolled = OBJECT_DISPATCHES.unrolled as { spaces: SpaceList };
    const before = unrolled.spaces;
    unrolled.spaces = [...before, SPACE];
    restore.push(() => { unrolled.spaces = before; });
});
afterAll(() => { for (const undo of restore.reverse()) undo(); });

function strategy(overrides: Partial<RenderStrategy['estimator']> = {}, measurement: Partial<RenderStrategy['measurement']> = {}): RenderStrategy {
    return {
        id: 'gate',
        measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 2, ...measurement },
        estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' }, ...overrides },
        view: { tonemap: { type: 'reinhard' } },
    } as RenderStrategy;
}

const sphere = (x: number, material = 'matte'): PrimitiveObject =>
    ({ type: 'sphere', parameters: { center: [x, 0, 0], radius: 0.5 }, material });

function scene(space: string, edit: (s: SceneDescription) => void = () => {}): SceneDescription {
    const s: SceneDescription = {
        id: 'space-gate', ambientSpace: { type: space as never },
        objects: [sphere(0)],
        materials: { matte: { model: 'lambert', albedo: 0.5 } },
        lights: [],
    };
    edit(s);
    return s;
}

function errors(s: SceneDescription, st: RenderStrategy): string[] {
    const bag = new DiagnosticBag('test');
    validate(analyze(s), s, st, bag);
    return bag.getErrors().map((d) => d.message).sort();
}

/** The errors that name a space: the gate's and the limitations'. */
const spaceErrors = (s: SceneDescription, st: RenderStrategy) =>
    errors(s, st).filter((m) => m.includes(' implementation (implemented in: ') || m.includes(' space (implemented in: '));

describe('the space gate (descriptor occupants)', () => {
    it('passes a program whose every occupant has a body for the space, and compiles it with those bodies', () => {
        const s = scene(SPACE);
        expect(errors(s, strategy())).toEqual([]);
        const compiled = new Compiler().compileScene(s, [strategy()]);
        const fragment = [...compiled.renderers[0].shaders.values()].map((sh) => sh.fragment).join('\n');
        expect(fragment).toContain(LAMBERT_MARKER);
    });

    it('names each occupant without a body, with the spaces it has', () => {
        const s = scene(SPACE, (x) => {
            x.objects.push({ type: 'torus', parameters: { ringRadius: 1, tubeRadius: 0.2 }, material: 'metal' } as ObjectDescription);
            x.materials.metal = { model: 'ggx', f0: [0.9, 0.9, 0.9], roughness: 0.3 };
            x.materials.fog = { model: 'none', medium: { sigma_a: 0.1, sigma_s: 0.5 } };
            x.objects.push(sphere(3, 'fog'));
            x.lights.push({ kind: 'disk', position: [0, 3, 0], normal: [0, -1, 0], radius: 0.5, emission: 5 } as never);
        });
        const st = strategy({}, { camera: { type: 'thinlens', fov: 0.8, aperture: 0.1, focusDistance: 4 } as never, aovs: ['normal'] });
        expect(spaceErrors(s, st)).toEqual([
            "Light 0: its backing primitive 'disk' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical, h2xr)",
            "Light 0: light kind 'disk' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical, h2xr)",
            "Material 'fog': phase model 'hg' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical)",
            "Material 'metal': material model 'ggx' has no testspace implementation (implemented in: euclidean)",
            "Object 1: primitive 'torus' has no testspace implementation (implemented in: euclidean)",
            "Object 1: the primitive bounding its march, 'cylinder' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical, h2xr)",
            'marched objects: not implemented in testspace space (implemented in: euclidean, hyperbolic, spherical)',
            "measurement.aovs: AOV 'normal' has no testspace implementation (implemented in: euclidean)",
            "measurement.camera: camera 'thinlens' has no testspace implementation (implemented in: euclidean)",
        ].sort());
    });

    it('gates an emissive object\'s light kind and a sampled sky\'s chart', () => {
        const s = scene(SPACE, (x) => {
            x.materials.lamp = { model: 'lambert', albedo: 0, emission: 4 };
            x.objects.push(sphere(2, 'lamp'));
            x.environment = { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(0.1)' } };
        });
        const reasons = spaceErrors(s, strategy({ directLighting: 'nee' }));
        expect(reasons).toContain("Object 1: light kind 'sphere' has no testspace implementation (implemented in: euclidean)");
        expect(reasons).toContain("estimator.envSampler: environment chart 'equirect' has no testspace implementation (implemented in: euclidean)");
    });
});

describe('a marched shape\'s bound chain', () => {
    it('gates every primitive in the chain the generator links, not only the first bound', () => {
        // No registered bound has a bound of its own, so lengthen the chain for this test: the
        // torus marches inside a cylinder, made to march inside a box.
        const torus = PRIMITIVES.torus.glsl as Writable<SpaceBodies>;
        const cylinder = PRIMITIVES.cylinder as { marchBound: typeof PRIMITIVES.cylinder.marchBound };
        const bound = cylinder.marchBound;
        torus[SPACE] = torus.euclidean;
        (PRIMITIVES.cylinder.glsl as Writable<SpaceBodies>)[SPACE] = PRIMITIVES.cylinder.glsl.euclidean;
        cylinder.marchBound = { type: 'box', values: () => ({ center: [0, 0, 0], halfExtents: [1, 1, 1] }) };
        try {
            const s = scene(SPACE, (x) => {
                x.objects = [{ type: 'torus', parameters: { ringRadius: 1, tubeRadius: 0.2 }, material: 'matte' } as ObjectDescription];
            });
            expect(spaceErrors(s, strategy())).toEqual([
                "Object 0: the primitive bounding its march, 'box' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical)",
                'marched objects: not implemented in testspace space (implemented in: euclidean, hyperbolic, spherical)',
            ]);
        } finally {
            cylinder.marchBound = bound;
            delete torus[SPACE];
            delete (PRIMITIVES.cylinder.glsl as Writable<SpaceBodies>)[SPACE];
        }
    });
});

describe('the hittable light\'s desugared parts', () => {
    // A disk light runs as the disk kind, a disk primitive and a material of
    // LIGHT_BACKING_MODEL (lambert): give the test space every other occupant of a mirror
    // sphere lit by a disk light, and check the Validator and the compiler agree on lambert.
    function withDiskLightBodies(run: () => void): void {
        const local: Array<() => void> = [];
        const add = (glsl: SpaceBodies) => {
            const bodies = glsl as Writable<SpaceBodies>;
            bodies[SPACE] = glsl.euclidean;
            local.push(() => { delete bodies[SPACE]; });
        };
        add(MATERIAL_MODELS.mirror!.glsl);
        add(PRIMITIVES.disk.glsl);
        add(LIGHT_KINDS.disk.glsl);
        const power = LIGHT_SELECTIONS.power as { spaces: SpaceList };
        const before = power.spaces;
        power.spaces = [...before, SPACE];
        local.push(() => { power.spaces = before; });
        try { run(); } finally { for (const undo of local.reverse()) undo(); }
    }
    const mirrorLit = () => scene(SPACE, (x) => {
        x.objects = [sphere(0, 'shiny')];
        x.materials = { shiny: { model: 'mirror' } };
        x.lights.push({ kind: 'disk', position: [0, 3, 0], normal: [0, -1, 0], radius: 0.5, emission: 5 } as never);
    });

    it('rejects the light when the backing material model has no body for the space', () => {
        withDiskLightBodies(() => {
            const lambert = MATERIAL_MODELS.lambert!.glsl as Writable<SpaceBodies>;
            const body = lambert[SPACE];
            delete lambert[SPACE];
            try {
                for (const directLighting of ['none', 'nee'] as const) {
                    expect(spaceErrors(mirrorLit(), strategy({ directLighting }))).toEqual([
                        "Light 0: its backing material model 'lambert' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical, h2xr)",
                    ]);
                }
            } finally { lambert[SPACE] = body; }
        });
    });

    it('passes and compiles the light when every desugared part has a body', () => {
        withDiskLightBodies(() => {
            for (const directLighting of ['none', 'nee'] as const) {
                const st = strategy({ directLighting });
                expect(errors(mirrorLit(), st)).toEqual([]);
                expect(() => new Compiler().compileScene(mirrorLit(), [st])).not.toThrow();
            }
        });
    });
});

describe('emissive objects (design §2.3: not light-sampled in curved spaces)', () => {
    const lamp = () => scene(SPACE, (x) => {
        x.materials.lamp = { model: 'lambert', albedo: 0, emission: 4 };
        x.objects.push(sphere(2, 'lamp'));
    });
    const sampled = [
        "Object 1: light kind 'sphere' has no testspace implementation (implemented in: euclidean)",
        'emissive objects sampled as lights: not implemented in testspace space (implemented in: euclidean)',
    ];

    it('passes and compiles under pure path tracing, where BSDF hits find them', () => {
        expect(errors(lamp(), strategy())).toEqual([]);
        expect(() => new Compiler().compileScene(lamp(), [strategy()])).not.toThrow();
    });

    it('rejects one the census would sample under NEE, and passes it with sampleAsLight: false', () => {
        const reasons = spaceErrors(lamp(), strategy({ directLighting: 'nee' }));
        for (const reason of sampled) expect(reasons).toContain(reason);
        const pathOnly = scene(SPACE, (x) => {
            x.materials.lamp = { model: 'lambert', albedo: 0, emission: 4, sampleAsLight: false };
            x.objects.push(sphere(2, 'lamp'));
        });
        const pathOnlyReasons = spaceErrors(pathOnly, strategy({ directLighting: 'nee' }));
        for (const reason of sampled) expect(pathOnlyReasons).not.toContain(reason);
    });
});

describe('curvedLimitations (features without a descriptor, resolved estimator occupants)', () => {
    const marched = (n: number): ObjectDescription[] => Array.from({ length: n }, (_, i) =>
        ({ type: 'torus', parameters: { ringRadius: 0.3, tubeRadius: 0.1 }, material: 'matte', transform: { position: [i, 0, 0] } }) as ObjectDescription);

    it('reports each present row', () => {
        const s = scene(SPACE, (x) => {
            x.objects.push({
                kind: 'mesh', material: 'matte',
                positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]),
            });
            x.objects.push({ kind: 'instanced', prototype: sphere(0), placements: [{ position: [0, 2, 0] }] });
            x.objects.push({ ...sphere(4), transform: { scale: 2 } });
            x.materials.grin = { model: 'none', medium: { sigma_a: 0, ior: 1.2 } } as never;
            x.objects.push(sphere(6, 'grin'));
            x.materials.haze = { model: 'none', medium: { sigma_a: 0.01 } };
            x.ambientMedium = 'haze';
            x.environment = { type: 'constant', color: [0.2, 0.2, 0.2], sampleAsLight: true };
            x.materials.lamp = { model: 'lambert', albedo: 0, emission: 4 };
            x.objects.push(sphere(8, 'lamp'));
        });
        const reasons = spaceErrors(s, strategy({ directLighting: 'nee' }))
            .filter((m) => m.includes(' space (implemented in: '));
        expect(reasons).toEqual([
            'an ambient medium: not implemented in testspace space (implemented in: euclidean)',
            'an environment sampled as a light: not implemented in testspace space (implemented in: euclidean)',
            'an environment: not implemented in testspace space (implemented in: euclidean, hyperbolic, h2xr)',
            'deflecting (GRIN) media: not implemented in testspace space (implemented in: euclidean)',
            'emissive objects sampled as lights: not implemented in testspace space (implemented in: euclidean)',
            'instanced objects: not implemented in testspace space (implemented in: euclidean)',
            'mesh objects: not implemented in testspace space (implemented in: euclidean)',
            'object scale other than 1: not implemented in testspace space (implemented in: euclidean)',
        ]);
    });

    it('reports tracking media and equiangular sampling', () => {
        const s = scene(SPACE, (x) => {
            x.materials.smoke = { model: 'none', medium: { sigma_a: { kind: 'glsl', source: 'p.x * p.x' }, majorant: 1 } };
            x.objects.push(sphere(2, 'smoke'));
        });
        expect(spaceErrors(s, strategy({ volumeSampling: 'delta-tracking' })))
            .toContain('media on the null-collision (tracking) arms: not implemented in testspace space (implemented in: euclidean)');
        expect(spaceErrors(scene(SPACE), strategy({ mediumLightSampling: 'equiangular' })))
            .toContain("mediumLightSampling 'equiangular': not implemented in testspace space (implemented in: euclidean)");
    });

    it('checks the RESOLVED object dispatch: the size-based table default and an explicit choice', () => {
        const nine = scene(SPACE, (x) => { x.objects = marched(9); });
        expect(spaceErrors(nine, strategy())).toContain("estimator.objectDispatch 'table' has no testspace implementation (implemented in: euclidean)");
        const eight = scene(SPACE, (x) => { x.objects = marched(8); });
        expect(spaceErrors(eight, strategy()).filter((m) => m.startsWith('estimator.objectDispatch'))).toEqual([]);
        expect(spaceErrors(scene(SPACE), strategy({ objectDispatch: 'table' })))
            .toContain("estimator.objectDispatch 'table' has no testspace implementation (implemented in: euclidean)");
    });

    it('checks the resolved light selection only when the program selects lights', () => {
        const lit = scene(SPACE, (x) => { x.lights.push({ kind: 'point', position: [0, 3, 0], emission: 5 } as never); });
        const power = "estimator.lightSelection 'power' has no testspace implementation (implemented in: euclidean, hyperbolic, spherical, h2xr)";
        expect(spaceErrors(lit, strategy({ directLighting: 'nee' }))).toContain(power);
        expect(spaceErrors(lit, strategy())).not.toContain(power);
    });

    it('reports bump mapping, and each Euclidean-only material model by name', () => {
        const bumped = scene(SPACE, (x) => {
            x.materials.matte = { model: 'lambert', albedo: 0.5, bump: { height: { kind: 'glsl', source: '0.01 * sin(10.0 * p.x)' }, step: 1e-3 } };
        });
        expect(spaceErrors(bumped, strategy()))
            .toContain('bump mapping: not implemented in testspace space (implemented in: euclidean)');
        for (const model of ['plastic', 'thin_dielectric', 'sheen', 'conductor', 'rough_conductor']) {
            const s = scene(SPACE, (x) => { x.materials.matte = { model } as never; });
            expect(spaceErrors(s, strategy()))
                .toContain(`Material 'matte': material model '${model}' has no testspace implementation (implemented in: euclidean)`);
        }
    });

    it('checks the resolved mesh and instance traversals where meshes and instances exist', () => {
        const s = scene(SPACE, (x) => {
            x.objects.push({
                kind: 'mesh', material: 'matte',
                positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]),
            });
            x.objects.push({ kind: 'instanced', prototype: sphere(0), placements: [{ position: [0, 2, 0] }] });
        });
        const reasons = spaceErrors(s, strategy());
        expect(reasons).toContain("estimator.meshTraversal 'bvh' has no testspace implementation (implemented in: euclidean)");
        expect(reasons).toContain("estimator.instanceAccel 'tlas' has no testspace implementation (implemented in: euclidean)");
    });
});

describe('Euclidean space', () => {
    it('reports nothing for the same scenes', () => {
        const busy = scene('euclidean', (x) => {
            x.objects.push({ type: 'torus', parameters: { ringRadius: 1, tubeRadius: 0.2 }, material: 'matte' } as ObjectDescription);
            x.objects.push({
                kind: 'mesh', material: 'matte',
                positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]),
            });
            x.materials.haze = { model: 'none', medium: { sigma_a: 0.01, sigma_s: 0.1 } };
            x.ambientMedium = 'haze';
            x.lights.push({ kind: 'disk', position: [0, 3, 0], normal: [0, -1, 0], radius: 0.5, emission: 5 } as never);
            x.environment = { type: 'constant', color: [0.2, 0.2, 0.2], sampleAsLight: true };
        });
        expect(spaceErrors(busy, strategy({ directLighting: 'nee', objectDispatch: 'table' }))).toEqual([]);
    });
});
