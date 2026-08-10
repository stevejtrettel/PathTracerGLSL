// tests/authoring/instanceCloud.test.ts — the fixture-scene coverage gate
// (fable-instance-clouds §6): the REAL data path — committed .inst fixture →
// parseInstances → instanceCloud → Compiler → glslang — at toy scale. Codegen is
// count-invariant, so this is full structural coverage of what the 50 MB files
// exercise at runtime; those files never enter tests. Plus hook semantics
// (priority: hook > baked > default; sizeScale composition).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glslangCheck as check } from '../helpers/glslangCheck.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { parseInstances } from '../../src/authoring/loadInstances.js';
import { instanceCloud } from '../../src/authoring/instance.js';
import type { SceneDescription, RenderStrategy, PackedPlacements } from '../../src/compiler/types.js';

const raw = readFileSync(join(__dirname, '..', 'fixtures', 'cloud-500.inst'));
const table = parseInstances(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

const strategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

function cloudScene(id: string): SceneDescription {
    return {
        id, name: id,
        ambientSpace: { type: 'euclidean' },
        objects: [instanceCloud(table, { shape: 'sphere', material: 'point', name: 'cloud' })],
        materials: { point: { model: 'lambert', albedo: [0.8, 0.5, 0.3] } },
        lights: [{ kind: 'point', position: [8, 10, 6], emission: 200 }],
        environment: { type: 'constant', color: [0.3, 0.4, 0.6], intensity: 1.0 },
    };
}

// The fixture carries EVERY optional column, so this one compile exercises packed
// placements WITH orientations + the packed color attribute end to end.
describe('instanceCloud fixture scene compiles (Compiler + glslang)', () => {
    const compiler = new Compiler();
    it('sphere cloud (packed placements + orientations + color attribute)', () => {
        const renderer = compiler.compile(cloudScene('cloud-fixture-sphere'), strategy);
        for (const [shaderId, prog] of renderer.shaders) {
            check(prog.vertex, 'vert', `${shaderId} [vertex]`);
            check(prog.fragment, 'frag', `${shaderId} [fragment]`);
        }
    });

    // The cube-clouds door (placement-fold stage 4, Aug 10 2026): the same packed
    // cloud with the 'cube' shape — FRAME-tier records (box is not similarityClosed),
    // orientations conjugated per instance, box_intersect with s-scaled params.
    it('cube cloud (frame-tier box prototype through the packed arm)', () => {
        const scene = cloudScene('cloud-fixture-cube');
        scene.objects = [instanceCloud(table, { shape: 'cube', material: 'point', name: 'cloud' })];
        const renderer = compiler.compile(scene, strategy);
        for (const [shaderId, prog] of renderer.shaders) {
            check(prog.vertex, 'vert', `${shaderId} [vertex]`);
            check(prog.fragment, 'frag', `${shaderId} [fragment]`);
        }
    });

    // Stage-2 instance lights (fable-light-bvh §7): the SAME packed cloud with an
    // emissive material under lightSelection 'bvh' — 500 instances become 500 tree
    // lights (no other light in the scene). 'mis' on purpose: it links the batch
    // lighting_pdf arm + the element-indexed trail walk on top of the sampler.
    it('EMISSIVE cloud under bvh selection (instances are the only lights, pt-mis)', () => {
        const scene = cloudScene('cloud-fixture-glow');
        scene.materials.point = { model: 'lambert', albedo: [0.05, 0.04, 0.03], emission: [4, 2.2, 1] };
        scene.lights = [];
        scene.environment = { type: 'none' };
        // §7.1: the fixture's colors column drives PER-INSTANCE emission — the sampler,
        // pdf, and hit-side fill all read the same attrs rows; the constant is the fallback.
        const cloud = scene.objects[0] as { attributes?: Record<string, unknown> };
        cloud.attributes = { emission: table.colors };
        const bvhStrategy: RenderStrategy = {
            ...strategy, id: 'mis-bvh',
            estimator: { ...strategy.estimator, directLighting: 'mis', lightSelection: 'bvh' },
        };
        const renderer = compiler.compile(scene, bvhStrategy);
        let sawWalks = false;
        for (const [shaderId, prog] of renderer.shaders) {
            check(prog.vertex, 'vert', `${shaderId} [vertex]`);
            check(prog.fragment, 'frag', `${shaderId} [fragment]`);
            if (prog.fragment.includes('light_tree_pick') && prog.fragment.includes('light_tree_pmf')
                && prog.fragment.includes('light_of(int region, int element)')) sawWalks = true;
        }
        expect(sawWalks).toBe(true);
    });
});

describe('instanceCloud hook semantics', () => {
    it('defaults: baked sizes/colors pass through as views; albedo carries the colors', () => {
        const o = instanceCloud(table, { shape: 'sphere', material: 'point' });
        const p = o.placements as PackedPlacements;
        expect(p.count).toBe(500);
        expect(p.positions).toBe(table.positions);
        expect(p.sizes).toBe(table.sizes);
        expect(p.orientations).toBe(table.orientations);
        expect(o.attributes?.albedo).toBe(table.colors);
    });

    it('size hook overrides baked sizes, reading named scalar columns', () => {
        const o = instanceCloud(table, {
            shape: 'sphere', material: 'point',
            size: (cols, i) => 2 / Math.sqrt(cols.height[i]),
        });
        const p = o.placements as PackedPlacements;
        expect(p.sizes![7]).toBeCloseTo(2 / Math.sqrt(table.scalars.height[7]), 6);
    });

    it('sizeScale composes multiplicatively on top of baked/hooked sizes', () => {
        const baked = instanceCloud(table, { shape: 'sphere', material: 'point', sizeScale: 0.25 });
        expect((baked.placements as PackedPlacements).sizes![3]).toBeCloseTo(0.25 * table.sizes![3], 6);
        const hooked = instanceCloud(table, { shape: 'sphere', material: 'point', size: () => 2, sizeScale: 0.5 });
        expect((hooked.placements as PackedPlacements).sizes![0]).toBeCloseTo(1, 6);
    });

    it('sizeScale with NO per-instance size source folds into the prototype radius (no sizes column)', () => {
        const sizeless = { ...table };
        delete (sizeless as { sizes?: Float32Array }).sizes;
        const o = instanceCloud(sizeless, { shape: 'sphere', material: 'point', sizeScale: 0.25 });
        expect((o.placements as PackedPlacements).sizes).toBeUndefined();
        expect((o.prototype as { parameters: Record<string, unknown> }).parameters.radius).toBe(0.25);
    });

    it('color hook + colorDrives override the baked column and the target row', () => {
        const o = instanceCloud(table, {
            shape: 'sphere', material: 'point',
            colorDrives: 'albedo',
            color: (cols, i) => [cols.height[i] > 500 ? 1 : 0, 0.5, 0.25],
        });
        const c = o.attributes!.albedo as Float32Array;
        expect(c).toHaveLength(1500);
        expect(c[3 * 11]).toBe(table.scalars.height[11] > 500 ? 1 : 0);
        expect(c[3 * 11 + 1]).toBe(0.5);
    });

    it('rejects unknown shapes loudly', () => {
        expect(() => instanceCloud(table, { shape: 'teapot', material: 'point' })).toThrow(/unknown shape/);
    });
});
