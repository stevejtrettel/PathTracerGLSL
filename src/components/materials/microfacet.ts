// The GGX roughness parameter of every microfacet material model (the `a` of
// glsl/core/microfacet.glsl): α = max(1e-3, roughness²), declared once so the models that
// read mp.alpha agree on it. The floor is the convention for all of them: α → 0 produces
// fireflies, not a mirror, so a true mirror or smooth glass is authored as a delta model.

import type { MaterialDerivedSpec } from '../descriptors.js';

export const microfacetAlpha: MaterialDerivedSpec = {
    name: 'alpha', glslType: 'float', inputs: ['roughness'],
    fn: (v) => Math.max(1e-3, (v.roughness as number) * (v.roughness as number)),
    glsl: ({ roughness: r }) => `max(1e-3, ${r} * ${r})`,
};
