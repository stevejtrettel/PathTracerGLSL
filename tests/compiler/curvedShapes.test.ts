// Curved box, cylinder and quad programs and the curved quad light: the witness programs compile
// and pass the glslang static check; the quad is placed at its center and keeps its edges as
// tangent vectors; the quad light's rows are the region's isometry applied (its `corner` row holds
// the center) while the selection power reads the authored rows; and the Validator enforces the
// curved domains (S³ half-extents below π/2, bounded H³ boxes and quads, orthogonal quad edges) in
// curved spaces only.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { curvedShapesSuite, h3QuadLight, s3Shapes, H3_QUAD_LIGHT } from '../witnesses/scenes/curvedShapesWitness.js';
import { h3DirectNeeStrategy, H3_CAMERA, h3Furnace, h3FurnaceStrategy } from '../witnesses/scenes/h3Witness.js';
import { s3Furnace, s3FurnaceStrategy } from '../witnesses/scenes/s3Witness.js';
import { hyperbolicGeometry as Hg } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import { ORIGIN, mat4Apply, placementIsometry, tangentAtOrigin } from '../../src/components/ambient/isometry.js';
import { formatMat4, formatVec4 } from '../../src/components/glsl-format.js';
import { IDENTITY_QUAT } from '../../src/components/geometry/similarity.js';
import { withPose } from '../../src/authoring/strategy.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';

const compiler = new Compiler();
const fragmentOf = (scene: SceneDescription, strategy: RenderStrategy): string =>
    [...compiler.compileScene(scene, [strategy]).renderers[0].shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment;
function errorsOf(scene: SceneDescription, strategy: RenderStrategy): string {
    try {
        compiler.compileScene(scene, [strategy]);
        return '';
    } catch (err) {
        return String(err);
    }
}

describe('curved shapes witness programs', () => {
    for (const [id, entry] of Object.entries(curvedShapesSuite)) {
        it(`${id} compiles and passes the glslang static check`, () => {
            const compiled = compiler.compileScene(entry.scene, entry.strategies);
            for (const r of compiled.renderers) {
                for (const [sid, program] of r.shaders) glslangCheck(program.fragment, 'frag', sid);
            }
        }, 60000);
    }
});

describe('curved quad placement and quad-light rows', () => {
    const nee = withPose(h3DirectNeeStrategy, H3_CAMERA.position, H3_CAMERA.target);

    it('the quad light\'s region is placed at the quad\'s center; its rows are that isometry applied', () => {
        const glsl = fragmentOf(h3QuadLight, nee);
        const l = H3_QUAD_LIGHT;
        const center = [0, 1, 2].map((i) => l.corner[i] + 0.5 * (l.edge1[i] + l.edge2[i])) as [number, number, number];
        const g = placementIsometry(Hg, [0, 0, 0], IDENTITY_QUAT, center);
        expect(glsl).toContain(`const mat4 isometry_object_1 = ${formatMat4(Hg.inverse(g))};`);
        // the struct: rows typed Point/Direction, no derived fields
        expect(glsl).toMatch(/struct QuadLight \{\s*Point corner;\s*Direction edge1;\s*Direction edge2;\s*Spectrum radiance;\s*\};/);
        const E1 = formatVec4(mat4Apply(g, tangentAtOrigin(l.edge1)));
        const E2 = formatVec4(mat4Apply(g, tangentAtOrigin(l.edge2)));
        expect(glsl).toContain(`QuadLight(${formatVec4(mat4Apply(g, ORIGIN))}, ${E1}, ${E2},`);
        // the backing quad keeps its edges as tangent vectors at o and no derived normal
        expect(glsl).toMatch(/struct Quad \{\s*Direction edge1;\s*Direction edge2;\s*\};/);
        expect(glsl).toContain('Quad(Direction(1.2, 0.0, 0.0, 0.0), Direction(0.0, 0.0, 1.0, 0.0))');
    });

    it('a quad object is placed at corner + (edge1 + edge2)/2 and the transform applied after', () => {
        const glsl = fragmentOf(s3Shapes, withPose(s3FurnaceStrategy, [0, 0.6, 1.2], [0, 0, 0]));
        expect(glsl).toContain('Quad(Direction(0.45, 0.0, 0.2, 0.0), Direction(0.0, 0.45, 0.0, 0.0))');
        expect(glsl).toContain('Box(vec3(0.25, 0.22, 0.25))');
        expect(glsl).toContain('Cylinder(0.2, 0.3)');
    });
});

describe('curved shape domains (Validator)', () => {
    const h3 = withPose(h3FurnaceStrategy, [0, 0, 0], [0, 0, -1]);
    const s3 = withPose(s3FurnaceStrategy, [0, 0, 0], [0, 0, -1]);
    const withObject = (base: SceneDescription, o: object) => ({ ...base, objects: [...base.objects, { ...o, material: 'furnace' }] } as SceneDescription);
    const quad = (edge1: number[], edge2: number[]) => ({ type: 'quad', parameters: { corner: [0, 0, 0], edge1, edge2 } });

    it('S³: box half-sizes and cylinder radius/half-height lie below π/2', () => {
        const h = Math.PI / 2;
        expect(errorsOf(withObject(s3Furnace, { type: 'box', parameters: { halfSize: [0.2, h - 1e-3, 0.2] } }), s3)).toBe('');
        expect(errorsOf(withObject(s3Furnace, { type: 'box', parameters: { halfSize: [0.2, h, 0.2] } }), s3))
            .toContain("parameter 'halfSize' must be in (0, 1.570796) in spherical space");
        expect(errorsOf(withObject(s3Furnace, { type: 'cylinder', parameters: { radius: h, halfHeight: 0.2 } }), s3))
            .toContain("parameter 'radius' must be in (0, 1.570796) in spherical space");
        expect(errorsOf(withObject(s3Furnace, { type: 'cylinder', parameters: { radius: 0.2, halfHeight: 1.6 } }), s3))
            .toContain("parameter 'halfHeight' must be in (0, 1.570796) in spherical space");
    });

    it('H³: a box is bounded (Σ tanh² h < 1); a quad is bounded (sinh a·sinh b < 1)', () => {
        expect(errorsOf(withObject(h3Furnace, { type: 'box', parameters: { halfSize: [0.6, 0.6, 0.6] } }), h3)).toBe('');
        expect(errorsOf(withObject(h3Furnace, { type: 'box', parameters: { halfSize: [0.7, 0.7, 0.7] } }), h3))
            .toContain('Σ tanh²(halfSize)');
        expect(errorsOf(withObject(h3Furnace, quad([1.6, 0, 0], [0, 0, 1.6])), h3)).toBe('');
        expect(errorsOf(withObject(h3Furnace, quad([1.8, 0, 0], [0, 0, 1.8])), h3)).toContain('sinh(|edge1|/2)·sinh(|edge2|/2)');
    });

    it('curved quads need orthogonal edges (and S³ edges below π); Euclidean quads do not', () => {
        expect(errorsOf(withObject(h3Furnace, quad([0.5, 0, 0], [0.1, 0, 0.5])), h3)).toContain('edge1 and edge2 must be orthogonal');
        expect(errorsOf(withObject(s3Furnace, quad([0.5, 0, 0], [0.1, 0, 0.5])), s3)).toContain('edge1 and edge2 must be orthogonal');
        expect(errorsOf(withObject(s3Furnace, quad([3.2, 0, 0], [0, 0, 0.5])), s3)).toContain('must be < π');
        const euclid: SceneDescription = { ...h3Furnace, ambientSpace: { type: 'euclidean' }, objects: [{ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [0.5, 0, 0], edge2: [0.1, 0, 0.5] }, material: 'furnace' }] };
        expect(errorsOf(euclid, h3FurnaceStrategy)).not.toContain('orthogonal');
    });

    it('the quad light carries the same rules', () => {
        const light = (edge2: [number, number, number]) => ({ ...h3QuadLight, lights: [{ kind: 'quad', ...H3_QUAD_LIGHT, edge2 }] } as SceneDescription);
        expect(errorsOf(light([0.1, 0, 1.0]), withPose(h3DirectNeeStrategy, H3_CAMERA.position, H3_CAMERA.target)))
            .toContain('Light 0 (quad): edge1 and edge2 must be orthogonal');
    });
});
