// Rayleigh scattering-model descriptor — co-located with rayleigh.glsl. Grayscale and
// parameter-free: the λ⁻⁴ color is the medium's σ_s, not the phase, so it declares no
// fields into MediumProperties (unlike hg's phase_g).

import type { VolumeScatteringModelDescriptor } from '../../descriptors.js';
import rayleighGLSL from './rayleigh.glsl?raw';

export const rayleighDescriptor: VolumeScatteringModelDescriptor = {
    id: 'rayleigh',
    glsl: rayleighGLSL,
    properties: [],
};
