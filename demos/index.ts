// demos/index.ts — the DEMO registry: replaceable scenes made while testing and
// building. Churn freely — nothing outside this folder depends on any entry here.
// The durable GPU tests live in tests/witnesses/ (demos may borrow witness fixtures,
// never the reverse), and pages/registry.ts merges both suites into the view the
// gallery and lab render.

import type { AnySceneSuiteEntry } from '../tests/witnesses/types.js';
import { dataScenes } from './dataScenes.js';
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
import { sdfFieldScene, sdfFieldTableStrategy } from './sdfFieldScene.js';
import { sdfKnotScene, sdfKnotStrategy } from './sdfKnotScene.js';
import { sdfShapesScene, sdfShapesStrategy, sdfShapesPtStrategy } from './sdfShapesScene.js';
import { fractalsScene, fractalsStrategy } from './fractalsScene.js';
import { customFieldsScene, customFieldsStrategy } from './customFieldsScene.js';
import { glassLabScene, glassLabStrategies } from './glassLabScene.js';
import { sssLabScene, sssStrategy, sssShortStrategy, sssNoScatterStrategy, sssPtStrategy } from './sssLabScene.js';
import { porcelainScene, porcelainStrategy, porcelainNoScatterStrategy, porcelainPtStrategy } from './porcelainScene.js';
import { bottleArrayScene, bottleArrayStrategy, bottleArrayNoScatterStrategy, bottleArrayDeepStrategy, bottleArrayUnrolledStrategy } from './bottleArrayScene.js';
import { originalPresetsScene, originalPresetsStrategy, originalPresetsDeepStrategy, originalPresetsNoScatterStrategy } from './originalPresetsScene.js';
import { gyroidFieldScene, gyroidFieldStrategy } from './gyroidFieldScene.js';
import { chromeScene, chromeMisStrategy, chromeNeeStrategy, chromePtStrategy } from './chromeScene.js';
import { laserScene, laserSoftScene, laserNeeStrategy, laserMisStrategy } from './laserScene.js';
import { hearthScene, hearthNeeStrategy, hearthPtStrategy } from './hearthScene.js';
import { uvChartsScene, uvChartsNeeStrategy, uvChartsPtStrategy } from './uvChartsScene.js';
import { exprMaterialsScene, exprMaterialsNeeStrategy, exprMaterialsPtStrategy } from './exprMaterialsScene.js';
import { grinScene, grinNeeStrategy, grinPtStrategy, glassGrinScene, glassGrinStrategy, maxwellScene, maxwellStrategy } from './grinScene.js';
import { blackholeScene, blackholeStrategy } from './blackholeScene.js';
import { accretionScene, accretionStrategy } from './accretionScene.js';
import { meshDemoScene, meshDemoNeeStrategy, meshDemoPtStrategy } from './meshScene.js';
import { modelsScene, modelsBvhStrategy, modelsBruteStrategy, modelsPtStrategy } from './modelsScene.js';
import { forestScene, forestStrategy, forestLinearStrategy } from './forestScene.js';
import { spheresScene, spheresStrategy, spheresLinearStrategy } from './spheresScene.js';
import { cactiScene, cactiStrategy, cactiMisStrategy } from './cactiScene.js';
import { grandBazaarScene, grandBazaarStrategy, grandBazaarMisStrategy } from './grandBazaarScene.js';
import { embersScene, embersStrategy, embersMisStrategy, embersPtStrategy } from './embersScene.js';

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

// Sync demos + the ASYNC data-scene entries (fable-instance-clouds §7 — thunks over
// untracked .inst files; registry-iterating tests skip them via isAsyncSceneEntry).
export const demoSuite: Record<string, AnySceneSuiteEntry> = {
    ...dataScenes,
    embers: {
        scene: embersScene,
        strategies: posed([9, 2.6, 9], [0, 0.8, 0], embersStrategy, embersMisStrategy, embersPtStrategy),
        exercises:
            'DEMO — the many-lights payoff at cloud scale (fable-light-bvh stage 2): 3000 instanced ember spheres, '
            + 'each ITS OWN tree light (the params placement record is the light row; per-instance Φ ∝ r²), lighting '
            + '2500 instanced rocks with no other light in the scene. Selection at any rock is dominated by the '
            + 'nearest handful of embers out of 3000 — stochastic tree descent finds them at O(log n). '
            + 'Keys 1/2 = nee/mis under the tree; key 3 = plain pt (path-found glow — the "before" picture).',
        expected:
            'a smoldering field: dark rocks rim-lit in ember orange, pools of glow around each cluster. '
            + 'Keys 1 and 2 resolve the lighting within seconds; key 3 is dramatically noisier at equal time '
            + '(every glow found by chance bounces). All three converge to the same image.',
    },
    spheres: {
        scene: spheresScene,
        strategies: posed([0, 4.5, 13], [0, 2.3, 0], spheresStrategy, spheresLinearStrategy),
        exercises:
            'DEMO — the TLAS A/B (impl-plan-tlas) + per-instance ATTRIBUTES (fable-instance-attributes): 500 instanced spheres from one prototype with 500 per-instance albedos (ONE material; Hit.element → the attrs table). Key 1 = TLAS, key 2 = linear scan (500 tests/ray) — SAME image, watch pathtracer ms/frame collapse (~7× on SwiftShader).',
        expected:
            'a dense cloud of ~500 pastel multi-colored spheres above a gray floor — every color from one material + the per-instance table; keys 1 (tlas) and 2 (linear) are pixel-identical, key 1 dramatically faster. All 500 share one prototype (memory is one sphere).',
    },
    'grand-bazaar': {
        scene: grandBazaarScene,
        strategies: [grandBazaarStrategy, grandBazaarMisStrategy],
        exercises:
            'DEMO — the Stage B payoff (fable-object-tables): ~350 UNIQUE objects (250 spheres + 60 quads + 40 disks, no two alike) + 3 cactus meshes + a 150-instance batch, ALL leaves of ONE scene TLAS — plus the residual arm live (plane floor, slider-driven chrome orb). Table-only strategies ON PURPOSE: an unrolled arm at this count would stall compile at load, which is exactly the pain the table retires (the A/B lives on the moderate bazaar witness). Keys 1/2 = nee/mis.',
        expected:
            'a dusk field of ~500 varied objects — colored spheres, floating tiles, tilted disks, three cacti, a pebble carpet — compiling as fast as a 5-object scene and tracing at ~log N. Drive grand.orb to fly the chrome ball with zero recompiles.',
    },
    cacti: {
        scene: cactiScene,
        strategies: [cactiStrategy, cactiMisStrategy],
        exercises:
            'DEMO — the mesh-story showcase (fable-mesh-containment + fable-mesh-lights): three COLORED-GLASS cacti (dielectric over a Beer–Lambert absorbing interior — real colored glass through proven-closed meshes) lit by a GLOWING cactus (an emissive mesh, NEE-sampled via its triangle-area CDF). Key 1 = nee, key 2 = mis.',
        expected:
            'a warm glowing cactus at center lighting three tinted glass cacti (green/amber/blue) on a dark stage under a faint night sky — tint deepens where the glass is thick (Beer–Lambert), refraction and soft mesh-light shadows throughout.',
    },
    forest: {
        scene: forestScene,
        strategies: posed([0, 6, 22], [0, 1, -2], forestStrategy, forestLinearStrategy),
        exercises:
            'DEMO — instancing + TLAS (impl-plan-tlas): 300 cacti from ONE prototype BLAS + a placement texture (~350k tris for one upload), traversed by a per-batch TLAS, plus a row of instanced analytic spheres. Key 1 = TLAS, key 2 = linear — the A/B.',
        expected:
            'a dense field of ~300 size-varied, rotated cacti on sand + a back row of gray spheres; one point light. All cacti share one mesh upload (memory is one cactus); key 1 (tlas) is far faster than key 2 (linear).',
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
    charts: {
        scene: uvChartsScene,
        strategies: posed([0, 1.5, 5.5], [0, 0.85, 0], uvChartsNeeStrategy, uvChartsPtStrategy),
        exercises:
            'DEMO — real per-primitive UV charts (fable-imagery P1): ONE `checker` material on a sphere, a quad, and a disk, so the same albedo pair reveals THREE parameterizations. sphere → (θ,φ) equirect · quad → natural [0,1]² along its edges · disk → polar (r/R, θ/2π). Before P1 all three showed the identical planar xz placeholder; now Hit.uv is real. Keys 1 (pt-nee) / 2 (pt).',
        expected:
            'a checkered sphere whose cells crowd toward its top/bottom poles (longitude/latitude) · a checkered panel with a perfectly even grid square-on to its edges · a checkered disk of concentric rings cut into angular wedges — three DIFFERENT patterns from one material; keys 1 and 2 converge',
    },
    grin: {
        scene: grinScene,
        strategies: posed([0, 2.1, 4.6], [0, 0.75, 0], grinNeeStrategy, grinPtStrategy),
        exercises:
            'DEMO — variable-IOR (gradient-index) media (fable-variable-ior.md): the tracer\'s FIRST curved-space feature. A Luneburg lens n(r)=√(2−(r/R)²) — a deflecting region whose rays integrate the Sharma ray ODE (velocity Verlet) instead of scattering, bending along the optical metric n²·δ. An INVISIBLE lens (continuous n, no Fresnel); you see the checker floor BENT and magnified through it. Keys 1 (pt-nee) / 2 (pt).',
        expected:
            'a checkered floor with a lens-shaped patch where the pattern is strongly warped/magnified (the rays bending through the invisible sphere) — the checker squeezes and inverts inside the lens silhouette; keys 1 and 2 converge',
    },
    maxwell: {
        scene: maxwellScene,
        strategies: posed([0, 2.1, 4.6], [0, 0.75, 0], maxwellStrategy),
        exercises:
            'DEMO — Maxwell\'s fisheye n(r) = 2/(1 + r²/R²): the classic absolute instrument. n = 1 EXACTLY at the rim (seamless \'none\' wall), n = 2 at the center; every interior ray is a CIRCLE and rim points image perfectly onto their antipodes. The closed-photon-orbit field the walk\'s bounce budget bounds — deep windings near the rim terminate by budget.',
        expected:
            'an invisible sphere showing a strongly inverted, wrapped image of the checker floor and sky — more extreme than the Luneburg card (rays can wind around inside before exiting); no Fresnel rim (the wall is seamless)',
    },
    blackhole: {
        scene: blackholeScene,
        strategies: posed([0, 1.9, 4.6], [0, 1.0, 0], blackholeStrategy),
        exercises:
            'DEMO — Majumdar–Papapetrou black holes in a glass block (the reference PathTracer\'s blackholeCube/Multi, idiomatic): two extremal holes in static equilibrium, n = U² = (1 + M/r₁ + M/r₂)² as the medium\'s ior formula. The dielectric wall refracts with the LOCAL field value per hit point; the interior runs the adaptive-step Verlet walker (DS_MAX/DTOL limiters); the shadows are PURE CAPTURE (n > GRIN_CAPTURE, inside the photon sphere) — dynamics, not geometry. Drag bh.mass live: 0 = plain glass block, up = stronger lensing.',
        expected:
            'a glassy block (Fresnel rim, refraction at the faces) containing TWO black disks — the hole shadows — surrounded by strong checker-floor/sky lensing (Einstein-ring-like distortion around each shadow); bh.mass → 0 relaxes it to an ordinary glass block',
    },
    accretion: {
        scene: accretionScene,
        strategies: posed([0, 1.75, 3.6], [0, 1.25, 0], accretionStrategy),
        exercises:
            'DEMO — a black hole with a glowing accretion disk in a crystal ball (impl-plan-grin-media batch 1): the disk is EMISSIVE MEDIUM (a thin equatorial ε torus in the hole\'s deflecting field, n = (1 + M/r)²) — the lensed disk image needs NO embedded geometry. Per-step collection along the bent path × the (n₀/n)² source factor; captured rays keep the glow they crossed. Drag bh.mass live.',
        expected:
            'the classic shot: a glowing ring with the black shadow disk at its center, the disk\'s FAR side lensed into arcs OVER and UNDER the shadow (light bent around the hole), all inside a subtly glassy sphere; bh.mass → 0 relaxes to a flat glowing torus in glass',
    },
    glassball: {
        scene: glassGrinScene,
        strategies: posed([0, 2.1, 4.6], [0, 0.75, 0], glassGrinStrategy),
        exercises:
            'DEMO — the HARD-INTERFACE GRIN (impl-plan-grin-interface): a VISIBLE glass ball whose interior index falls from 1.6 (center) to ~1.15 (wall). The dielectric wall fires with the LOCAL field value (ior_of(region, p) = the medium formula at the hit point) — Fresnel reflections and TIR at the surface — while the interior bends continuously through the Verlet walker. Glass and mirage in one object.',
        expected:
            'a recognizably GLASSY ball (bright Fresnel rim, floor reflections) whose refracted checker image is warped MORE than a uniform glass ball would show — the interior gradient adds continuous magnification on top of the surface refraction',
    },
    paint: {
        scene: exprMaterialsScene,
        strategies: posed([0, 1.5, 5.2], [0, 0.8, 0], exprMaterialsNeeStrategy, exprMaterialsPtStrategy),
        exercises:
            'DEMO — expression-driven materials (fable-imagery P2): albedo as a FORMULA over the surface chart `uv` (P1) and the shading point `p`, live sliders, zero recompiles. Left sphere = a cosine palette over uv (rainbow bands following the (θ,φ) chart); right sphere = a 3D sinusoid over the world point p (works chart-or-not). Same GlslExpression idiom the fog uses, pointed at material rows. Drag paint.freq. Keys 1 (pt-nee) / 2 (pt).',
        expected:
            'two spheres painted by math over a gray floor — the left one banded in rainbow stripes that wrap its surface, the right one a soft multicolor blob field; drag paint.freq to add bands/detail LIVE with no recompile; keys 1 and 2 converge',
    },
    laser: {
        scene: laserScene,
        strategies: posed([0, 1.6, 5.5], [0, 1.2, -0.5], laserNeeStrategy, laserMisStrategy),
        exercises:
            'DEMO — the beam kind (impl-plan-directional-beam) + the ROUGHNESS-VS-SAMPLING experiment: three colored lasers crossing a foggy room, the green one striking a near-mirror GGX ball. Non-delta makes the reflected glow reachable (phase sample → ball vertex → beam NEE weighted by the GGX eval), but the eval concentrates on a surface patch ∝ α² — drag ball.roughness from 0.6 down toward 0.02 and watch the reflected glow trade width for noise, approaching the delta×delta probability-zero limit continuously. Drag fog.sigma_s to thicken the air. Keys 1 (pt-nee) / 2 (pt-mis). v1 caveat: thin beams firefly at low spp (plan P7)',
        expected:
            'three neon shafts fanning through the fog; the green one stamps a glint on the chrome ball with a fog shadow tunnel behind it, plus a faint wide green gloss-glow off the ball at higher roughness that sharpens AND gets noisier as roughness drops — near 0.02 it is fireflies-or-nothing (the delta limit); black sky, dim cool wash',
    },
    'laser-soft': {
        scene: laserSoftScene,
        strategies: posed([0, 1.6, 5.5], [0, 1.2, -0.5], laserNeeStrategy, laserMisStrategy),
        exercises:
            'DEMO — the SOFT BEAM twin (fable-emitter-profiles v0): the green laser is a `softbeam` (δ = 2°, Le matched so the shaft brightness equals the delta card\'s), red/blue stay delta as in-frame references. The hittable-laser experiment: the ball\'s reflected glow is now reachable BOTH by vertex NEE × GGX eval AND by chance hits through the specular lobe onto the aperture (MIS-weighted) — compare noise against `laser` at equal time, and drag ball.roughness down: this card should degrade more gracefully than the delta one',
        expected:
            'same room as `laser`; the green shaft\'s edge softens with distance (divergence), its wall spot has a penumbra, and the rough ball\'s green reflection is less fireflies-or-nothing than the delta card at low roughness',
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
    fractals: {
        scene: fractalsScene,
        strategies: posed([0.35, 1.75, 4.2], [0, 0.95, 0], fractalsStrategy),
        exercises:
            'TWO CLASSICAL FRACTALS as ordinary occupants. menger: the construction is subtractive, so its '
            + 'march bound is the enclosing cube EXACTLY — a fractal costs no more envelope than a box, and '
            + '`iterations` is a row (1…8). apollonian: an IFS with no closed-form envelope, so its bound is a '
            + 'MEASURED fit; and since the limit set has EMPTY INTERIOR, the object is the declared '
            + 'ε-neighbourhood (`thickness`) rather than whatever MARCH_EPSILON happened to resolve. A plain '
            + 'sphere sits between them as the control — same dispatch, same materials, slower intersect only.',
        expected:
            'an ivory Menger sponge tipped onto a corner and a gold Apollonian gasket, both lit by an overhead '
            + 'panel with a dim rim behind: the recursion should read through CONTACT SHADOWS and occlusion, '
            + 'not just silhouette. Drop apollonian thickness to 0.002 in the source for finer filigree.',
    },
    'gyroid-field': {
        scene: gyroidFieldScene,
        strategies: posed([0, 6.5, 13.5], [0, 0.8, 0], gyroidFieldStrategy),
        exercises:
            '100 INSTANCED SCENE-LOCAL GYROIDS \u2014 the SDF-contract arc\u2019s payoff: a defineSDF field as an '
            + 'INSTANCE PROTOTYPE (one prototype \u00d7 100 frame-tier placement records), batch TLAS over the '
            + 'instance world boxes, the GENERATED gyroid_sdf_intersect as the leaf body, AABBs derived from '
            + 'the declared sphere bound (rotation-invariant \u2014 no refit under any placement).',
        expected:
            'a drifting field of bronze lattice balls in three size classes under a large overhead panel \u2014 '
            + 'interactive framerates because each ray marches only the few boxes it enters, never 100 fields.',
    },
    'glass-lab': {
        scene: glassLabScene,
        strategies: posed([0, 1.7, 3.4], [0, 0.7, 0], ...glassLabStrategies),
        exercises:
            'THE GLASS EXPERIMENT BENCH \u2014 the instrument that cornered the conservativeness bug '
            + '(fable-sdf-contract \u00a74). Keys 1-4 = maxBounces 4/8/16/32 (dark patches that brighten = PATH '
            + 'TRUNCATION \u2014 many-interface solids want 16+). Left = the quartic tangle SOLID (the (f, \u2207f, H) '
            + 'envelope estimate \u2014 the variety-port form); right = the gyroid lattice SHELL in glass (global '
            + 'gradient-bound estimate, thin double walls); front = the EXACT closed-form sphere (no field '
            + 'anywhere \u2014 the control that separates transport from field/marching). glass.ior slider '
            + '(1.05-2.0) drives TIR strength live.',
        expected:
            'key 3+ (16/32 bounces): all three bright, clean glass \u2014 the tangle\u2019s arms refract solidly, the '
            + 'gyroid reads as a filigree glass lattice, the sphere\u2019s caustic is sharp. Key 1 shows honest '
            + 'truncation darkening. No terraced rings anywhere \u2014 that class is gated now.',
    },
    'custom-fields': {
        scene: customFieldsScene,
        strategies: posed([1.8, 1.9, 3.6], [0, 0.85, 0], customFieldsStrategy),
        exercises:
            'SCENE-LOCAL SDF FIELDS (fable-sdf-contract §5.2, the zero-ceremony door): two fields invented FOR '
            + 'this scene and defined in its own file with `defineSDF` — no folder, no registry line. Each is one '
            + 'call: the GLSL field, its TS twin, and the declaration sheet; the compiler generates struct, march '
            + 'loop, 4-tap normal, containment and the derived AABB, and the VALIDATOR samples the twin against '
            + 'the declared bound at the authored values — a clipping bound is a compile error. gyroid: a '
            + 'sin/cos lattice made conservative by dividing its gradient bound, clipped to a ball (bound exact '
            + 'by construction). tangle: a quartic SOLID in real glass (f < 0 is a genuine interior — '
            + 'containment through the same twin-checked field); its `shape` dial roams freely because the '
            + 'clip cell, not the surface, owns the bound.',
        expected:
            'a bronze gyroid lattice ball and a glass quartic tangle on stone plinths, copper ring on the floor '
            + 'behind; the tangle should refract like solid glass (its interior is genuine), and the lattice '
            + 'should read through its holes under the overhead panel.',
    },
    'sdf-shapes': {
        scene: sdfShapesScene,
        strategies: posed([1.9, 1.75, 3.5], [0, 0.8, 0], sdfShapesStrategy, sdfShapesPtStrategy),
        exercises:
            'THE SDF SHAPE LIBRARY, now that a distance field is just a shape with a slow intersect: a '
            + 'CONSTRUCTED bottle (two rounded cylinders smooth-unioned, onion-hollowed, chopped, punted) filled '
            + 'with a real dielectric — its operators file-private, since a shape\'s internal maths is its own; a '
            + 'VENDORED model (NVIDIA sdf-explorer knob, MIT — helpers prefixed, bound MEASURED with its TS twin); '
            + 'and a torus, whose march bound is a DIFFERENT primitive (cylinder R+r × r). The plinths, ball and '
            + 'block are ANALYTIC — both intersect kinds in one dispatch, indistinguishable at the authoring '
            + 'layer. Key 2 = the pt arm (no NEE).',
        expected:
            'a still life: glass flask and brass knob on two stone plinths, a copper ring behind, a ball and a '
            + 'block on the floor under a soft overhead key. The glass should refract what is behind it, and the '
            + 'knob should show its cutout, inner eye and etched groove. Key 2 converges to the same picture, '
            + 'slower and noisier.',
    },
    'sdf-knot': {
        scene: sdfKnotScene,
        strategies: posed([7.5, 5.2, 7.5], [0, 0, 0], sdfKnotStrategy),
        exercises:
            'SDF INSTANCING (impl-plan-sdf-as-shape T7): 3000 marched links on a trefoil knot as THREE batches — '
            + 'cylinder, box and sphere prototypes, each placed at ~1000 individually rotated and scaled transforms. '
            + 'A marched prototype rides the same instance leaf item as a closed-form one, differing only in its '
            + 'bound test + <type>_sdf_intersect. Three regions, three materials: nothing in the compiler grows '
            + 'with the link count.',
        expected:
            'a trefoil chain of brass/jade/coral links tracing interactively. Distinct (non-instanced) marched '
            + 'objects stay the small-N regime — see sdf-table-twin.',
    },
    'sdf-field': {
        scene: sdfFieldScene,
        strategies: posed([13, 7, 13], [0, 1.2, 0], sdfFieldTableStrategy),
        exercises:
            'the boxed-SDF architecture on its HOME TURF (fable-sdf-accel): 150 small well-separated rotated '
            + 'SDF objects as LEAF_SDF leaves of the scene TLAS — a ray marches only the few fields whose boxes '
            + 'it enters; empty space costs zero evaluations. TABLE-ONLY like grand-bazaar (an unrolled arm at '
            + 'this count stalls compile at load — exactly the pain the table retires); the A/B vs the global '
            + 'marcher lives on the 30-object sdf-table-twin witness.',
        expected:
            'a colorful spiral field of 150 boxes/cylinders/spheres over a gray floor, loading as fast as a '
            + 'small scene and tracing interactively. If THIS card is slow, the leaf machinery itself is at fault.',
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
    'sss-presets': {
        scene: originalPresetsScene,
        strategies: posed([-1.5, 5.4, 15.5], [1.5, 1.2, 0.0], originalPresetsStrategy, originalPresetsDeepStrategy, originalPresetsNoScatterStrategy),
        exercises:
            'DEMO — the subsurface presets from the ORIGINAL PathTracer (~/Code/PathTracer), ported number-for-number and '
            + 'ADDITIVE (no model, component or other scene touched). Its model transcribed: sigma_s = 1/mfp, '
            + 'sigma_a = -ln(tint)/depth (its absorbFor), phase = lerp-toward-random by blur^2. Five presets dense to '
            + 'dilute — porcelain 0.02 / milk 0.03 / marble 0.06 / jade 0.10 / wax 0.12 — at the original\'s own ball radius '
            + '1.3, so its free-path RATIOS (130 down to 22 across a ball) are preserved. Plus its nested core-in-shell pair, '
            + 'which needed a hand-declared `nestedIn` there and resolves from geometry here (innermost-wins scene_region_at). '
            + 'ONE declared approximation: the original\'s phase function is not HG, so this matches its MEAN COSINE '
            + '(blur 1 -> g 0 is EXACT, so 3 of 5 presets are exact; jade and wax are approximated). Key 2 = the original\'s '
            + 'own 1000-step budget, key 3 = scattering ignored.',
        expected:
            'five balls from dense barely-translucent porcelain through milk, marble, deep green jade and warm waxy orange, '
            + 'plus a green scattering core suspended in a clear glass shell. SLOW AND NOISY BY CONSTRUCTION, and that is the '
            + 'finding rather than a defect: porcelain sits at alpha ~ 0.997 (~400 collisions before absorption) and milk\'s '
            + 'BLUE CHANNEL HAS sigma_a = 0 EXACTLY, so blue never absorbs and only the bounce budget can end it. Key 2 is the '
            + 'measurement that matters — if porcelain and milk BRIGHTEN at maxBounces 1024, then key 1\'s 256 truncates this '
            + 'look and the termination work is required, not optional. jade and wax are absorbing enough to converge quickly. '
            + 'Key 3 collapses all five to tinted glass.',
    },
    'porcelain-array': {
        scene: bottleArrayScene,
        strategies: posed([0.15, 2.85, 4.55], [0, 0.52, -0.25], bottleArrayStrategy, bottleArrayNoScatterStrategy, bottleArrayDeepStrategy, bottleArrayUnrolledStrategy),
        exercises:
            'DEMO — the translucency WEDGE: 12 copies of the bottle shell, each its own lantern, over a 4x3 grid of '
            + 'MEAN FREE PATH (columns, doubling the wall\'s optical thickness: 0.625/1.25/2.5/5.0 free paths across 0.05 of wall) '
            + 'x SCATTERING DIRECTION (rows, HG g = +0.8 / 0 / -0.6). Every cell is authored for the SAME TARGET COLOUR '
            + 'through subsurfaceMedium, and that inversion RAISES alpha as g turns forward, so the rows carry different '
            + 'coefficients (alpha 0.9979 / 0.9987 / 0.9997) chosen to LOOK ALIKE. That makes the grid a test of the inversion '
            + 'itself: it is derived for a SEMI-INFINITE slab, and these walls are 0.6 to 5 free paths thick, so the right-hand '
            + 'columns should show the three rows nearly identical (the inversion working) while the left-hand columns should show '
            + 'them genuinely DIFFER (too few events for the asymptotic argument, so the phase function is still visible as itself). '
            + 'The boundary between agreeing and disagreeing rows is the answer it reports. Key 3 is the instrument\'s own validity check (twice the path budget — nothing should change, because a '
            + 'truncated cell converges darker and would corrupt the row comparison); key 4 is the LEAF_SDF cost A/B '
            + '(objectDispatch unrolled, pixel-identical) on 12 marched shells.',
        expected:
            'a grid of glowing vessels going from nearly-clear glass at the left to dense ceramic at the right. Read it by ROW '
            + 'rather than by cell: the three rows should converge toward each other as you move right, and separate as you move '
            + 'left. If they agree everywhere the inversion is holding further from the semi-infinite limit than expected; if they '
            + 'disagree everywhere, something is wrong with it. Key 2 collapses all twelve to the same clear glass with the bulbs '
            + 'snapping into view in rows — every difference in the grid was the random walk, none of it the surface. Keys 3 and 4 '
            + 'are both the same image as key 1 — key 3 proves the sweep is not truncated, key 4 only changes ms/frame. Expect '
            + 'firefly noise while it converges, worst on the forward (front) row, whose alpha is highest. NOT YET RENDERED at '
            + 'these values.',
    },
    porcelain: {
        scene: porcelainScene,
        strategies: posed([1.75, 1.15, 3.0], [-0.12, 0.46, 0], porcelainStrategy, porcelainNoScatterStrategy, porcelainPtStrategy),
        exercises:
            'DEMO — the SSS hero shot, and the point a row of spheres cannot make: translucency is about THICKNESS. '
            + 'The bottle SDF filled with porcelain instead of glass (a hollow shell, ~3.5 mean free paths across the wall) '
            + 'with a warm SPHERE LIGHT inside its cavity — nothing on the vessel emits, every photon on its walls '
            + 'random-walked through the porcelain from the bulb. The solid ball beside it is the SAME material at '
            + '~35 mean free paths instead of ~3.4 and is flatly opaque — the comparison is in the image, not a keypress. '
            + 'Key 2 = scattering ignored, key 3 = pt (which locates where NEE actually enters: dead inside the wall, '
            + 'live at its inner exit — the rough glaze is load-bearing).',
        expected:
            'a glowing porcelain bottle on dark slate: warm light carried THROUGH the wall, strongest across the body '
            + 'where the bulb sits and cooling as it climbs the neck, and the bulb NOT visible as a shape — only as '
            + 'diffused light in the porcelain. Beside it the same porcelain as a solid ball reads as plain opaque white '
            + 'ceramic (if it ever looks translucent, something is wrong), and the celadon ring picks up a deep green glow. '
            + 'Key 2 collapses the porcelain to clear glass: the bulb snaps into view as a hard bright blob through a '
            + 'refracting shell and the glow vanishes — that difference IS the random walk. Key 3 is far noisier. '
            + 'Expect firefly noise while it converges; a few-free-path wall at α ≈ 0.996 is tens of events deep per path.',
    },
    'sss-lab': {
        scene: sssLabScene,
        strategies: posed([0, 1.05, 3.9], [0, 0.36, 0], sssStrategy, sssShortStrategy, sssNoScatterStrategy, sssPtStrategy),
        exercises:
            'DEMO — brute-force random-walk SUBSURFACE SCATTERING with no subsurface model: a refractive boundary '
            + '(rough_dielectric) + a scattering medium in ONE material, per fable-volumetric-component §1 ("murky water '
            + 'with brutal coefficients"). Five identical spheres differing ONLY in their medium, authored through the '
            + 'production albedo inversion (Chiang 2016 α(A) + Christensen-Burley σ_t = 1/(d·s(A)), both CPU-side at '
            + 'definition time) — including CHROMATIC mean free paths on `skin`. Front row: the SMOOTH-shell twin of the '
            + 'porcelain (delta exit ⇒ NEE can never fire at it — the shadows: opaque-dielectrics consequence) and an opaque '
            + 'lambert control. Live `sss.roughness` dial on the row. Key 2 = maxBounces 8 (the walk truncated), '
            + 'key 3 = scattering ignored, key 4 = pt (no NEE at all).',
        expected:
            'a row of beads lit from INSIDE rather than on the surface: green jade, warm skin, waxy alabaster, glowing '
            + 'porcelain, dense white milk — with pools of TRANSMITTED colour on the floor beneath each one (magenta under '
            + 'the jade: its red channel is optically thinner, so what punches through is not the body colour). The opaque '
            + 'lambert control reads flat and chalky beside them; that gap IS the subsurface transport. Key 2 goes duller '
            + 'and more mottled and its specular highlights dominate — the deep multiple scattering is simply missing; it is '
            + 'a truncation, so time never closes the gap. Key 3 collapses the whole row to frosted tinted GLASS (and runs '
            + '~2× faster) — the difference between keys 1 and 3 is the entire effect. Key 4 is dramatically noisier '
            + '(floor fireflies everywhere): with no NEE, every bead is in the regime the front-left smooth sphere is stuck '
            + 'in permanently. Expect visible firefly noise even on key 1 — high-albedo walks under a throughput-capped RR '
            + 'are genuinely noisy, which is the honest cost of brute force here.',
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
