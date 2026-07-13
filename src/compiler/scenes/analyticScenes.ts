// compiler/scenes/analyticScenes.ts
// Demo scene exercising the combined scene_intersect dispatcher — see
// docs/impl-plan-analytic-backend.md. The analytic twin fixture (analytic-minimal)
// lives in src/witnesses/scenes/analyticMinimal.ts; this demo borrows its strategy.

import type { SceneDescription } from '../types.js';
import { analyticStrategy } from '../../witnesses/scenes/analyticMinimal.js';

export { analyticStrategy };

// Both backends in ONE scene: an analytic floor with an SDF sphere and an analytic sphere on it,
// lit by a point light. Proves the dispatcher combines backends (nearest-hit across them) and that
// scene_intersect_any casts shadows ACROSS backends — the analytic floor receives shadows from both
// the SDF sphere and the analytic sphere.
export const mixedScene: SceneDescription = {
    id: 'mixed',
    name: 'Mixed backends (analytic floor + SDF & analytic spheres)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'analytic', shape: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'ground' },
        { kind: 'sdf', sdf: { type: 'sphere', parameters: { center: [-1.2, 0, 0], radius: 1.0 } }, material: 'red' },
        { kind: 'analytic', shape: { type: 'sphere', parameters: { center: [1.2, 0, 0], radius: 1.0 } }, material: 'blue' },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        red: { model: 'lambert', albedo: [0.9, 0.2, 0.2] },   // SDF sphere
        blue: { model: 'lambert', albedo: [0.2, 0.3, 0.9] },  // analytic sphere
    },
    lights: [{ kind: 'point', position: [2, 5, 3], intensity: 40.0, color: [1.0, 1.0, 1.0] }],
    environment: { type: 'constant', color: [0.08, 0.12, 0.2], intensity: 1.0 },
};
