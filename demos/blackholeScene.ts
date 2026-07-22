// demos/blackholeScene.ts — MAJUMDAR–PAPAPETROU BLACK HOLES IN A GLASS BLOCK.
// The idiomatic port of the reference PathTracer's `blackholeCube`/`blackholeMulti` scenes
// (PathTracer docs/curved-light-blackhole.md) onto this tracer's GRIN machinery.
//
// THE PHYSICS. Extremal charged black holes (charge = mass) sit in STATIC EQUILIBRIUM —
// electrostatic repulsion exactly cancels gravity — so any number of them can coexist at
// rest: that is what makes a multi-hole scene physical. The MP metric is
//     ds² = −U⁻² dt² + U² dl²,   U(r) = 1 + Σᵢ Mᵢ / |r − rᵢ|
// and Fermat turns its null rays into a graded-index medium with n = U² — conformally flat,
// exactly the deflecting-medium contract. n → 1 at infinity (the +1 matters); n → ∞ at each
// hole (the horizon is a POINT in these coordinates).
//
// THE OBJECT. A real glass block containing the field — a transformation-optics analog: a
// dielectric in flat space whose optics equal a black hole's, the hard wall an honest,
// self-consistent truncation of the (global) field. The wall's Snell/Fresnel reads the LOCAL
// field value at each hit point (ior_of(region, p) = the medium formula — the hard-interface
// batch), the interior integrates the ray ODE with the strong-field adaptive limiters, and
// the two shadows are PURE CAPTURE (n > GRIN_CAPTURE ⇒ the ray reached the horizon; well
// inside the photon sphere at r = M, so exact for the image) — dynamics, not drawn geometry.
// The field is authored SMOOTH past the wall (never clamped — the ∇n stencil samples it
// slightly outside; the region gate, not the formula, confines the bending).
//
// `bh.mass` is LIVE: drag it to 0 for a plain glass block (flat A/B baseline), up for
// stronger lensing until the shadows dominate. The TS twin (grin.test.ts) pins this exact
// field: Bouguer conserved through the flyby + the GR weak-field deflection 4M/b.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

const BLOCK_C: [number, number, number] = [0, 1.1, 0];
const BLOCK_H = 1.1;                                   // half-size — the block sits on the floor
const HOLE_A: [number, number, number] = [-0.45, 1.1, 0];
const HOLE_B: [number, number, number] = [0.45, 1.1, 0];

const v3 = (p: [number, number, number]) => `vec3(${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})`;
// U = 1 + M/r₁ + M/r₂ (r floored at the singular points — NaN guard), n = U².
const mpField =
    `pow(1.0 + u_bh_mass / max(length(p - ${v3(HOLE_A)}), 0.0001)` +
    ` + u_bh_mass / max(length(p - ${v3(HOLE_B)}), 0.0001), 2.0)`;

export const blackholeScene: SceneDescription = {
    id: 'blackhole',
    name: 'Majumdar–Papapetrou binary in a glass block',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'box', parameters: { center: BLOCK_C, halfSize: [BLOCK_H, BLOCK_H, BLOCK_H] }, material: 'block', name: 'block' },
    ],
    materials: {
        floor: { model: 'checker', albedo_a: [0.9, 0.35, 0.2], albedo_b: [0.12, 0.2, 0.5], uv_scale: 3 },
        // Dielectric wall + the MP field as the ONE ior truth: the wall refracts with the
        // local n(p) at every hit point, the interior bends by ∇n, the holes capture.
        block: {
            model: 'dielectric',
            medium: {
                ior: {
                    kind: 'glsl',
                    source: mpField,
                    params: [{ param: 'bh.mass', default: 0.15, min: 0.0, max: 0.35 }],
                },
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4.5, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
};

// pt (chance-hit): interior traversals, wall events, and TIR each consume a bounce;
// captured paths die by zero throughput + roulette.
export const blackholeStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.4 } },
        maxBounces: 24,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};
