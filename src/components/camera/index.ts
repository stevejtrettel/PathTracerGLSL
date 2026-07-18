// components/camera/index.ts
// Camera-model registry (measurement pick-one family — the WHICH-integral axis).
// A camera occupant = one folder (camera_generateRay GLSL + this descriptor) + one line
// below. The compiler's camera feature (generate/features/camera.ts) owns the SHARED
// plumbing — the CPU-computed basis + position/imageSize/aspect uniforms and, for the
// perspective cameras, u_tanFov (= tan(fov/2)) — and mints each model's declared CONTROLS
// and DERIVED values through one path. Adding a camera touches nothing but its folder and
// the CAMERA_MODELS line.
//
// Descriptors declare FACTS about one model (its GLSL + its unique controls/derived values);
// they never reference the plan or other descriptors (the components purity rule + the
// module-anatomy guardrail). CameraModelDescriptor is a pick-one shape, so it lives here
// with the registry (the sampler-family precedent), not in components/descriptors.ts.
//
// ── CONTROL vs DERIVED (the control/shader-surface split) ────────────────────────────────
// A camera exposes two surfaces. A CONTROL is what the USER drives — a slider on a parameter
// path. A DERIVED value is what the SHADER reads — a uniform, either a control read RAW
// (pass-through) or a pure FUNCTION of controls (+ engine builtins). The camera is the
// measuring instrument, so every input is always live: a derived value is ALWAYS a uniform,
// computed on the CPU (per frame; never per ray). This is the slot that lets a descriptor
// precompute a projection constant (fisheye's u_fisheyeK, cylindrical's u_cylFocal) instead
// of leaking transcendentals to the GPU — the same rail the shared u_tanFov rides.

import type { CameraType } from '../../compiler/types.js';
import type { CameraDesc } from '../../compiler/plan/types.js';

import { pinholeDescriptor } from './pinhole/pinhole.js';
import { thinlensDescriptor } from './thinlens/thinlens.js';
import { equirectDescriptor } from './equirect/equirect.js';
import { orthographicDescriptor } from './orthographic/orthographic.js';
import { fisheyeDescriptor } from './fisheye/fisheye.js';
import { cylindricalDescriptor } from './cylindrical/cylindrical.js';

/** A camera CONTROL — the authored/driven surface: a UI slider on a parameter path. Its
 *  default seeds any derived shader values; its metadata builds the panel. A control MAY be
 *  read RAW by the shader (pass-through: give `uniform`, the identity arrow), or exist only
 *  to feed `derived` values (e.g. fisheye fov → u_fisheyeK, never read raw). Every control is
 *  a live parameter that triggers accumulation reset — it changes the INTEGRAL (measurement
 *  §6.2). */
export interface CameraControl {
    /** Dotted parameter path, e.g. 'camera.aperture'. */
    path: string;
    /** UI label. */
    name: string;
    default: number;
    range?: [number, number];
    /** If set, the shader reads this control RAW under this uniform name (a plain
     *  pass-through). Omit when the control only feeds `derived` values. */
    uniform?: string;
}

/** A camera DERIVED shader value — the uniform surface, computed host-side from control
 *  inputs (and/or engine builtins like 'engine.imageSize') by a pure fn. Always lands as a
 *  uniform (the instrument principle: every input is live), recomputed on the CPU per frame,
 *  never per ray on the GPU. The framework calls `fn` for BOTH the plan-time default and the
 *  per-frame value, so the two can never drift. */
export interface CameraDerived {
    /** GLSL uniform name, e.g. 'u_fisheyeK'. */
    uniform: string;
    type: 'float' | 'vec2' | 'vec3';
    /** Parameter paths this value depends on — control paths and/or engine builtins. Index 0
     *  is the binding's primary path; `fn` receives them all, keyed by path. */
    inputs: string[];
    /** Pure derivation. `resolved[path]` is each input's value: control inputs are always
     *  present (their store value, or default at plan time); engine builtins may be absent at
     *  plan time (guard with `?? fallback`, as u_aspect does). Returns the uniform's value. */
    fn(resolved: Record<string, number | number[]>): number | number[];
}

export interface CameraModelDescriptor {
    type: CameraType;
    /** ?raw source providing `Ray camera_generateRay(vec2 film, vec2 xiLens)`. */
    glsl: string;
    /** Provenance origin string for source maps (the occupant's path). */
    origin: string;
    /** Model-unique controls (sliders). Omit for parameterless cameras (pinhole/equirect);
     *  the shared perspective fov is minted by the feature, not declared here. */
    controls?(cam: CameraDesc): CameraControl[];
    /** Model-unique derived shader values (precomputed uniforms). Omit when none. */
    derived?(cam: CameraDesc): CameraDerived[];
    /** Model-unique compile-time #defines — for selecting a PROJECTION VARIANT (fisheye
     *  aliases FISHEYE_THETA to the radial-map function its `projection` picks). This is
     *  the STRUCTURAL axis: the projection type is part of the integral, so it recompiles —
     *  distinct from the NUMERIC camera controls (fov/aperture/…), which are always uniforms. */
    defines?(cam: CameraDesc): Record<string, string>;
}

export const CAMERA_MODELS: Record<CameraType, CameraModelDescriptor | undefined> = {
    pinhole: pinholeDescriptor,
    thinlens: thinlensDescriptor,
    equirect: equirectDescriptor,
    orthographic: orthographicDescriptor,
    fisheye: fisheyeDescriptor,
    cylindrical: cylindricalDescriptor,
};

/** Lookup that throws on unregistered types — the Validator rejects them upstream
 *  (reject-not-remove), so this is an unreachable backstop, not a diagnostic. */
export function cameraModel(type: CameraType): CameraModelDescriptor {
    const d = CAMERA_MODELS[type];
    if (!d) throw new Error(`camera type '${type}' has no descriptor (Validator should have rejected it)`);
    return d;
}
