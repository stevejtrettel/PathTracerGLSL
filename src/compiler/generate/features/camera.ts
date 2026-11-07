// compiler/generate/features/camera.ts
// Camera: the ray-generation snippet + its uniforms and UI parameters.
//
// THE CAMERA IS THE MEASURING DEVICE (measurement.camera), NOT part of the scene — so every
// NUMERIC camera control is ALWAYS a live uniform, never baked. You can adjust the instrument
// (pose, fov, aperture, focus) on any scene without a recompile; the constant-vs-driven Model B
// split that governs scene values does NOT apply here. What IS structural is the projection
// TYPE (pinhole vs a fisheye sub-projection) and the pupil's shape (the thin lens's blade count
// and orientation) — changing either changes the integral, so it recompiles (the descriptors'
// `defines`: fisheye's FISHEYE_THETA function selector, the thin lens's LENS_BLADES and
// LENS_BLADE_ROTATION).
//
// This feature owns the SHARED camera uniforms — the CPU-computed look-at frame (basis.ts),
// image size, aspect, and the perspective u_tanFov = tan(fov/2). Every OTHER model-unique
// CONTROL (a slider) and DERIVED value (a precomputed uniform) comes from the camera registry
// (components/camera/index.ts) and is minted through ONE rail below (mintControl/mintDerived) —
// the SAME rail the shared fov rides. The old bespoke fov `if`-block is gone: fov is now just a
// CameraControl feeding the u_tanFov CameraDerived. Adding a camera is one folder + one registry
// line, no edit here.

import { isValueParam, type Value } from '../../types.js';
import type { RenderPlan, PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { cameraModel, type CameraControl, type CameraDerived } from '../../../components/camera/index.js';
import { cameraBasis, curvedCameraBasis, type CurvedCameraBasis } from '../../../components/camera/basis.js';
import { curvedGeometryOf } from '../../../components/ambient/index.js';
import type { CurvedGeometry } from '../../../components/ambient/isometry.js';
import { QUOTIENTS } from '../../../components/quotient/index.js';
import { bodyFor } from '../../../components/descriptors.js';
import type { Vec3Tuple } from '../../../components/geometry/similarity.js';

/** Mint a control's slider (and, for a pass-through, its raw uniform). No derivation. */
function mintControl(c: CameraControl, uniforms: PlannedUniform[], parameters: Record<string, ParameterMetadata>): void {
    parameters[c.path] = {
        type: 'float', default: c.default, name: c.name, group: 'Camera', triggersReset: true,
        ...(c.range ? { range: c.range } : {}),
    };
    if (c.uniform) uniforms.push({ name: c.uniform, type: 'float', parameterPath: c.path, default: c.default });
}

/** Mint a derived value's uniform: ONE fn drives both the plan-time default and the per-frame
 *  compute closure (bake ≡ ship). `resolvedDefaults` holds the control inputs' defaults; engine
 *  builtins (absent here) fall back inside the fn. */
function mintDerived(d: CameraDerived, resolvedDefaults: Record<string, number | number[]>, uniforms: PlannedUniform[]): void {
    uniforms.push({
        name: d.uniform, type: d.type,
        parameterPath: d.inputs[0],
        ...(d.inputs.length > 1 ? { parameterPaths: d.inputs } : {}),
        default: d.fn(resolvedDefaults),
        compute: (p) => d.fn(p as Record<string, number | number[]>),
    });
}

/** The shared perspective fov (pinhole/thin-lens): a control at 'camera.fov' feeding
 *  u_tanFov = tan(fov/2). Resolves the authored `Value<number>` — a {param} fov keeps its
 *  slider path + range; a constant fov seeds the default. This is the sole `Value<>`-typed
 *  camera control, so its resolution stays feature-side (descriptors get resolved values). */
function perspectiveFov(fov: Value<number>): { control: CameraControl; tanFov: CameraDerived } {
    const driven = isValueParam(fov);
    const def = driven ? (fov.default ?? 0.8) : fov;
    const path = driven ? fov.param : 'camera.fov';   // 'camera.fov' = authored convention
    const control: CameraControl = {
        path, name: 'FOV', default: def,
        ...(driven && fov.min !== undefined && fov.max !== undefined ? { range: [fov.min, fov.max] } : {}),
    };
    const tanFov: CameraDerived = {
        uniform: 'u_tanFov', type: 'float', inputs: [path],
        fn: (v) => Math.tan(((v[path] as number) ?? def) / 2),
    };
    return { control, tanFov };
}

export function contributeCamera(plan: RenderPlan, _bag: DiagnosticBag): FeatureContribution {
    const cam = plan.program.measurement.camera;
    const model = cameraModel(cam.type);

    // Authored pose (CameraPose — measurement data) seeds the DEFAULTS of the
    // always-live camera.position/camera.target parameters; OrbitControls drives
    // the same paths, so orbiting never recompiles.
    const pose = { position: cam.position ?? [0, 0, 8], target: cam.target ?? [0, 0, 0] };

    // The look-at FRAME is derived ONCE on the CPU and shipped as three vec3 uniforms —
    // the occupants read u_cameraForward/Right/Up instead of rebuilding the frame (two
    // normalizes + two crosses) per ray. camera.position/target are always-live params
    // (OrbitControls), so each basis uniform recomputes via its closure on a pose change —
    // no recompile, and u_cameraTarget itself is no longer read by any shader (its role is
    // to feed these closures). u_cameraPosition survives as the perspective/ortho origin.
    // ONE basis computation shared by the three closures (they fire together each frame):
    // memoized on the pose values so a frame runs cameraBasis once, not once per vector.
    // In a curved space the frame is curvedCameraBasis's (the target-centered up rule) and all
    // four vectors are vec4: the camera point exp_o(position) and a tangent frame there.
    // In a quotient whose walk needs every ray to start in D (Seifert–Weber), the pose is then
    // moved into D by the group, its frame carried along (the occupant's reduceCamera).
    const geom = curvedGeometryOf(plan.program.measurement.ambient);
    const quotient = plan.program.measurement.quotient;
    const reduce = quotient !== undefined ? QUOTIENTS[quotient.kind]?.reduceCamera : undefined;
    const curvedFrame = (g: CurvedGeometry, position: Vec3Tuple, target: Vec3Tuple): CurvedCameraBasis => {
        const b = curvedCameraBasis(g, position, target);
        if (reduce === undefined) return b;
        const r = reduce(b.position, [b.forward, b.right, b.up]);
        return { position: r.point, forward: r.vectors[0], right: r.vectors[1], up: r.vectors[2] };
    };
    const frameOf = (position: Vec3Tuple, target: Vec3Tuple): Record<'position' | 'forward' | 'right' | 'up', number[]> =>
        geom !== undefined ? curvedFrame(geom, position, target) : { position, ...cameraBasis(position, target) };
    let memoKey = '';
    let memoBasis = frameOf(pose.position as Vec3Tuple, pose.target as Vec3Tuple);
    const basisFor = (position: Vec3Tuple, target: Vec3Tuple) => {
        const key = `${position.join(',')}|${target.join(',')}`;
        if (key !== memoKey) { memoKey = key; memoBasis = frameOf(position, target); }
        return memoBasis;
    };
    const vecType = geom !== undefined ? 'vec4' as const : 'vec3' as const;
    const basisUniform = (name: string, pick: (b: ReturnType<typeof frameOf>) => number[]) => ({
        name,
        type: vecType,
        parameterPath: 'camera.position',
        parameterPaths: ['camera.position', 'camera.target'],
        default: pick(basisFor(pose.position as Vec3Tuple, pose.target as Vec3Tuple)),
        compute: (params: Record<string, unknown>) => pick(basisFor(
            (params['camera.position'] as Vec3Tuple) ?? (pose.position as Vec3Tuple),
            (params['camera.target'] as Vec3Tuple) ?? (pose.target as Vec3Tuple),
        )),
    });

    const contribution: FeatureContribution = {
        ...emptyContribution('camera'),
        provides: [{ name: 'camera_generateRay', signature: 'Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl)' }],
        // The model's body for the program's space (its origin travels with it).
        blocks: [bodyFor(model.glsl, plan.program.measurement.ambient, `camera '${model.type}'`)],
        uniforms: [
            // The Euclidean camera point is camera.position itself; a curved one is exp_o of it.
            geom !== undefined
                ? basisUniform('u_cameraPosition', (b) => b.position)
                : { name: 'u_cameraPosition', type: 'vec3', parameterPath: 'camera.position', default: pose.position },
            basisUniform('u_cameraForward', (b) => b.forward),
            basisUniform('u_cameraRight', (b) => b.right),
            basisUniform('u_cameraUp', (b) => b.up),
            { name: 'u_imageSize', type: 'vec2', parameterPath: 'engine.imageSize' },
            // Aspect is DERIVED from the (frame-constant) image size — computed once on the CPU,
            // not per-ray in every camera. engine.imageSize flows into the compute-closure param
            // map exactly as it does for u_imageSize above.
            {
                name: 'u_aspect', type: 'float', parameterPath: 'engine.imageSize',
                compute: (params) => {
                    const s = params['engine.imageSize'] as number[] | undefined;
                    return s && s[1] !== 0 ? s[0] / s[1] : 1.0;
                },
            },
        ],
        parameters: {
            'camera.position': { type: 'vec3', default: pose.position, name: 'Position', group: 'Camera', triggersReset: true },
            'camera.target': { type: 'vec3', default: pose.target, name: 'Target', group: 'Camera', triggersReset: true },
        },
    };

    // Collect controls + derived values in emission order (perspective fov first — shared
    // plumbing owned by the feature because it is the sole Value<>-typed control; then the
    // model's own). resolvedDefaults feeds every derived fn's plan-time bake.
    const resolvedDefaults: Record<string, number | number[]> = {};

    // Shared perspective fov: control (camera.fov slider) + u_tanFov derived. Minted in this
    // order so u_tanFov precedes any model pass-through control uniforms (aperture/focus).
    if (cam.type === 'pinhole' || cam.type === 'thinlens') {
        const { control, tanFov } = perspectiveFov(cam.fov as Value<number>);   // D2: open record; fov keeps the Value<> spelling (slider range)
        mintControl(control, contribution.uniforms, contribution.parameters);
        resolvedDefaults[control.path] = control.default;
        mintDerived(tanFov, resolvedDefaults, contribution.uniforms);
    }

    // Model-unique controls (sliders / pass-through uniforms) then derived values.
    for (const c of model.controls?.(cam) ?? []) {
        mintControl(c, contribution.uniforms, contribution.parameters);
        resolvedDefaults[c.path] = c.default;
    }
    for (const d of model.derived?.(cam) ?? []) {
        mintDerived(d, resolvedDefaults, contribution.uniforms);
    }

    // Model-unique compile-time defines (fisheye's FISHEYE_THETA alias — the STRUCTURAL axis).
    Object.assign(contribution.defines, model.defines?.(cam) ?? {});

    return contribution;
}
