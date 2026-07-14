// demos/tonemapScenes.ts — the tonemapper comparison demo.
// One scene (a matte clay ball + a glass ball on a ground plane under an outdoor HDRI
// sky), the whole tonemap roster on number keys 1-7. Every strategy is IDENTICAL except
// view.tonemap.type — a pure VIEW change, so all seven share the same converged linear
// HDR estimate and differ only in how it is shown. The puresky HDRI has a bright sun,
// which is exactly what pulls the tonemappers apart (highlight roll-off + hue handling).

import type { RenderStrategy } from '../src/compiler/types.js';
import { skyScene } from '../tests/witnesses/scenes/envScenes.js';

export { skyScene };

// Keys 1-7. Ordered recommended-first: key 1 (agx) is the modern neutral default and
// looks good immediately; key 7 (none) is the raw-linear baseline where the sky/sun clip
// to white — showing WHY a tonemapper is needed.
const TONEMAPS = ['agx', 'aces', 'khronos', 'reinhard', 'hable', 'gt', 'none'] as const;

const baseStrategy: RenderStrategy = {
    id: 'agx',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.5 } },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'mis',            // the sky env is samplable → cleanest estimate
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

export const tonemapStrategies: RenderStrategy[] = TONEMAPS.map((type) => ({
    ...baseStrategy,
    id: type,
    view: { tonemap: { type } },
}));
