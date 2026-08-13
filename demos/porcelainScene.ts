// demos/porcelainScene.ts — LANTERN: thin porcelain, lit from within.
//
// The hero shot for random-walk subsurface scattering, and the reason a row of spheres is
// the WRONG way to show it: translucency is a statement about THICKNESS, and a sphere has
// only one. Real porcelain has a sub-millimetre mean free path, so a thick piece is flatly
// opaque — a path that enters absorbs long before it finds its way out. The same material
// as a thin VESSEL WALL glows, because the wall is now a few mean free paths across and
// light can cross it.
//
// So: the bottle SDF (a hollow shell — five operators over two primitives, hollowed and
// chopped open at the lip) filled with porcelain instead of glass, and a small warm SPHERE
// LIGHT inside its cavity. Nothing about the vessel emits. Every photon you see on its
// walls entered the porcelain from the bulb, random-walked through the wall off σ_s, and
// came out the far side. The lip is brightest (open mouth, direct escape), the shoulder
// falls off as the wall turns away, and the punt dimple prints as a dark ring in the base
// where the wall doubles back on itself.
//
// THE COMPARISON IS IN THE IMAGE, not in a keypress. The lantern and the ball beside it
// carry the SAME `porcelain` material — identical σ_s, σ_a, ior, glaze roughness — and
// differ only in how far light has to travel:
//
//     the lantern wall   0.05 units  →   ~2.9 mean free paths  →  glows through
//     the solid ball     0.52 units  →  ~31   mean free paths  →  opaque white ceramic
//
// If that ball ever looks translucent, something is wrong. (Shape parameters are
// compile-time constants by type, so this is a static pair rather than a slider — which is
// better anyway: you see both answers at once.)
//
// A NOTE ON THE NUMBERS, because they are not the physical ones. What the eye reads is
// OPTICAL DEPTH — thickness × σ_t — so the pair (wall, σ_t) has one degree of freedom the
// image cannot see. Real porcelain is a sub-millimetre free path in a millimetre wall; that
// same optical depth at a coarser σ costs far less to render, because the interior march
// steps scale with the wall (|d| stepping inside a thin shell is the expensive case, and it
// is the only reason this scene is not a thin-wall model of a real teacup). Wall 0.05 at a
// 0.017 free path is the same ~2.9 free paths as wall 0.022 at 0.0075, and renders ~3× faster.
//
//   KEY 1 `lanterns`  — the full estimate: mis, maxBounces 64.
//   KEY 2 `noscatter` — measurement.scattering: 'ignored'. The porcelain collapses to
//              clear glass: the bulb snaps into view as a hard bright blob seen through a
//              refracting shell, and the glow is simply gone. The difference between keys
//              1 and 2 is the entire random walk.
//   KEY 3 `lanterns-pt` — directLighting 'none'. Every wall vertex now has to find the bulb
//              by chance. Much noisier — and it locates where key 1's direct lighting
//              actually enters: NEE is dead INSIDE the wall (shadow rays die on the
//              boundary, measurement.shadows 'opaque-dielectrics'), but fires perfectly at
//              the wall's INNER exit, which faces the bulb across empty cavity. Rough
//              glaze is load-bearing for that: a smooth shell has no non-delta exit lobe
//              for NEE to use.
//
// Lighting: the bulb inside the vessel is the only warm source and the only emitter in
// frame. A cool fill sits above the top of the picture, out of shot, so the outsides of the
// pieces read at all.
//
// The vessel's PROPORTIONS are partly a lighting decision. The cavity that feeds the neck is
// only neckRadius − thickness wide, so a bulb wider than that plugs its own neck and leaves
// the upper vessel dark; the neck also has to be generous enough for light to climb it. The
// other route — a light BEHIND the set, shining through the walls toward the camera — was
// tried and rejected: every version of it put a glowing rectangle in frame and flattened the
// picture.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { subsurfaceMedium } from '../src/authoring/subsurface.js';

// The bottle's local origin is the CENTRE of the body cylinder with +Y up the neck, so the
// shell spans y ∈ [−baseHeight, baseHeight + 2·neckHeight] and standing one on the table
// means lifting it by exactly baseHeight.
const TALL = { baseRadius: 0.30, baseHeight: 0.42, neckRadius: 0.15, neckHeight: 0.26 };

export const porcelainScene: SceneDescription = {
    id: 'porcelain',
    name: 'Lantern (thin porcelain, lit from within)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane', name: 'table',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'slate',
        },
        // THE HERO — a thin porcelain shell with a lamp inside it.
        {
            type: 'bottle', name: 'lantern',
            parameters: {
                ...TALL,
                thickness: 0.05,           // ~2.9 mean free paths: light crosses the wall
                rounded: 0.07, smoothJoin: 0.14, punt: 0.13,
            },
            material: 'porcelain',
            transform: { position: [-0.32, TALL.baseHeight, 0] },
        },
        // THE CONTROL — the same porcelain, solid and 0.52 across: ~31 mean free paths, so
        // every path that enters absorbs before it can leave. Opaque white ceramic. (Also
        // the cheap object in the scene: an analytic sphere, no marching anywhere.)
        {
            type: 'sphere', name: 'control',
            parameters: { radius: 0.26 },
            material: 'porcelain',
            transform: { position: [0.86, 0.26, 0.46] },
        },
        // The celadon ring, stood on edge and pulled forward into the lantern's light: the same thin-wall regime reached a
        // different way (a thin TUBE), and its colour is transport rather than tint — its
        // red channel is optically thinner than its green, so the two disagree with depth.
        {
            type: 'torus', name: 'ring',
            parameters: { ringRadius: 0.38, tubeRadius: 0.095 },
            material: 'celadon',
            transform: {
                position: [-1.28, 0.46, 0.52],
                rotation: { axis: [0.88, 0, 0.47], angle: 1.5708 },
            },
        },
    ],
    materials: {
        slate: { model: 'lambert', albedo: [0.155, 0.15, 0.16] },
        // GLAZED PORCELAIN — a lightly-rough refractive surface over a dense, very
        // high-albedo interior, authored the way the material actually reads: near-white with a
        // warm bias, and light travelling 0.017 units between scatters. That makes the 0.05 wall
        // ~2.9 free paths — a *few*, not a solid — while the 0.52 solid ball beside it is ~31 and
        // therefore opaque. The inversion asks for α ≈ 0.999 to reach this colour, so a trapped
        // path needs thousands of collisions to absorb and escapes through the near wall long
        // before that. THAT is the glow.
        // The glaze roughness is not cosmetic: it is the non-delta exit lobe NEE needs.
        porcelain: {
            model: 'rough_dielectric',
            ior: 1.5,
            roughness: 0.12,
            medium: subsurfaceMedium({ color: [0.94, 0.92, 0.88], radius: 0.017 }),
        },
        // CELADON — a translucent green glaze: light travels ~3× further than in the porcelain,
        // so across the 0.17 tube it is ~3.4 free paths and stays deep and glassy rather than
        // turning chalky. Its red α is 0.76 against green's 0.97, so the green is transport.
        celadon: {
            model: 'rough_dielectric',
            ior: 1.5,
            roughness: 0.10,
            medium: subsurfaceMedium({ color: [0.30, 0.66, 0.50], radius: 0.05 }),
        },
    },
    lights: [
        // THE BULB — inside the cavity, small and warm, and sitting HIGH in the body: the
        // cavity runs up through the neck, so a bulb near the shoulder lights the neck's
        // inner wall directly and the glow climbs to the lip instead of pooling in the base.
        // It is walled in except for the open lip, so its light reaches the camera only by
        // escaping the mouth or being carried through the porcelain. Kept modest on purpose: a hotter bulb drives the wall into
        // the tonemap's shoulder, where everything desaturates to white and the warmth (the
        // whole point of lighting porcelain from inside) is lost.
        {
            kind: 'sphere',
            position: [-0.32, TALL.baseHeight + 0.16, 0], radius: 0.07,
            emission: [42, 27, 15],
        },
        // Cool fill above the top of the frame, facing down — never in shot. Emitting
        // normal is cross(edge1, edge2) = (0, −1, 0).
        {
            kind: 'quad',
            corner: [-2.0, 2.7, -1.6], edge1: [4.0, 0, 0], edge2: [0, 0, 2.0],
            emission: [1.9, 2.05, 2.5],
        },
    ],
    environment: { type: 'constant', color: [0.010, 0.012, 0.018], intensity: 1.0 },
};

const camera = { type: 'pinhole' as const, fov: 0.72 };

export const porcelainStrategy: RenderStrategy = {
    id: 'lanterns',
    measurement: { camera, maxBounces: 64 },
    estimator: {
        directLighting: 'mis',
        // startDepth 10 / maxSurvival 0.98, both deliberately above the defaults: a walk
        // through a few free paths of wall is TENS of events long, and a high-albedo path
        // barely dims, so with the usual settings roulette (rather than the throughput)
        // becomes the terminator and pays for each survivor with a compounding 1/p boost —
        // visible as fireflies. Letting the first 10 events run un-rouletted removes that
        // from exactly the depths this scene lives at. Unbiased either way; variance only.
        russianRoulette: { startDepth: 10, maxSurvival: 0.98 },
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

/** Scattering off: the porcelain becomes clear glass and the bulbs snap into view. */
export const porcelainNoScatterStrategy: RenderStrategy = {
    ...porcelainStrategy,
    id: 'noscatter',
    measurement: { camera, maxBounces: 64, scattering: 'ignored' },
};

/** No NEE: every wall vertex has to find a bulb by chance. */
export const porcelainPtStrategy: RenderStrategy = {
    ...porcelainStrategy,
    id: 'lanterns-pt',
    estimator: { ...porcelainStrategy.estimator, directLighting: 'none' },
};
