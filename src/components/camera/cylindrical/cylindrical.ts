// Cylindrical panorama camera descriptor. One live param in DEGREES (the GLSL converts with
// radians()): hfov = horizontal sweep (the panorama width, up to 360°). The vertical field
// follows the window aspect at square pixels (see cylindrical.md) — no vfov dial, so the
// render is perspectivally correct at any window size.

import type { CameraModelDescriptor, CameraControl, CameraDerived } from '../index.js';
import type { CameraDesc } from '../../../compiler/plan/types.js';
import cylindricalGLSL from './cylindrical.glsl?raw';

const HFOV_PATH = 'camera.cylHfov';

export const cylindricalDescriptor: CameraModelDescriptor = {
    type: 'cylindrical',
    glsl: cylindricalGLSL,
    authoredParams: [
        { name: 'hfov', shape: 'number', required: true, constraint: { kind: 'positive' } },   // horizontal sweep, DEGREES
    ],
    controls(cam: CameraDesc): CameraControl[] {
        if (cam.type !== 'cylindrical') throw new Error('cylindrical descriptor got a non-cylindrical camera');
        // Feeds u_cylFocal only (not read raw) — the horizontal sweep in DEGREES.
        return [{ path: HFOV_PATH, name: 'Width (°)', default: cam.hfov as number, range: [30, 360] }];
    },
    derived(cam: CameraDesc): CameraDerived[] {
        if (cam.type !== 'cylindrical') throw new Error('cylindrical descriptor got a non-cylindrical camera');
        // u_cylFocal = cylinder radius in pixels = imageSize.x / radians(hfov). Precomputed on
        // the CPU (was recomputed per ray). engine.imageSize may be absent at plan time — the
        // fn falls back to a 1px width for a stable default; the per-frame value uses the real size.
        return [{
            uniform: 'u_cylFocal', type: 'float', inputs: [HFOV_PATH, 'engine.imageSize'],
            fn: (v) => {
                const hfov = (v[HFOV_PATH] as number) ?? cam.hfov;
                const size = v['engine.imageSize'] as number[] | undefined;
                const width = size ? size[0] : 1.0;
                return width / Math.max((hfov * Math.PI) / 180, 1e-6);
            },
        }];
    },
};
