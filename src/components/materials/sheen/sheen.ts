// Sheen descriptor, co-located with sheen.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import sheenGLSL from './sheen.glsl?raw';

export const sheenDescriptor: MaterialModelDescriptor = {
    id: 'sheen',
    glsl: { euclidean: { origin: 'components/materials/sheen/sheen.glsl', source: sheenGLSL } },
    // Fields read (matches sheen.glsl's header): albedo, sheen_color, sheen_weight, and the
    // derived sheen_r.
    properties: [
        // ρ, the Lambertian base under the fuzz.
        { name: 'albedo', glslType: 'Spectrum', role: 'reflectance', source: 'albedo', default: 0.8, storage: 'field' },
        // c, the fuzz color (OpenPBR fuzz_color).
        { name: 'sheen_color', glslType: 'Spectrum', role: 'reflectance', source: 'sheen_color', default: 1, storage: 'field' },
        // W, the fuzz coverage (OpenPBR fuzz_weight); W = 0 is Lambert.
        { name: 'sheen_weight', glslType: 'float', source: 'sheen_weight', default: 1, storage: 'field',
            constraint: { kind: 'closed-interval', min: 0, max: 1 } },
        // OpenPBR fuzz_roughness.
        { name: 'sheen_roughness', glslType: 'float', source: 'sheen_roughness', default: 0.5, storage: 'field',
            constraint: { kind: 'closed-interval', min: 0, max: 1 } },
    ],
    // The roughness the fits read, clamped to their range [0.01, 1] (MaterialX's clamp).
    derived: [{
        name: 'sheen_r', glslType: 'float', inputs: ['sheen_roughness'],
        fn: (v) => Math.min(Math.max(v.sheen_roughness as number, 0.01), 1),
        glsl: ({ sheen_roughness: r }) => `clamp(${r}, 0.01, 1.0)`,
    }],
    // The frame maps of glsl/core/microfacet.glsl; no microfacet distribution, no energy gain.
    microfacet: { energy: 'none' },
    albedo: { row: 'albedo' },   // the base's diffuse color
    capabilities: {
        nonDeltaLobes: true,
        transmission: false,
        support: 'hemisphere',   // opaque: nothing arrives from below the normal
        emissive: false,         // sheen_emission ≡ 0
    },
};
