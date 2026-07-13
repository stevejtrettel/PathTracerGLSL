// demos/index.ts — the DEMO registry: replaceable scenes made while testing and
// building. Churn freely — nothing outside this folder depends on any entry here.
// The durable GPU tests live in tests/witnesses/ (demos may borrow witness fixtures,
// never the reverse), and pages/registry.ts merges both suites into the view the
// gallery and lab render.

import type { SceneSuiteEntry } from '../tests/witnesses/types.js';
import { cornellBox, cornellStrategy } from '../tests/witnesses/scenes/cornellBox.js';
import { mixedScene, analyticStrategy } from './analyticScenes.js';
import { submergedScene, submergedStrategy } from './dielectricScenes.js';
import { fogcubeScene, fogcubeStrategy } from './mediaScenes.js';
import {
    marbleScene,
    marbleStrategy,
    marbleNoScatterStrategy,
    mistScene,
    mistStrategy,
} from './demoScenes.js';

export const demoSuite: Record<string, SceneSuiteEntry> = {
    cornell: {
        scene: cornellBox,
        strategies: [cornellStrategy],
        exercises: 'region disambiguation (5 white walls → 1 material); {param} albedo; fov uniform',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    mixed: {
        scene: mixedScene,
        strategies: [analyticStrategy],
        exercises: 'combined scene_intersect (SDF + analytic in one scene); cross-backend shadows',
        expected: 'both spheres cast shadows on the analytic floor; no backend-dependent artifacts',
        initialParameters: {
            'camera.position': [0, 1.5, 6],
            'camera.target': [0, 0, 0],
        },
    },
    submerged: {
        scene: submergedScene,
        strategies: [submergedStrategy],
        exercises:
            'R-SUBMERGED innermost-wins witness (validation §5): sphere entry must classify region_from = water (η = 1.33/1.5); under deepest-wins the sphere is invisible',
        expected: 'the sphere VISIBLY distorts the checker with a Fresnel ring (invisible ⇒ classification bug); distortion is mild — relative η ≈ 1.13',
        initialParameters: {
            'camera.position': [0, 0, 2],
            'camera.target': [0, 0, 0],
        },
    },
    fogcube: {
        scene: fogcubeScene,
        strategies: [fogcubeStrategy],
        exercises:
            'R-FOGCUBE null-interface rim witness (validation §5, absorbing variant): a bounded absorber over an emissive checker',
        expected:
            'the cube dims the checker behind it with NO bright rim at the silhouette (a Fresnel-like edge = the null interface leaked a BSDF); grazing edges fade smoothly',
        initialParameters: {
            'camera.position': [0, 1.6, 3],
            'camera.target': [0, 0.9, 0],
        },
    },
    marble: {
        scene: marbleScene,
        strategies: [marbleStrategy, marbleNoScatterStrategy],
        exercises:
            'DEMO — dielectric surface + scattering interior composed in ONE material, lit by an emissive panel (point lights cannot NEE-light a glass shell, §6.3); {param} smoke color + g; key 2 = volumeIntegrator none (scattering off)',
        expected:
            'a glowing storm-cloud core inside the glass, Fresnel rim from the panel below, dark moody surround; key 2 collapses the interior to clear tinted glass — the difference IS the volume integrator',
        initialParameters: {
            'camera.position': [0.4, 1.15, 3.2],
            'camera.target': [0, 0.55, 0],
        },
    },
    mist: {
        scene: mistScene,
        strategies: [mistStrategy],
        exercises:
            'DEMO — bounded ground-fog layer (null interfaces at world scale), camera INSIDE the volume (classification-init, §4.4), medium NEE shafts from a warm sun, aerial perspective; {param} mist.density',
        expected:
            'warm crepuscular shadow-lanes between backlit stones, far monoliths fading into the haze, cool clear sky above the fog layer; expect halo spike-noise near the sun direction (equiangular is deferred)',
        initialParameters: {
            'camera.position': [0, 1.7, 6],
            'camera.target': [0, 1.6, -8],
        },
    },
};
