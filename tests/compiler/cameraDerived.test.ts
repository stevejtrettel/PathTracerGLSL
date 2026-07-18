// tests/compiler/cameraDerived.test.ts
// The camera DERIVED-value rail (docs/handoff-2026-07-18-descriptor-compute.md, camera cut):
// a value the shader needs that is a FUNCTION of a control (tan(fov/2), the fisheye radial
// constant, the cylindrical focal length) is precomputed on the CPU and shipped as a uniform
// — NEVER recomputed per ray on the GPU (the "DERIVED leaked to the GPU" offender class).
//
// This pins two invariants the cut must keep:
//   1. Each derived uniform is a live binding with a `compute` closure, finite at defaults,
//      and bake ≡ ship (the plan-time default equals compute(defaults)).
//   2. The offender transcendentals are GONE from the emitted camera GLSL — the fisheye
//      radial trig and the cylindrical `radians()` no longer ride the per-ray path.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy, CameraDescription } from '../../src/compiler/types.js';
import { cornellBox } from '../witnesses/scenes/cornellBox.js';

const compiler = new Compiler();

/** cornellBox encloses the camera, so every projection sees geometry — a valid compile for
 *  any camera. One strategy per camera under test. */
function strategyFor(camera: CameraDescription, id: string): RenderStrategy {
    return {
        id,
        measurement: { camera, maxBounces: 4 },
        estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}

/** The main fragment with line comments stripped — the assertions below are about EMITTED
 *  CODE, and a comment legitimately documents a derivation (pinhole: "u_tanFov = tan(fov/2)"). */
function mainFragment(scene: typeof cornellBox, strategy: RenderStrategy): string {
    const r = compiler.compile(scene, strategy);
    return r.shaders.get(`${r.id}-main`)!.fragment.replace(/\/\/[^\n]*/g, '');
}

function binding(scene: typeof cornellBox, strategy: RenderStrategy, uniform: string) {
    const r = compiler.compile(scene, strategy);
    return r.uniforms.find((u) => u.uniform === uniform);
}

describe('camera derived-value rail', () => {
    it('u_tanFov is CPU-derived (pinhole) — bake ≡ tan(fov/2), not a raw fov uniform', () => {
        const strat = strategyFor({ type: 'pinhole', fov: 0.8 }, 'cam-pinhole');
        const b = binding(cornellBox, strat, 'u_tanFov');
        expect(b, 'u_tanFov binding exists').toBeDefined();
        expect(b!.parameters).toContain('camera.fov');
        // bake ≡ ship: compute over the default equals tan(fov/2).
        expect(b!.compute({ 'camera.fov': 0.8 })).toBeCloseTo(Math.tan(0.4), 12);
        // The GPU never takes a tan (the CPU did) — pinhole/thin-lens do no transcendental.
        expect(mainFragment(cornellBox, strat)).not.toMatch(/\btan\s*\(/);
    });

    it('thin-lens keeps u_tanFov derived AND aperture/focus as raw pass-throughs', () => {
        const strat = strategyFor({ type: 'thinlens', fov: 0.8, aperture: 0.1, focusDistance: 4 }, 'cam-thinlens');
        expect(binding(cornellBox, strat, 'u_tanFov')?.compute({ 'camera.fov': 0.8 })).toBeCloseTo(Math.tan(0.4), 12);
        // Pass-through: the uniform value is the control value, unchanged.
        expect(binding(cornellBox, strat, 'u_aperture')?.compute({ 'camera.aperture': 0.1 })).toBeCloseTo(0.1, 12);
        expect(binding(cornellBox, strat, 'u_focusDistance')?.compute({ 'camera.focusDistance': 4 })).toBeCloseTo(4, 12);
    });

    it('u_fisheyeK is CPU-derived per projection — the radial trig leaves the per-ray path', () => {
        // Each projection folds a different frame-constant transcendental of θmax = fov/2 into K.
        const fov = Math.PI;
        const expectedK: Record<string, number> = {
            equidistant: fov / 2,
            equisolid: Math.sin(fov / 4),
            stereographic: Math.tan(fov / 4),
            orthographic: Math.sin(fov / 2),
        };
        for (const [projection, k] of Object.entries(expectedK)) {
            const strat = strategyFor({ type: 'fisheye', projection: projection as never, fov }, `cam-fisheye-${projection}`);
            const b = binding(cornellBox, strat, 'u_fisheyeK');
            expect(b, `u_fisheyeK binding exists (${projection})`).toBeDefined();
            expect(b!.compute({ 'camera.fisheyeFov': fov }), projection).toBeCloseTo(k, 12);
            // No per-ray fisheye uniform trig, and the old raw-fov uniform is gone.
            const frag = mainFragment(cornellBox, strat);
            expect(frag, `no u_fisheyeFov (${projection})`).not.toContain('u_fisheyeFov');
            expect(frag, `radial map takes K not trig (${projection})`).toContain('u_fisheyeK');
        }
    });

    it('u_cylFocal is CPU-derived from hfov + image size — radians() leaves the per-ray path', () => {
        const strat = strategyFor({ type: 'cylindrical', hfov: 240 }, 'cam-cyl');
        const b = binding(cornellBox, strat, 'u_cylFocal');
        expect(b, 'u_cylFocal binding exists').toBeDefined();
        expect(b!.parameters).toEqual(expect.arrayContaining(['camera.cylHfov', 'engine.imageSize']));
        // f = imageSize.x / radians(hfov).
        const f = 800 / ((240 * Math.PI) / 180);
        expect(b!.compute({ 'camera.cylHfov': 240, 'engine.imageSize': [800, 600] })).toBeCloseTo(f, 9);
        const frag = mainFragment(cornellBox, strat);
        expect(frag, 'no u_cylHfov raw uniform').not.toContain('u_cylHfov');
        expect(frag, 'no per-ray radians() of the sweep').not.toMatch(/radians\s*\(\s*u_cyl/);
        expect(frag).toContain('u_cylFocal');
    });
});
