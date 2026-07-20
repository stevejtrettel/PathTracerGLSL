// demos/index.ts — the DEMO registry: replaceable scenes made while testing and
// building. Churn freely — nothing outside this folder depends on any entry here.
// The durable GPU tests live in tests/witnesses/ (demos may borrow witness fixtures,
// never the reverse), and pages/registry.ts merges both suites into the view the
// gallery and lab render.

import type { SceneSuiteEntry } from '../tests/witnesses/types.js';
import type { RenderStrategy, Vec3 } from '../src/compiler/types.js';
import { withPose } from '../src/authoring/strategy.js';
import { cornellBox, cornellStrategy } from '../tests/witnesses/scenes/cornellBox.js';
import { cornellThinlensStrategy, cornellEquirectStrategy, cornellOrthoStrategy, cornellCylindricalStrategy, fisheyeStrategy } from './cameraScenes.js';
import { mixedScene, analyticStrategy } from './analyticScenes.js';
import { submergedScene, submergedStrategy } from './dielectricScenes.js';
import { fogcubeScene, fogcubeStrategy, rayleighScene, rayleighStrategy, groundfogScene, groundfogStrategy, fogblobsScene, fogblobsStrategy, glowblobsScene, glowblobsStrategy, glowblobsPtStrategy } from './mediaScenes.js';
import {
    marbleScene,
    marbleStrategy,
    marbleNoScatterStrategy,
    mistScene,
    mistStrategy,
} from './demoScenes.js';
import { skyScene as tonemapScene, tonemapStrategies } from './tonemapScenes.js';
import { cylinderScene, cylinderStrategy } from './cylinderScene.js';
import { chromeScene, chromeMisStrategy, chromeNeeStrategy, chromePtStrategy } from './chromeScene.js';
import { hearthScene, hearthNeeStrategy, hearthPtStrategy } from './hearthScene.js';
import { meshDemoScene, meshDemoNeeStrategy, meshDemoPtStrategy } from './meshScene.js';
import { modelsScene, modelsBvhStrategy, modelsBruteStrategy, modelsPtStrategy } from './modelsScene.js';
import { forestScene, forestStrategy } from './forestScene.js';
import { spheresScene, spheresIndividualScene, spheresStrategy } from './spheresScene.js';

/** Camera pose is MEASUREMENT data — stamp it onto shared strategy literals per entry. */
const posed = (position: Vec3, target: Vec3, ...strategies: RenderStrategy[]) =>
    strategies.map((s) => withPose(s, position, target));

// Non-accumulating (oneshot) tracer — each frame is the current sample, live & noisy (no
// convergence). Same scene/camera as `cornell`, only the accumulation occupant differs.
const cornellOneshotStrategy: RenderStrategy = {
    id: 'oneshot',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 8 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'oneshot' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const demoSuite: Record<string, SceneSuiteEntry> = {
    spheres: {
        scene: spheresScene,
        strategies: posed([0, 4.5, 13], [0, 2.3, 0], spheresStrategy),
        exercises:
            'DEMO — instancing at scale (impl-plan-instancing): 500 spheres of varied size + position from ONE analytic-sphere prototype + a 500-entry placement texture, one region/material. The linear instance loop runs 500 intersects/ray — the point where a TLAS starts to matter.',
        expected:
            'a dense cloud of ~500 warm spheres of assorted sizes above a gray floor, one point light, correct inter-sphere shadows; all 500 share one prototype (memory is one sphere, not 500).',
    },
    'spheres-individual': {
        scene: spheresIndividualScene,
        strategies: posed([0, 4.5, 13], [0, 2.3, 0], spheresStrategy),
        exercises: 'A/B for `spheres`: the same 500 spheres as INDIVIDUAL objects (500 unrolled sphere_intersect blocks + 500 regions) — compare pathtracer ms/frame vs the instanced batch.',
        expected: 'same image as `spheres`; frame time comparable (both O(N) per ray — no TLAS); instancing wins memory + shader size, not traversal.',
    },
    forest: {
        scene: forestScene,
        strategies: posed([0, 3, 11], [0, 1, -2], forestStrategy),
        exercises:
            'DEMO — instancing (impl-plan-instancing): 20 cacti from ONE prototype BLAS + a placement texture (~23k tris for one upload), plus a row of instanced analytic spheres — both backends through the same placement-list loop. The BVH makes the per-instance traversal cheap.',
        expected:
            'a scatter of size-varied, rotated cacti on sand + a back row of gray spheres; one point light. All cacti share one mesh upload — memory is one cactus, not twenty.',
    },
    models: {
        scene: modelsScene,
        strategies: posed([0, 1.8, 5.2], [0.4, 0.6, 0], modelsBvhStrategy, modelsBruteStrategy, modelsPtStrategy),
        exercises:
            'DEMO — OBJ-loaded scene + the mesh BVH A/B (impl-plan-mesh-bvh): Utah teapot (6320 tris, smooth normals synthesized) + cactus (1152 tris), ~7.5k triangles. Key 1 = BVH traversal, key 2 = brute force — SAME image, the StatsPanel pathtracer ms/frame is the comparison; key 3 = pt.',
        expected:
            'a cream teapot + green cactus under one warm light; keys 1 (bvh) and 2 (brute) are pixel-identical but key 1 is DRAMATICALLY faster (brute ≈ 0.7 fps; bvh many× that); key 3 (pt) converges to the same image.',
    },
    meshes: {
        scene: meshDemoScene,
        strategies: posed([0, 2.4, 5.5], [0, 0.7, 0], meshDemoNeeStrategy, meshDemoPtStrategy),
        exercises:
            'DEMO — the FIRST triangle meshes (impl-plan-meshes v0): a flat-shaded icosahedron (20 faces, per-face geometric normals — visible facets) beside a smooth icosphere (80 faces, per-vertex normals → barycentric-smooth), both on an analytic quad floor, one point light. Brute-force traversal (no BVH yet); transforms are ray-into-local.',
        expected:
            'a faceted red d20 on the left, a smooth blue ball on the right — the flat vs smooth normal modes side by side; both cast/receive shadows from the point light; keys 1 (pt-nee) and 2 (pt) converge to the same image',
    },
    hearth: {
        scene: hearthScene,
        strategies: posed([0, 1.7, 4.6], [0, 0.6, 0], hearthNeeStrategy, hearthPtStrategy),
        exercises:
            'DEMO — the blackbody lamp + the FIRST Hit.uv reader (impl-plan-blackbody-uv): a quad lamp whose emission is {blackbody: {kelvin, scale}} — both dials DRIVEN (kelvin → chroma is a CPU Planck-locus fold into u_lamp_kelvin_rgb; the power CDF re-weights live) — over a `checker` floor mixing two albedos in Hit.uv (today the placeholder planar xz chart, visibly)',
        expected:
            'a candle-warm (2900 K) pool over ivory/slate tiles; drag lamp.kelvin toward 1500 K → ember-red, toward 9000 K → blue-white, with ZERO recompiles (the chrome ball re-reflects the shift); lamp.power scales brightness independently of color; keys 1 (pt-nee) and 2 (pt) converge to the same image',
    },
    chrome: {
        scene: chromeScene,
        strategies: posed([0, 1.6, 5.2], [0, 0.75, 0], chromeMisStrategy, chromeNeeStrategy, chromePtStrategy),
        exercises:
            'DEMO — the July-17 occupants in one frame: mirror (delta conductor, Schlick f0) · TWO tilted disk lights (concentric sampling, one-sided — the normal is the aim) · gold GGX · glass, on a {param}-roughness GGX floor under a black sky. MIS home turf: two area lights × a peaked glossy pdf',
        expected:
            'ROUND highlights everywhere — in the chrome, refracted through the glass, stretched across the glossy floor (disk shape, not the panel-era square); warm key + cool rim; key 1 (pt-mis) is the clean one, key 2 (pt-nee) fireflies on the glossy floor, key 3 (pt) is grain city; drag floor.roughness to smear the disk reflections live',
    },
    // One scene, the whole camera family on keys 1-4 (all differ ONLY by camera — the
    // measurement axis). 1 pinhole · 2 thin-lens (defocus) · 3 orthographic · 4 equirect.
    // Shared pose frames the box for 1-3; equirect (4) renders a valid 360 pano from it.
    cornell: {
        scene: cornellBox,
        strategies: posed([0, 1, 4], [0, 1, 0], cornellStrategy, cornellThinlensStrategy, cornellOrthoStrategy, cornellEquirectStrategy, fisheyeStrategy('equidistant'), cornellCylindricalStrategy),
        exercises: 'the camera family on one scene (keys 1-6): pinhole · thin-lens (aperture/focusDistance) · orthographic (parallel) · equirect (360) · fisheye (equidistant) · cylindrical (240° panorama). Each is a measurement change — they do NOT converge to each other. Also: region disambiguation (5 walls → 1 material), {param} albedo/fov',
        expected: '1 perspective · 2 defocus blur (aperture>0; 0 ≡ pinhole) · 3 no perspective convergence (parallel walls) · 4 full-sphere panorama · 5 circular 180° fisheye · 6 wide cylindrical panorama (straight verticals)',
    },
    'cornell-fisheye': {
        scene: cornellBox,
        strategies: posed([0, 1, 4], [0, 1, 0], fisheyeStrategy('equidistant'), fisheyeStrategy('equisolid'), fisheyeStrategy('stereographic'), fisheyeStrategy('orthographic')),
        exercises: 'the four fisheye sub-projections (keys 1-4) — same occupant, one radial map θ(ρ) each, compiler-selected: equidistant · equisolid · stereographic · orthographic. 180° fov',
        expected: 'same scene, four radial distortions: 1 angle-linear · 2 solid-angle-true (edges compressed) · 3 conformal (shapes preserved, "little planet") · 4 hemisphere-flat (heaviest edge compression)',
    },
    'cornell-oneshot': {
        scene: cornellBox,
        strategies: posed([0, 1, 4], [0, 1, 0], cornellOneshotStrategy),
        exercises: 'non-accumulating (oneshot) accumulation occupant — writes the current sample each frame, no history blend; reuses the average pipeline (never reads u_previous)',
        expected: 'a live, noisy image that does NOT converge (grain animates every frame); contrast the accumulating cornell card which cleans up over time',
    },
    cylinders: {
        scene: cylinderScene,
        strategies: posed([0, 1.7, 3.4], [0, 0.45, 0], cylinderStrategy),
        exercises: 'the cylinder primitive (door test: one folder + one registry line + one union word) across three placement tiers — translation · constant rotation+scale (similarity wrapper, s·d correction) · {param}-driven rotation+scale (rigid-frame uniforms; radius/halfHeight absorb s in-shader)',
        expected: 'three cylinders on a floor: upright clay, tilted green (rotated by PLACEMENT — the shape is canonical Y-axis, no axis param), red one re-orients/scales live on the spin.angle / spin.scale sliders with zero recompiles',
    },
    mixed: {
        scene: mixedScene,
        strategies: posed([0, 1.5, 6], [0, 0, 0], analyticStrategy),
        exercises: 'combined scene_intersect (SDF + analytic in one scene); cross-backend shadows',
        expected: 'both spheres cast shadows on the analytic floor; no backend-dependent artifacts',
    },
    submerged: {
        scene: submergedScene,
        strategies: posed([0, 0, 2], [0, 0, 0], submergedStrategy),
        exercises:
            'R-SUBMERGED innermost-wins witness (validation §5): sphere entry must classify region_from = water (η = 1.33/1.5); under deepest-wins the sphere is invisible',
        expected: 'the sphere VISIBLY distorts the checker with a Fresnel ring (invisible ⇒ classification bug); distortion is mild — relative η ≈ 1.13',
    },
    fogcube: {
        scene: fogcubeScene,
        strategies: posed([0, 1.6, 3], [0, 0.9, 0], fogcubeStrategy),
        exercises:
            'R-FOGCUBE null-interface rim witness (validation §5, absorbing variant): a bounded absorber over an emissive checker',
        expected:
            'the cube dims the checker behind it with NO bright rim at the silhouette (a Fresnel-like edge = the null interface leaked a BSDF); grazing edges fade smoothly',
    },
    fogblobs: {
        scene: fogblobsScene,
        strategies: posed([0, 1, 4], [0, 1, -0.5], fogblobsStrategy),
        exercises:
            'MATHEMATICAL density fields in the Cornell room: two nearby Gaussians summed — the metaball idea on density — so the blobs merge where they overlap; sculpt by editing the source in demos/mediaScenes.ts (any distance field works as exp(−sharp·d²)); blob.gain = density, blob.sharp = inverse square radius; the ceiling quad drives NEE through the blobs',
        expected:
            'two soft glowing blobs mid-room, self-shadowed under the ceiling panel, red/green wall bleed in the scatter; drag blob.sharp DOWN — they fuse into one form; UP — they separate into crisp puffs; drag blob.gain — density moves live',
    },
    glowblobs: {
        scene: glowblobsScene,
        strategies: posed([0, 1, 4], [0, 1, -0.5], glowblobsStrategy, glowblobsPtStrategy),
        exercises:
            'EMISSIVE density fields (impl-plan-medium-emission) + a DRIVEN quad light (driven-lights Stage A): the fogblobs Gaussians glowing — emission is ε (radiance per unit length), each blob vec3-weighted (one warm, one cool); glow.heat scales brightness live; blob.sharp is SHARED between the density and glow expressions; lamp.power drives the ceiling QUAD LIGHT\'s emission, NEE-sampled (key 1) — shadow rays walk the heterogeneous fog via shadow_media; key 2 is the pt chance-hit version (grainier)',
        expected:
            'a warm and a cool glowing blob lighting the fog around them; key 1 (pt-nee) is the clean one, key 2 (pt) grainier; drag lamp.power to 0 — the room goes dark and ONLY the blobs remain (the money shot: the light ships zero selection mass, no guard); drag glow.heat 0→10 — plain fog to lanterns; drag blob.sharp — density AND glow tighten together; core brightness saturates toward ε/σ_t',
    },
    groundfog: {
        scene: groundfogScene,
        strategies: posed([0, 1.6, 4.5], [0, 0.7, 0], groundfogStrategy),
        exercises:
            'the heterogeneous-media PLAYGROUND (fable-heterogeneous-media.md): ambient ground fog as a FORMULA of p with two declared sliders (fog.gain, fog.falloff) on the delta-tracking arms — edit the source string in demos/mediaScenes.ts and reload; the majorant ceiling (D1) saturates any spike instead of misrendering',
        expected:
            'fog hugs the floor and thins with height (drag fog.falloff); light shafts from the point light; drag fog.gain — density moves live with zero recompiles; patchy swirl from the sin-product term',
    },
    marble: {
        scene: marbleScene,
        strategies: posed([0.4, 1.15, 3.2], [0, 0.55, 0], marbleStrategy, marbleNoScatterStrategy),
        exercises:
            'DEMO — dielectric surface + scattering interior composed in ONE material, lit by an emissive panel (point lights cannot NEE-light a glass shell, §6.3); {param} smoke color + g; key 2 = volumeIntegrator none (scattering off)',
        expected:
            'a glowing storm-cloud core inside the glass, Fresnel rim from the panel below, dark moody surround; key 2 collapses the interior to clear tinted glass — the difference IS the volume integrator',
    },
    mist: {
        scene: mistScene,
        strategies: posed([0, 1.7, 6], [0, 1.6, -8], mistStrategy),
        exercises:
            'DEMO — bounded ground-fog layer (null interfaces at world scale), camera INSIDE the volume (classification-init, §4.4), medium NEE shafts from a warm sun, aerial perspective; {param} mist.density',
        expected:
            'warm crepuscular shadow-lanes between backlit stones, far monoliths fading into the haze, cool clear sky above the fog layer; expect halo spike-noise near the sun direction (equiangular is deferred)',
    },
    rayleigh: {
        scene: rayleighScene,
        strategies: posed([0, 1.5, 5.5], [0, 0.9, 0], rayleighStrategy),
        exercises:
            'DEMO — the multi-model volume dispatch (interaction_medium_* over mp.model), both occupants side by side: L rayleigh (parameter-free, λ⁻⁴ color in σ_s) · R hg (g=0.6). Same extinction; only medium.model differs',
        expected:
            'two fog boxes lit from the emissive checker: L cool evenly-scattering haze (rayleigh) · R warm forward glow (hg). If they look identical the dispatch isn\'t selecting the model',
    },
    tonemap: {
        scene: tonemapScene,
        strategies: posed([0, 1.3, 5], [0.4, 0.8, 0], ...tonemapStrategies),
        exercises:
            'DEMO — the tonemap roster on one scene (keys 1-7): agx · aces · khronos · reinhard · hable · gt · none. A matte + a glass ball under an outdoor HDRI sky. Every strategy shares the IDENTICAL linear HDR estimate — only view.tonemap differs, so this isolates the display transfer (the bright sun is what pulls the curves apart)',
        expected:
            'same scene, different highlight roll-off + hue: 1 agx (neutral, highlights desaturate to white) · 2 aces (filmic, slight hue skew on saturated hues) · 3 khronos (material-neutral, low contrast) · 4 reinhard (soft, washes highlights) · 5 hable (contrasty filmic) · 6 gt (linear midsection) · 7 none (raw linear — sky/sun CLIP to white, showing why tonemapping is needed)',
        initialParameters: {
            'camera.fov': 0.9,
        },
    },
};
