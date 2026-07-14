// components/camera/index.ts
// Camera-model registry (measurement pick-one family — the WHICH-integral axis).
// A camera occupant = one folder (camera_generateRay GLSL + this descriptor) + one line
// below. The compiler's camera feature (generate/features/camera.ts) owns the SHARED
// plumbing — position/target/imageSize uniforms, the fov Value<number> → TAN_FOV block,
// the film sample stream — and merges each model's declared extras. Adding a camera
// touches nothing but its folder and the CAMERA_MODELS line.
//
// Descriptors declare FACTS about one model (its GLSL + its unique scalar params); they
// never reference the plan or other descriptors (the components purity rule + the
// module-anatomy guardrail). CameraModelDescriptor is a pick-one shape, so it lives here
// with the registry (the sampler-family precedent), not in components/descriptors.ts.

import type { CameraType } from '../../compiler/types.js';
import type { CameraDesc } from '../../compiler/plan/types.js';

import { pinholeDescriptor } from './pinhole/pinhole.js';
import { thinlensDescriptor } from './thinlens/thinlens.js';
import { equirectDescriptor } from './equirect/equirect.js';
import { orthographicDescriptor } from './orthographic/orthographic.js';
import { fisheyeDescriptor } from './fisheye/fisheye.js';
import { cylindricalDescriptor } from './cylindrical/cylindrical.js';

/** A model-unique live uniform (thin-lens aperture/focusDistance). Always a slider that
 *  triggers accumulation reset — these change the INTEGRAL (measurement §6.2). fov is NOT
 *  here: it is shared across projective cameras and handled in the feature (the Value<T>
 *  const-bakes-to-define path). */
export interface CameraParam {
    /** GLSL uniform name, e.g. 'u_aperture'. */
    uniform: string;
    /** Parameter path, e.g. 'camera.aperture'. */
    path: string;
    /** UI label. */
    name: string;
    default: number;
    range?: [number, number];
}

export interface CameraModelDescriptor {
    type: CameraType;
    /** ?raw source providing `Ray camera_generateRay(vec2 film, vec2 xiLens)`. */
    glsl: string;
    /** Provenance origin string for source maps (the occupant's path). */
    origin: string;
    /** Model-unique scalar params read from the camera desc (empty for pinhole). */
    params(cam: CameraDesc): CameraParam[];
    /** Model-unique compile-time #defines — the same value-define mechanism as TAN_FOV
     *  (a literal or an alias, NOT structural gating). fisheye uses it to alias
     *  FISHEYE_THETA to the one radial-map function its `projection` selects. */
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
