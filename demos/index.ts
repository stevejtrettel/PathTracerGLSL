// demos/index.ts — the DEMO registry: replaceable scenes made while testing and
// building. Churn freely — nothing outside this folder depends on any entry here.
// The durable GPU tests live in tests/witnesses/ (demos may borrow witness fixtures,
// never the reverse), and pages/registry.ts merges both suites into the view the
// gallery and lab render.

import type { SceneSuiteEntry } from '../tests/witnesses/types.js';
import type { RenderStrategy } from '../src/compiler/types.js';
import { cornellBox, cornellStrategy } from '../tests/witnesses/scenes/cornellBox.js';
import { cornellThinlensStrategy, cornellEquirectStrategy, cornellOrthoStrategy, cornellCylindricalStrategy, fisheyeStrategy } from './cameraScenes.js';
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
import { skyScene as tonemapScene, tonemapStrategies } from './tonemapScenes.js';

// Non-accumulating (oneshot) tracer — each frame is the current sample, live & noisy (no
// convergence). Same scene/camera as `cornell`, only the accumulation occupant differs.
const cornellOneshotStrategy: RenderStrategy = {
    id: 'oneshot',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 8 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'oneshot' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const demoSuite: Record<string, SceneSuiteEntry> = {
    // One scene, the whole camera family on keys 1-4 (all differ ONLY by camera — the
    // measurement axis). 1 pinhole · 2 thin-lens (defocus) · 3 orthographic · 4 equirect.
    // Shared pose frames the box for 1-3; equirect (4) renders a valid 360 pano from it.
    cornell: {
        scene: cornellBox,
        strategies: [cornellStrategy, cornellThinlensStrategy, cornellOrthoStrategy, cornellEquirectStrategy, fisheyeStrategy('equidistant'), cornellCylindricalStrategy],
        exercises: 'the camera family on one scene (keys 1-6): pinhole · thin-lens (aperture/focusDistance) · orthographic (parallel) · equirect (360) · fisheye (equidistant) · cylindrical (240° panorama). Each is a measurement change — they do NOT converge to each other. Also: region disambiguation (5 walls → 1 material), {param} albedo/fov',
        expected: '1 perspective · 2 defocus blur (aperture>0; 0 ≡ pinhole) · 3 no perspective convergence (parallel walls) · 4 full-sphere panorama · 5 circular 180° fisheye · 6 wide cylindrical panorama (straight verticals)',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'cornell-fisheye': {
        scene: cornellBox,
        strategies: [fisheyeStrategy('equidistant'), fisheyeStrategy('equisolid'), fisheyeStrategy('stereographic'), fisheyeStrategy('orthographic')],
        exercises: 'the four fisheye sub-projections (keys 1-4) — same occupant, one radial map θ(ρ) each, compiler-selected: equidistant · equisolid · stereographic · orthographic. 180° fov',
        expected: 'same scene, four radial distortions: 1 angle-linear · 2 solid-angle-true (edges compressed) · 3 conformal (shapes preserved, "little planet") · 4 hemisphere-flat (heaviest edge compression)',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    'cornell-oneshot': {
        scene: cornellBox,
        strategies: [cornellOneshotStrategy],
        exercises: 'non-accumulating (oneshot) accumulation occupant — writes the current sample each frame, no history blend; reuses the average pipeline (never reads u_previous)',
        expected: 'a live, noisy image that does NOT converge (grain animates every frame); contrast the accumulating cornell card which cleans up over time',
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
    tonemap: {
        scene: tonemapScene,
        strategies: tonemapStrategies,
        exercises:
            'DEMO — the tonemap roster on one scene (keys 1-7): agx · aces · khronos · reinhard · hable · gt · none. A matte + a glass ball under an outdoor HDRI sky. Every strategy shares the IDENTICAL linear HDR estimate — only view.tonemap differs, so this isolates the display transfer (the bright sun is what pulls the curves apart)',
        expected:
            'same scene, different highlight roll-off + hue: 1 agx (neutral, highlights desaturate to white) · 2 aces (filmic, slight hue skew on saturated hues) · 3 khronos (material-neutral, low contrast) · 4 reinhard (soft, washes highlights) · 5 hable (contrasty filmic) · 6 gt (linear midsection) · 7 none (raw linear — sky/sun CLIP to white, showing why tonemapping is needed)',
        initialParameters: {
            'camera.position': [0, 1.3, 5],
            'camera.target': [0.4, 0.8, 0],
            'camera.fov': 0.9,
        },
    },
};
