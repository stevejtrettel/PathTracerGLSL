// HG–Draine approximate-Mie descriptor — co-located with draine.glsl. Reads ONE field,
// mp.draine_d (water-droplet diameter in µm); the four internal lobe parameters
// (g_HG, g_D, α, w_D) are fitted functions of d evaluated in-shader (Jendersie & d'Eon 2023).

import type { PhaseModelDescriptor } from '../../descriptors.js';
import draineGLSL from './draine.glsl?raw';

export const draineDescriptor: PhaseModelDescriptor = {
    id: 'draine',
    glsl: draineGLSL,
    properties: [
        { name: 'draine_d', glslType: 'float', semantic: 'geometric', source: 'draine_d', default: 10, storage: 'field' },
    ],
};
