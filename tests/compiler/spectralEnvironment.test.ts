import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { buildEnvImportanceTable } from '../../src/components/env/importance.js';
import type { SceneDescription } from '../../src/compiler/types.js';

const compiler = new Compiler();
describe('spectral environments', () => {
    for (const environment of [
        { type: 'image', url: '/hdri/table_mountain_2_puresky_1k.hdr' },
        { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(0.1,0.4,0.8) * (1.0 + dir.y)' }, tableSize: [4, 2] },
    ] satisfies SceneDescription['environment'][]) {
        for (const envSampler of ['equirect', 'octahedral'] as const) for (const envCompensation of [false, true]) {
            it(`compiles ${environment.type}, ${envSampler}, compensation=${envCompensation}`, () => {
                const scene = { ...minimalScene, environment };
                const strategy = { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' as const },
                    estimator: { ...minimalStrategy.estimator, directLighting: 'mis' as const, envSampler, envCompensation } };
                for (const [id, shader] of compiler.compile(scene, strategy).shaders) glslangCheck(shader.fragment, 'frag', id);
                if (envCompensation) expect(() => compiler.compile(scene, { ...strategy,
                    estimator: { ...strategy.estimator, directLighting: 'nee' } })).toThrow(/compensation|Compensation/);
            });
        }
        it(`rejects invalid ${environment.type} intensity`, () => {
            for (const intensity of [-1, NaN, Infinity]) expect(() => compiler.compile(
                { ...minimalScene, environment: { ...environment, intensity } }, minimalStrategy)).toThrow(/intensity/);
        });
    }
});

describe('stored environment CDFs', () => {
    for (const chart of ['equirect', 'octahedral']) {
        it(`${chart}: empty and compensated-uniform tables have zero mass`, () => {
            for (const [value, compensation] of [[0, false], [1, true]] as const) {
                const table = buildEnvImportanceTable(new Float32Array(4 * 2 * 3).fill(value), 4, 2, { chart, compensation });
                expect(table.totalWeight).toBe(0);
                expect([...table.condCDF, ...table.margCDF].every(v => v === 0)).toBe(true);
            }
        });
        it(`${chart}: tiny positive tables still normalize`, () => {
            const table = buildEnvImportanceTable(new Float32Array(4 * 2 * 3).fill(1e-30), 4, 2, { chart });
            expect(table.margCDF[1]).toBe(1);
            expect(table.condCDF[3]).toBe(1);
            expect(table.condCDF[7]).toBe(1);
        });
    }
    it('rejects invalid table samples without constructing a substitute distribution', () => {
        for (const value of [NaN, Infinity, -1]) expect(() => buildEnvImportanceTable(
            new Float32Array([value, 1, 1]), 1, 1)).toThrow(/finite and nonnegative/);
    });
});
