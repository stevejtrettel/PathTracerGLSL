// Checker descriptor — co-located with checker.glsl. The first Hit.uv reader: a real
// procedural material through the finished materials door (one folder + one registry
// line — impl-plan-blackbody-uv).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import checkerGLSL from './checker.glsl?raw';

export const checkerDescriptor: MaterialModelDescriptor = {
    id: 'checker',
    glsl: checkerGLSL,
    // Fields read (matches checker.glsl's header): the two cell albedos + the uv tiling
    // scale (cells per uv unit — remember uv itself is the placeholder planar chart).
    properties: [
        { name: 'albedo_a', glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo_a', default: 0.9, storage: 'field' },
        { name: 'albedo_b', glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo_b', default: 0.1, storage: 'field' },
        { name: 'uv_scale', glslType: 'float', semantic: 'geometric', source: 'uv_scale', default: 8, storage: 'field', constraint: { kind: 'positive' } },
    ],
    capabilities: {
        nonDeltaLobes: true,
        transmission: false,
        emissive: false,
        readsUv: true,   // the procedural chart reader (fable-imagery P1) → keeps its frame under rotation (P1b)
    },
};
