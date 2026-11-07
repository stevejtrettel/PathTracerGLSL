// Plastic descriptor, co-located with plastic.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import plasticGLSL from './plastic.glsl?raw';

/** dielectric_fresnel (glsl/core/math.glsl): eta = n_i/n_t, cos_i ≥ 0; 1 under total
 *  internal reflection. */
function dielectricFresnel(cosI: number, eta: number): number {
    const sin2t = eta * eta * (1 - cosI * cosI);
    if (sin2t >= 1) return 1;
    const cosT = Math.sqrt(1 - sin2t);
    const rPar = (cosI - eta * cosT) / (cosI + eta * cosT);
    const rPerp = (eta * cosI - cosT) / (eta * cosI + cosT);
    return 0.5 * (rPar * rPar + rPerp * rPerp);
}

/** D(η) = ∫₀¹ F(μ; η)·2μ dμ, the Fresnel reflectance of an interface (eta = n_i/n_t) for
 *  cosine-distributed incident light. For η > 1, F = 1 below the critical cosine
 *  μc = √(1 − 1/η²), which contributes μc² exactly; above it F has a square-root kink at μc,
 *  which the substitution μ = μc + (1 − μc)s² makes smooth for composite Simpson. Accurate
 *  to ~1e-15, checked against the identity 1 − D(η) = (1 − D(1/η))/η² in plastic.test.ts. */
export function diffuseFresnelReflectance(eta: number): number {
    const mc = eta > 1 ? Math.sqrt(1 - 1 / (eta * eta)) : 0;
    const n = 20000, h = 1 / n;
    const g = (s: number) => {
        const mu = mc + (1 - mc) * s * s;
        return dielectricFresnel(mu, eta) * 2 * mu * (1 - mc) * 2 * s;
    };
    let sum = g(0) + g(1);
    for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * g(i * h);
    return mc * mc + sum * h / 3;
}

export const plasticDescriptor: MaterialModelDescriptor = {
    id: 'plastic',
    glsl: plasticGLSL,
    // Fields read (matches plastic.glsl's header): albedo, coat_eta, and the derived coat_fdr.
    properties: [
        // [0, 1] in both color models: the base's bounce series R/(1 − R·K) has a pole at
        // R = 1/K (1.68 for η = 1.5) and is negative beyond it.
        { name: 'albedo', glslType: 'Spectrum', role: 'reflectance', source: 'albedo', default: 0.8, storage: 'field',
            constraint: { kind: 'closed-interval', min: 0, max: 1 } },
        // η, the coat's index relative to the medium outside the object (Mitsuba's int_ior/ext_ior):
        // an object in water with a 1.5 coat takes 1.5/1.33. Not read from the region table.
        { name: 'coat_eta', glslType: 'float', source: 'coat_eta', default: 1.5, storage: 'field',
            constraint: { kind: 'positive' } },
    ],
    // K, the coat's internal diffuse reflectance: light inside the coat meets the interface
    // with n_i/n_t = η, so K = D(η). Computed once per material on the host.
    derived: [{
        name: 'coat_fdr', glslType: 'float', inputs: ['coat_eta'],
        fn: (v) => diffuseFresnelReflectance(v.coat_eta as number),
    }],
    albedo: { row: 'albedo' },   // the base's diffuse color
    capabilities: {
        nonDeltaLobes: true,     // the diffuse lobe: NEE samples it; the coat's mirror lobe is delta per sample
        transmission: false,
        support: 'hemisphere',   // opaque: nothing arrives from below the normal
        emissive: false,         // plastic_emission ≡ 0
    },
};
