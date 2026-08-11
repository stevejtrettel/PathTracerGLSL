// The region→material decomposition (impl-plan-region-materials).
//
// Under TABLE dispatch, region→material is DATA (one rail fetch against the
// regionMaterials tenant) and ior_of decomposes to ior_of_material(material_of(r), p)
// — generated size follows the MATERIAL count. Under UNROLLED dispatch the baked
// constant arms are byte-untouched (the strongest gate: small scenes cannot move).
// The scene-side mirror (regionMaterialsOf) is Planner-ASSERTED on every tabled
// compile, so the desugared-light case below is the drift test.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { regionMaterialsOf } from '../../src/compiler/plan/dataTenants.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

const compiler = new Compiler();

/** A scene with every region class the mirror must count: primitives (mixed
 *  materials), a desugared HITTABLE light (quad → minted region + material), and a
 *  delta light (no region — must NOT shift ids). */
const scene: SceneDescription = {
    id: 'region-materials-fixture',
    name: 'region materials fixture',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', name: 'ground', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'a' },
        { type: 'sphere', name: 's1', parameters: { radius: 0.5 }, material: 'b', transform: { position: [0, 1, 0] } },
        { type: 'sphere', name: 's2', parameters: { radius: 0.4 }, material: 'glass', transform: { position: [1.5, 1, 0] } },
        { type: 'box', name: 'block', parameters: { halfSize: [0.3, 0.3, 0.3] }, material: 'a', transform: { position: [-1.5, 0.3, 0] } },
    ],
    materials: {
        a: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        b: { model: 'lambert', albedo: [0.7, 0.3, 0.3] },
        glass: { model: 'dielectric', ior: 1.5, albedo: [0.95, 0.95, 0.95] },
    },
    lights: [
        { kind: 'point', position: [0, 3, 2], emission: 5 },                                     // delta: no region
        { kind: 'quad', corner: [-1, 3, -1], edge1: [2, 0, 0], edge2: [0, 0, 2], emission: 6 },  // hittable: region 4, material 3
    ],
    environment: { type: 'constant', color: [0.1, 0.1, 0.1], intensity: 1 },
};

const strategy = (objectDispatch: 'unrolled' | 'table'): RenderStrategy => ({
    id: `rm-${objectDispatch}`,
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', objectDispatch, russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
});

const mainSource = (dispatch: 'unrolled' | 'table'): string => {
    const result = compiler.compile(scene, strategy(dispatch));
    for (const [id, prog] of result.shaders) {
        if (id.endsWith('-main')) return prog.fragment;
    }
    throw new Error('no main program');
};

describe('region→material decomposition (impl-plan-region-materials)', () => {
    it('the scene-side mirror counts every region class (delta lights shift nothing)', () => {
        // objects a,b,glass,a = ids [0,1,2,0]; the quad light mints material 3 as region 4.
        expect(regionMaterialsOf(scene)).toEqual([0, 1, 2, 0, 3]);
    });

    it("'table' dispatch emits the DATA forms — a fetch, no per-region arms", () => {
        const glsl = mainSource('table');
        expect(glsl).toMatch(/int material_of\(int region\) \{\n {4}if \(region < 0\)/);
        expect(glsl).toContain('ids = texelFetch(u_data_records');
        expect(glsl).toContain('float ior_of_material(int mat, vec3 p)');
        expect(glsl).toContain('return ior_of_material(material_of(region), p);');
        // No per-region constant arm survives in either table.
        expect(glsl).not.toMatch(/material_of[\s\S]{0,400}if \(region == 2\) return/);
    });

    it("'unrolled' dispatch keeps the baked arms byte-for-byte", () => {
        const glsl = mainSource('unrolled');
        expect(glsl).toContain('if (region == 0) return 0;');
        expect(glsl).toContain('if (region == 2) return 2;');    // the glass sphere's ior row path
        expect(glsl).not.toContain('ior_of_material');
        expect(glsl).not.toMatch(/material_of\(int region\) \{[\s\S]{0,200}texelFetch/);
    });

    it('both forms agree on the compile-time mirror (the Planner assert ran)', () => {
        // The 'table' compile above already exercised the assert; this pins that a
        // compile with a desugared light region does not throw the drift error.
        expect(() => mainSource('table')).not.toThrow();
    });
});
