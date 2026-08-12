// Instanced containment (impl-plan-instanced-containment) + the two SILENT bugs its
// bring-up exposed. Both were invisible to every existing gate — the scenes compiled,
// glslang linked, 2178 vitest tests passed, and the glass simply rendered as clear air.
// These are the cheap structural pins that make them loud.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { bvhWalkLines, bvhPointWalkLines } from '../../src/components/accel/bvh/bvh.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

const glassBatchScene = (opts: { closedMesh?: boolean; medium?: boolean } = {}): SceneDescription => ({
    id: 'inst-containment',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { radius: 0.4 }, material: 'glass' },
            placements: [{ position: [0, 0.5, 0] }, { position: [1.2, 0.5, 0] }, { position: [-1.2, 0.5, 0.4] }],
            name: 'batch',
        },
        { type: 'sphere', parameters: { center: [0, 3, 0], radius: 0.2 }, material: 'lamp' },
    ] as never,
    materials: {
        floor: { model: 'lambert', albedo: 0.5 },
        glass: opts.medium ? { model: 'none', medium: { sigma_a: [0.5, 0.5, 0.5] } } : { model: 'dielectric', ior: 1.5 },
        lamp: { model: 'lambert', albedo: [0, 0, 0], emission: 12 },
    },
    lights: [],
});

const strategy: RenderStrategy = {
    id: 'inst-containment',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 6 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

function fragmentOf(scene: SceneDescription, st: RenderStrategy = strategy): string {
    const r = new Compiler().compile(scene, st);
    return [...r.shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment;
}
/** The body of a generated function, by its definition line. */
function bodyOf(frag: string, signature: string): string {
    const i = frag.indexOf(signature);
    expect(i, `missing ${signature}`).toBeGreaterThan(-1);
    return frag.slice(i, frag.indexOf('\n}', i));
}

describe('BVH point walk: the node layout is the RAY walk\'s (regression)', () => {
    it('descends left = ni + 1 and right = n1.w, exactly like bvhWalkLines', () => {
        // buildBVHCore stores B = n1.w = the RIGHT child and leaves the LEFT implicit at
        // nodeIdx + 1 ("left lands at nodeIdx + 1 (implicit — never stored)"). The point
        // walk read n1.w as the LEFT child and assumed the sibling sat at l + 1, so it
        // descended the right subtree twice and never visited the left one.
        //
        // Why nothing caught it: a missed containment is only observable where region
        // IDENTITY is read — ior_of, current_medium — and until instanced dielectrics the
        // point walk's only consumers were opaque tabled scenes, where a wrong region
        // changes no pixel. It rendered every glass instance in a left subtree as air.
        const point = bvhPointWalkLines(0, ['// leaf']).join('\n');
        const ray = bvhWalkLines(0, 'hit.t', ['// leaf']).join('\n');
        expect(point, 'point walk must take LEFT from ni + 1').toContain('int L = ni + 1');
        expect(point, 'point walk must take RIGHT from n1.w').toContain('R = int(n1.w)');
        // The pin that matters: both walks read the child indices the same way.
        const childExpr = (s: string) => /int L = ni \+ 1, R = int\(n1\.w\)|int L = ni \+ 1; int R = int\(n1\.w\)/.test(s);
        expect(childExpr(point) && childExpr(ray), 'ray and point walks must agree on the node layout').toBe(true);
        // ...and the point walk must NOT reconstruct a sibling by adjacency.
        expect(point).not.toContain('l + 1');
    });
});

describe('instanced containment: the region is real end to end', () => {
    it('an interior-claiming batch earns an ior_of ROW (regression: the η = 1 bug)', () => {
        // The containment arm answered correctly and the batch left the thin set, but the
        // baked ior table iterated objects + closed meshes only — batches were never in it
        // (they had never had interiors). ior_of returned 1.0 for the batch region, so
        // every glass instance refracted at η = 1: perfectly transparent, invisible.
        const ior = bodyOf(fragmentOf(glassBatchScene()), 'float ior_of(int region, vec3 p) {');
        expect(ior).toMatch(/if \(region == \d+\) return 1\.5;/);
    });

    it('the batch leaves the thin set, and its containment arm exists', () => {
        const frag = fragmentOf(glassBatchScene());
        const regionAt = bodyOf(frag, 'int scene_region_at(vec3 p) {');
        expect(regionAt, 'the containment arm must be emitted').toContain('— containment');
        expect(regionAt, 'params tier evaluates the field at p in WORLD space').toContain('sphere_sdf(p, shape)');
        // scene_region_thin must NOT list the batch region any more. (In this scene the
        // thin set empties out entirely, so the predicate may fold away — either way, the
        // batch must not be in it.)
        const batchRegion = /if \(region == (\d+)\) return 1\.5;/.exec(bodyOf(frag, 'float ior_of(int region, vec3 p) {'))![1];
        const thinAt = frag.indexOf('bool scene_region_thin(int region) {');
        if (thinAt >= 0) {
            expect(bodyOf(frag, 'bool scene_region_thin(int region) {')).not.toContain(`region == ${batchRegion}`);
        }
    });

    it('a MEDIUM-carrying batch claims an interior too (not just transmissive ones)', () => {
        // batchNeedsInterior is transmissive ∨ medium — current_medium tracking needs the
        // region just as much as ior_of does.
        const regionAt = bodyOf(fragmentOf(glassBatchScene({ medium: true })), 'int scene_region_at(vec3 p) {');
        expect(regionAt).toContain('— containment');
    });

    it('an OPAQUE batch emits no containment arm at all (exact linkage)', () => {
        const opaque = glassBatchScene();
        opaque.materials.glass = { model: 'lambert', albedo: 0.7 };
        const regionAt = bodyOf(fragmentOf(opaque), 'int scene_region_at(vec3 p) {');
        expect(regionAt).not.toContain('— containment');
    });
});

describe('russian roulette: the survival ceiling is authored (the unbiased cost knob)', () => {
    const withRR = (maxSurvival?: number): RenderStrategy => ({
        ...strategy,
        estimator: { ...strategy.estimator, russianRoulette: { startDepth: 3, ...(maxSurvival !== undefined ? { maxSurvival } : {}) } },
    });

    it('defaults to 0.95 and emits the authored value otherwise', () => {
        // The ONLY terminator for a lossless path — clear glass transmits at weight
        // exactly 1, so throughput never dims and survival pins at this ceiling. 0.95 is
        // ~20 further bounces on average; 0.7 is ~3. Both are exactly unbiased (survivors
        // are divided by the same probability), which is why this is the knob to reach for
        // instead of lowering maxBounces.
        const scene = glassBatchScene();
        expect(fragmentOf(scene, withRR())).toContain('#define RR_MAX_SURVIVAL 0.95');
        expect(fragmentOf(scene, withRR(0.7))).toContain('#define RR_MAX_SURVIVAL 0.7');
    });
});
