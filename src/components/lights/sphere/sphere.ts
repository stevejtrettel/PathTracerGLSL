// Sphere area-light descriptor — co-located with sphere.glsl (struct-alignment batch).
// Sampled via the visible cone; inside-the-sphere the sampler punts (deferred fallback).

import type { LightKindDescriptor } from '../../descriptors.js';
import { radiantScalar } from '../power.js';
import lightSphereGLSL from './sphere.glsl?raw';

export const sphereLightDescriptor: LightKindDescriptor = {
    kind: 'sphere',
    glsl: lightSphereGLSL,
    delta: false,
    // Authored input (besides kind/emission): authored `position` maps to the registry
    // row `center` in toValues — the proof the authored language needs its own schema.
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true, kind: 'point' },
        { name: 'radius', shape: 'number', required: true, kind: 'length', constraint: { kind: 'positive' } },
    ],
    params: [
        { name: 'center', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'radius', shape: 'number', semantic: 'geometric', kind: 'length' },
        { name: 'radiance', shape: 'vec3', semantic: 'radiometric' },   // Le, precomputed product
    ],
    // pbrt PowerLightSampler: π·4πr²·Le.
    power(v) {
        const r = v.radius as number;
        return Math.max(1e-8, Math.PI * 4 * Math.PI * r * r * radiantScalar(v.radiance as number[]));
    },
    // Desugar (A3): authored 'position' becomes the struct/primitive 'center'.
    toValues: (a, product) => ({ center: a.position as number[], radius: a.radius as number, radiance: product }),
    region: {
        primitive: 'sphere',
        parameters: (a) => ({ center: a.position as number[], radius: a.radius as number }),
    },
    valuesFromRegion: (p, Le) => ({ center: p.center, radius: p.radius, radiance: Le }),
    // No validateAuthored: every rule is separable and lives on the rows (D1).
};
