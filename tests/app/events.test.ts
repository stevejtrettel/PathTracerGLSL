// E4: shouldResetAccumulation is the metadata-less FALLBACK only (compiled
// ParameterMetadata.triggersReset wins in App._triggersReset). ONE prefix vocabulary —
// the compiler's reserved prefixes — replaced the app's drifted private list.

import { describe, it, expect } from 'vitest';
import { shouldResetAccumulation } from '../../src/app/events.js';

describe('shouldResetAccumulation (fallback heuristic)', () => {
    it('resets for scene-affecting paths (camera, object-named params)', () => {
        expect(shouldResetAccumulation('camera.position')).toBe(true);
        expect(shouldResetAccumulation('lamp.emission')).toBe(true);
        expect(shouldResetAccumulation('fog.gain')).toBe(true);
    });

    it('does NOT reset for developer surfaces (debug./renderer.)', () => {
        expect(shouldResetAccumulation('debug.displayMode')).toBe(false);
        expect(shouldResetAccumulation('renderer.overlay')).toBe(false);
    });

    it('does NOT reset for compiler-owned plumbing (engine./env. load-time data)', () => {
        // env.size/env.totalWeight arrive on HDR load with no metadata — the old private
        // list warned "unknown prefix" on every environment scene. Slider-style env params
        // (env.intensity/rotation) reset via their compiled triggersReset metadata instead.
        expect(shouldResetAccumulation('env.size')).toBe(false);
        expect(shouldResetAccumulation('engine.sampleCount')).toBe(false);
    });
});
