// components/tonemap/index.ts
// Tonemap registry (view pick-one family — the display transfer / tone curve axis).
// A tonemap occupant = one folder (a `vec3 <id>_curve(vec3)` GLSL + this descriptor) +
// one line below. The Generator's display pass (ShaderBuilder.buildDisplayBlocks) owns
// the SHARED glue — exposure, safe_color, the sRGB OETF, and the composed main() — and
// calls the occupant's curve. Adding a tonemapper touches nothing but its folder and the
// TONEMAP_MODELS line (+ the Validator allowlist until every declared type is built).
//
// Descriptors declare FACTS about one curve (its GLSL + whether it encodes to display);
// they never reference the plan or other descriptors (components purity). TonemapDescriptor
// is a pick-one shape, so it lives here with the registry (the camera/sampler precedent).

import type { TonemapDesc } from '../../compiler/plan/types.js';

import { noneDescriptor } from './none/none.js';
import { reinhardDescriptor } from './reinhard/reinhard.js';
import { acesDescriptor } from './aces/aces.js';
import { agxDescriptor } from './agx/agx.js';
import { khronosDescriptor } from './khronos/khronos.js';
import { hableDescriptor } from './hable/hable.js';
import { gtDescriptor } from './gt/gt.js';

export type TonemapType = TonemapDesc['type'];

export interface TonemapDescriptor {
    type: TonemapType;
    /** ?raw source providing `vec3 <curveFn>(vec3 x)` — HDR-linear → display-linear [0,1]. */
    glsl: string;
    /** Provenance origin string for source maps (the occupant's path). */
    origin: string;
    /** The curve function name the generated display main() calls. */
    curveFn: string;
    /** true  → apply the curve, then sRGB-encode + clamp (the display/PNG path).
     *  false → raw linear passthrough: identity curve, NO sRGB encode, exposure forced
     *          to 1.0 — what the §11 on-screen radiance probes need. */
    encodesToDisplay: boolean;
}

/** Partial by shape: a TonemapDesc type is LIVE iff it appears here. The Validator gates
 *  `view.tonemap.type` against these keys (registry-driven — adding a curve here is the
 *  ONLY wiring, no separate allowlist to sync). */
export const TONEMAP_MODELS: Partial<Record<TonemapType, TonemapDescriptor>> = {
    none: noneDescriptor,
    reinhard: reinhardDescriptor,
    aces: acesDescriptor,
    agx: agxDescriptor,
    khronos: khronosDescriptor,
    hable: hableDescriptor,
    gt: gtDescriptor,
};

/** True iff the tonemap type has a live occupant — the Validator's gate. */
export function isTonemapSupported(type: TonemapType): boolean {
    return TONEMAP_MODELS[type] !== undefined;
}

/** Lookup that throws on an unregistered type — the Validator rejects them upstream, so
 *  this is an unreachable backstop, not a diagnostic (the camera-family precedent). */
export function tonemapModel(type: TonemapType): TonemapDescriptor {
    const d = TONEMAP_MODELS[type];
    if (!d) throw new Error(`tonemap type '${type}' has no descriptor (Validator should have rejected it)`);
    return d;
}
