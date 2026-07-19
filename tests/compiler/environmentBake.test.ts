// The procedural-env BAKE shader's static compile check (compiler-pass C1) — the first
// coverage of compileEnvironmentBake: the bake renderer lives OUTSIDE the registry-pair
// net (glsl-compile.test.ts iterates main programs only), which is exactly how the
// octahedral bake shipped broken — its chart called env_rotate_cs/u_envRotCS while the
// bake shim still provided the retired env_rotate_y contract, and nothing parsed it
// until App bake time. Both charts now compile here per registry key.

import { describe, it, expect } from 'vitest';
import { compileEnvironmentBake } from '../../src/compiler/EnvironmentBake.js';
import { ENV_CHARTS } from '../../src/components/env/index.js';
import type { SceneDescription } from '../../src/compiler/types.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const scene: SceneDescription = {
    id: 'bake-check',
    ambientSpace: { type: 'euclidean' },
    objects: [],
    materials: {},
    lights: [],
    environment: {
        type: 'procedural',
        glsl: { kind: 'glsl', source: 'vec3(0.4, 0.6, 1.0) * max(dir.y, 0.0) + vec3(0.05)' },
    },
};

describe('procedural-env bake shaders (compileEnvironmentBake)', () => {
    for (const chart of Object.keys(ENV_CHARTS) as Array<'equirect' | 'octahedral'>) {
        it(`${chart} bake fragment passes the glslang static check`, () => {
            const compiled = compileEnvironmentBake(scene, chart);
            expect(compiled).not.toBeNull();
            for (const [id, prog] of compiled!.shaders) {
                glslangCheck(prog.vertex, 'vert', `${id} [vertex]`);
                glslangCheck(prog.fragment, 'frag', `${id} [fragment]`);
            }
        });
    }

    it('non-procedural environments compile no bake renderer', () => {
        expect(compileEnvironmentBake({ ...scene, environment: { type: 'constant', color: [1, 1, 1] } })).toBeNull();
    });
});
