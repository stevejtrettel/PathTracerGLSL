// Lambert descriptor — co-located with lambert.glsl (module-anatomy §2: a model is one
// GLSL file + one descriptor; the pair moves together).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import lambertGLSL from './lambert.glsl?raw';

const body = { origin: 'components/materials/lambert/lambert.glsl', source: lambertGLSL };

export const lambertDescriptor: MaterialModelDescriptor = {
    id: 'lambert',
    // One file, checked in every space it lists: it is written against the ambient seam alone.
    glsl: { euclidean: body, hyperbolic: body, spherical: body, h2xr: body },
    // Fields read (matches lambert.glsl's header): albedo, emission.
    properties: [
        { name: 'albedo', glslType: 'Spectrum', role: 'reflectance', source: 'albedo', default: 0.8, storage: 'field' },
        { name: 'emission', glslType: 'Spectrum', role: 'emission', source: 'emission', default: 0, storage: 'field' },
    ],
    albedo: { row: 'albedo' },   // the diffuse color
    capabilities: {
        nonDeltaLobes: true,
        transmission: false,
        support: 'hemisphere',   // opaque diffuse: nothing arrives from below the normal
        emissive: true,
    },
};
