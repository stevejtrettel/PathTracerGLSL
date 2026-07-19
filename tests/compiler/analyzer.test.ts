// The scene census, SLIMMED to its consumers (compiler-pass C4): every field asserted
// here has a real Validator/Planner reader — the old backend counts / per-model flags /
// heterogeneous mirror died with their zero readers.

import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import type { SceneDescription } from '../../src/compiler/types.js';

function scene(partial: Partial<SceneDescription>): SceneDescription {
    return {
        id: 's',
        ambientSpace: { type: 'euclidean' },
        objects: [],
        materials: {},
        lights: [],
        ...partial,
    };
}

describe('analyze — geometry', () => {
    it('flags meshes (Validator-rejected until the BVH backend); empty scene → false', () => {
        expect(analyze(scene({
            objects: [
                { type: 'sphere', parameters: {}, material: 'm' },
                { kind: 'mesh', data: new Float32Array(0), material: 'm' },
            ],
        })).geometry.hasMeshes).toBe(true);
        expect(analyze(scene({})).geometry.hasMeshes).toBe(false);
    });
});

describe('analyze — lighting (authoring-intent count)', () => {
    it('counts every AUTHORED light, registered kind or not (a kind rejection must not stack a misleading no-lights error)', () => {
        const f = analyze(scene({
            lights: [
                { kind: 'point', position: [0, 0, 0], emission: 1 },
                { kind: 'quad', corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 1 },
                { kind: 'directional', direction: [0, -1, 0], emission: 1 },   // reserved: no occupant
            ],
        }));
        expect(f.lighting.totalLightCount).toBe(3);
    });

    it('counts sampleAsLight emitter OBJECTS (analytic samplable primitive + constant nonzero emission)', () => {
        const f = analyze(scene({
            objects: [{ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'lamp' }],
            materials: { lamp: { model: 'lambert', albedo: [0, 0, 0], emission: [5, 5, 5] } },
        }));
        expect(f.lighting.totalLightCount).toBe(1);
    });

    it('a {param}-driven emission object does NOT count (v1: power must bake into the CDF)', () => {
        const f = analyze(scene({
            objects: [{ type: 'quad', parameters: { corner: [0, 0, 0], edge1: [1, 0, 0], edge2: [0, 0, 1] }, material: 'lamp' }],
            materials: { lamp: { model: 'lambert', albedo: [0, 0, 0], emission: { param: 'lamp.power', default: 5 } } },
        }));
        expect(f.lighting.totalLightCount).toBe(0);
    });
});

describe('analyze — media', () => {
    it('census flags: media / scattering / emissive / null interfaces', () => {
        const f = analyze(scene({
            materials: {
                fog: { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], sigma_s: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] } },
            },
        }));
        expect(f.media.hasMedia).toBe(true);
        expect(f.media.hasScatteringMedia).toBe(true);
        expect(f.media.hasEmissiveMedia).toBe(true);
        expect(f.media.hasNullInterfaces).toBe(true);
    });

    it('ambientMedium alone flags hasMedia', () => {
        expect(analyze(scene({ ambientMedium: 'fog' })).media.hasMedia).toBe(true);
    });
});

describe('analyze — environment as a light (D6)', () => {
    it('image env samplable by default; constant env is opt-in', () => {
        expect(analyze(scene({ environment: { type: 'image', url: 'x.hdr' } })).environment.samplable).toBe(true);
        expect(analyze(scene({ environment: { type: 'constant', color: [1, 1, 1] } })).environment.samplable).toBe(false);
        expect(analyze(scene({ environment: { type: 'constant', color: [1, 1, 1], sampleAsLight: true } })).environment.samplable).toBe(true);
    });
});

describe('analyze — ambient space', () => {
    it('passes the ambient space type through', () => {
        expect(analyze(scene({ ambientSpace: { type: 'hyperbolic' } })).ambientSpace).toBe('hyperbolic');
    });
});
