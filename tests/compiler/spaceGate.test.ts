// The space gate and the curved-space limitations, exercised with a test-only ambient space.
// No curved space is registered yet, so this file registers 'testspace' in memory (the
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
            "Light 0: its backing primitive 'disk' has no testspace implementation (implemented in: euclidean)",
            "Light 0: light kind 'disk' has no testspace implementation (implemented in: euclidean)",
            "Material 'fog': phase model 'hg' has no testspace implementation (implemented in: euclidean)",
            "Material 'metal': material model 'ggx' has no testspace implementation (implemented in: euclidean)",
            "Object 1: primitive 'torus' has no testspace implementation (implemented in: euclidean)",
            "Object 1: the primitive bounding its march, 'cylinder' has no testspace implementation (implemented in: euclidean)",
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
            'an environment: not implemented in testspace space (implemented in: euclidean)',
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
        const power = "estimator.lightSelection 'power' has no testspace implementation (implemented in: euclidean)";
        expect(spaceErrors(lit, strategy({ directLighting: 'nee' }))).toContain(power);
        expect(spaceErrors(lit, strategy())).not.toContain(power);
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
