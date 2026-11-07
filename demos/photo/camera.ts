// demos/photo/camera.ts — the shared render recipe of the photo scenes: a full-frame camera
// described by its lens, and a strategy that keeps the image close to ground truth.
//
// The sensor is 36 × 24 mm (3:2); render the scenes at a 3:2 size (1280 × 853 by default) so the
// horizontal field is the lens's. Scenes are modeled in meters.

import type { RenderStrategy, Vec3 } from '../../src/compiler/types.js';
import { thinLensFromPhoto } from '../../src/authoring/photoLens.js';

export interface PhotoShot {
    id: string;
    /** Lens focal length (mm), f-number, and the distance in focus (m, from the lens). */
    focalLengthMm: number;
    fNumber: number;
    focusDistance: number;
    /** Iris blades; the out-of-focus highlights take this polygon's shape. */
    blades: number;
    position: Vec3;
    target: Vec3;
    /** Display: exposure scale and the white balance (K) the picture is balanced to. */
    exposure: number;
    whiteBalance?: number;
    maxBounces?: number;
}

/**
 * The strategy for one shot: thin lens from the photographic lens, a Gaussian pixel filter,
 * energy-compensated microfacets, MIS, and the AgX filmic curve. `maxBounces` defaults to 16,
 * deep enough that glass and interreflections are not visibly truncated.
 */
export function photoStrategy(shot: PhotoShot): RenderStrategy {
    const lens = thinLensFromPhoto({
        focalLengthMm: shot.focalLengthMm,
        fNumber: shot.fNumber,
        focusDistance: shot.focusDistance,
        sensorHeightMm: 24,
        metersPerUnit: 1,
    });
    return {
        id: shot.id,
        measurement: {
            camera: { ...lens, blades: shot.blades, bladeRotation: 0.2, position: shot.position, target: shot.target },
            maxBounces: shot.maxBounces ?? 16,
            pixel: 'gaussian',
            microfacet: 'energy-compensated',
        },
        estimator: {
            directLighting: 'mis',
            russianRoulette: { startDepth: 6 },
            meshTraversal: 'bvh',
            accumulation: { type: 'average' },
        },
        view: {
            tonemap: {
                type: 'agx',
                exposure: shot.exposure,
                ...(shot.whiteBalance !== undefined ? { whiteBalance: shot.whiteBalance } : {}),
            },
        },
    };
}

/** The distance from the camera position to a point (for focusing on it). */
export function distance(a: Vec3, b: Vec3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
