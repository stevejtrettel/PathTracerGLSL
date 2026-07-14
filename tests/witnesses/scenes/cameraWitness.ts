// Camera-model witnesses. The thin-lens correctness anchor: at aperture = 0 the lens
// disk collapses to a point, so thin-lens must reproduce the pinhole image EXACTLY. The
// film draws xiLens for both cameras (pinhole ignores it), so the two arms stay on the
// SAME RNG stream — only the extra normalize(dir·k) round-trip in thin-lens differs, in
// the last fp bits. That makes this a tight identical-stream equality (display-space
// RMSE gate, per witness types), not a statistical convergence.
//
// Reuses the cornellBox fixture (real depth: walls + tall block) so a real image, not a
// flat field, is compared.

import type { RenderStrategy } from '../../../src/compiler/types.js';
import { cornellBox } from './cornellBox.js';

export { cornellBox };

const base = {
    id: 'pathtracer',
    estimator: {
        directLighting: 'nee' as const,
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' as const },
    },
    view: { tonemap: { type: 'reinhard' as const } },
};

/** Pinhole reference (strategy 0). */
export const camPinholeStrategy: RenderStrategy = {
    ...base,
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 10 },
};

/** Thin-lens at aperture 0 (strategy 1) — must equal the pinhole arm. */
export const camThinlensZeroStrategy: RenderStrategy = {
    ...base,
    id: 'thinlens0',
    measurement: { camera: { type: 'thinlens', fov: 0.8, aperture: 0, focusDistance: 4 }, maxBounces: 10 },
};
