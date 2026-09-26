// compileScene's own contract beyond the per-strategy stages: strategy ids are unique (they
// name the renderers, and the engine keys programs by them), and warnings reach the caller
// (a successful compile used to drop every warning).

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

const scene: SceneDescription = {
    id: 's',
    ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'sphere', parameters: { radius: 1 }, material: 'm' }],
    materials: { m: { model: 'lambert' } },
    lights: [{ kind: 'point', position: [0, 5, 0], emission: 10 }],
};
const strategy = (id: string, camera: Record<string, unknown> = {}): RenderStrategy => ({
    id,
    measurement: { camera: { type: 'pinhole', fov: 0.8, ...camera } as RenderStrategy['measurement']['camera'], maxBounces: 2 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

describe('compileScene', () => {
    it('rejects two strategies with one id', () => {
        expect(() => new Compiler().compileScene(scene, [strategy('a'), strategy('a')])).toThrow(/share the id 'a'/);
    });

    it('rejects an empty strategy list with a diagnostic', () => {
        expect(() => new Compiler().compileScene(scene, [])).toThrow(/at least one strategy/);
    });

    it('returns the warnings of a successful compile, once each', () => {
        const compiled = new Compiler().compileScene(scene, [strategy('a', { aperture: 1 }), strategy('b', { aperture: 1 })]);
        const unknown = compiled.warnings.filter((w) => w.includes("unknown field 'aperture'"));
        expect(unknown).toHaveLength(1);
    });
});
