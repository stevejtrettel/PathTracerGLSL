// measurement.farClip: the far clip MAX_DIST is the ambient descriptor's default unless the
// measurement authors one, and the compiler emits it as one define before the ambient block.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { AMBIENT_SPACES } from '../../src/components/ambient/index.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { hyperbolicScene, hyperbolicPtStrategy } from '../../demos/hyperbolicScene.js';
import { sphericalScene, sphericalPtStrategy } from '../../demos/sphericalScene.js';

const scene: SceneDescription = {
    id: 'far',
    ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'sphere', parameters: { radius: 1 }, material: 'm' }],
    materials: { m: { model: 'lambert' } },
    lights: [{ kind: 'point', position: [0, 5, 0], emission: 10 }],
};
const strategy = (farClip?: number): RenderStrategy => ({
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 2, ...(farClip !== undefined ? { farClip } : {}) },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

const fragment = (farClip?: number): string => {
    const r = new Compiler().compile(scene, strategy(farClip));
    return [...r.shaders.values()].map((s) => s.fragment).join('\n');
};
const defines = (src: string) => src.split('\n').filter((l) => /^#define MAX_DIST /.test(l));

describe('measurement.farClip', () => {
    it('defaults to the ambient descriptor (Euclidean 1000), emitted once', () => {
        expect(AMBIENT_SPACES.euclidean.farClip).toBe(1000);
        expect(defines(fragment())).toEqual(['#define MAX_DIST 1000.0']);
    });

    it('defaults to the curved descriptors (H³ 10, S³ 2π), emitted once and not by the occupant', () => {
        // A curved scene needs an authored pose; any pose inside the working radius serves.
        const posed = (st: RenderStrategy): RenderStrategy => ({
            ...st, measurement: { ...st.measurement, camera: { ...st.measurement.camera, position: [0, 0.3, 0.9], target: [0, 0, 0] } },
        });
        const curvedDefines = (s: SceneDescription, st: RenderStrategy): string[] =>
            defines([...new Compiler().compile(s, posed(st)).shaders.values()].map((x) => x.fragment).join('\n'));
        expect(curvedDefines(hyperbolicScene, hyperbolicPtStrategy)).toEqual(['#define MAX_DIST 10.0']);
        expect(curvedDefines(sphericalScene, sphericalPtStrategy)).toEqual([`#define MAX_DIST ${2 * Math.PI}`]);
    });

    it('overrides the default when authored', () => {
        expect(defines(fragment(8))).toEqual(['#define MAX_DIST 8.0']);
    });

    it('must be a finite number > 0', () => {
        for (const bad of [0, -1, Infinity, NaN]) {
            const bag = new DiagnosticBag('test');
            validate(analyze(scene), scene, strategy(bad), bag);
            expect(bag.getErrors().some((e) => /measurement\.farClip/.test(e.message)), String(bad)).toBe(true);
        }
        const ok = new DiagnosticBag('test');
        validate(analyze(scene), scene, strategy(8), ok);
        expect(ok.hasErrors()).toBe(false);
    });
});
