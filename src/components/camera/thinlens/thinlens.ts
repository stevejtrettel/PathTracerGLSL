// Thin-lens camera descriptor. Model-unique params: aperture (lens radius) and
// focusDistance, both live sliders that trigger accumulation reset (they change the
// INTEGRAL — defocus is measurement, §6.2). fov is shared plumbing (handled by the
// feature). The pupil's shape is structural: without `blades` it is the disk; with
// `blades: n` it is the regular n-gon of circumradius `aperture` (an iris of n straight
// blades), with a vertex at `bladeRotation` radians from camera right toward camera up
// (0 when not authored). Both are compile-time defines. See thinlens.md for the math.

import type { CameraModelDescriptor, CameraControl } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import { formatFloat } from '../../glsl-format.js';
import thinlensGLSL from './thinlens.glsl?raw';

export const thinlensDescriptor: CameraModelDescriptor = {
    type: 'thinlens',
    glsl: thinlensGLSL,
    authoredParams: [
        { name: 'fov', shape: 'value-number', required: true, constraint: { kind: 'interval', min: 0, max: Math.PI } },   // RADIANS, full vertical angle: tan(fov/2) must exist — a degree value (45) is caught here
        { name: 'aperture', shape: 'number', required: true, constraint: { kind: 'nonnegative' } },   // 0 ≡ pinhole (the witness anchor)
        { name: 'focusDistance', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'blades', shape: 'number', required: false },          // integer ≥ 3 (validateAuthored); absent = the disk
        { name: 'bladeRotation', shape: 'number', required: false },   // radians; a disk is unchanged by it
    ],
    validateAuthored(cam) {
        const blades = cam.blades as number | undefined;
        return blades === undefined || (Number.isInteger(blades) && blades >= 3)
            ? []
            : [`blades must be an integer ≥ 3 (the number of straight sides of the pupil; got ${blades})`];
    },
    controls(cam: CameraDesc): CameraControl[] {
        if (cam.type !== 'thinlens') throw new Error('thinlens descriptor got a non-thinlens camera');
        // Both read RAW by the shader (pass-through) — no derivation.
        return [
            { path: 'camera.aperture', uniform: 'u_aperture', name: 'Aperture', default: cam.aperture as number, range: [0, 1] },
            { path: 'camera.focusDistance', uniform: 'u_focusDistance', name: 'Focus Distance', default: cam.focusDistance as number, range: [0.1, 50] },
        ];
    },
    defines(cam: CameraDesc): Record<string, string> {
        if (cam.type !== 'thinlens') throw new Error('thinlens descriptor got a non-thinlens camera');
        if (cam.blades === undefined) return {};
        return {
            LENS_BLADES: formatFloat(cam.blades as number),
            LENS_BLADE_ROTATION: formatFloat((cam.bladeRotation as number | undefined) ?? 0),
        };
    },
};
