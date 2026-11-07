// compiler/analyze/quotient.ts
// The Validator's rules for a quotient space (scene.ambientSpace.quotient; components/quotient).
// The scene is one copy inside the fundamental domain D, and the walk queries that copy in every
// cell a ray crosses, so the lifted scene must be invariant under the group and every object must
// be found in D; NEE samples a finite table of light images, so every image a BSDF ray can reach
// outside the table must be found by BSDF sampling alone (partition MIS). Each rule below is one
// of those conditions.

import type { SceneDescription, RenderStrategy, ObjectDescription, Vec3, Transform, PrimitiveObject, MeshObject } from '../types.js';
import { isInstancedObject, isMeshObject, isPrimitiveObject, isValueParam, isHeterogeneousMedium, mediumIsDeflecting } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { QUOTIENTS, type QuotientDescriptor } from '../../components/quotient/index.js';
import { LIGHT_KINDS, applyAuthoredDefaults } from '../../components/lights/index.js';
import { primitiveBounds, primitiveBallBound } from '../../components/geometry/index.js';
import { similarityFromTransform, isDrivenTransform, isIdentityRotation, similarityApplyPoint, type Similarity } from '../../components/geometry/similarity.js';
import { transformAABB, type AABB } from '../../components/accel/bvh/bvh.js';
import { instanceWorldBoxes } from '../../components/intersection/instancing/instancing.js';
import { emissionMayBeNonzero } from '../../components/color/values.js';
import { curvedGeometryOf } from '../../components/ambient/index.js';
import { ORIGIN, mat4Apply, type CurvedGeometry, type Vec4 } from '../../components/ambient/isometry.js';
import { curvedConstantPlacement } from '../plan/curved.js';
import mathGLSL from '../../glsl/core/math.glsl?raw';

/** m: how far inside D's faces every object must stay — the §4.2 classification probe depth
 *  EPS_INTERFACE (core math), so that rounding never moves a hit, or the probe beside it,
 *  across a face of D. */
export const QUOTIENT_MARGIN = Number(/#define\s+EPS_INTERFACE\s+([0-9.eE+-]+)/.exec(mathGLSL)![1]);

export function validateQuotient(scene: SceneDescription, strategy: RenderStrategy, bag: DiagnosticBag): void {
    const q = scene.ambientSpace.quotient;
    if (q === undefined) return;
    const d = QUOTIENTS[q.kind];
    if (d === undefined) {
        bag.error('invalid-setting', `ambientSpace.quotient: unknown kind '${q.kind}' (registered: ${Object.keys(QUOTIENTS).join(', ')})`).add();
        return;
    }
    if (d.space !== scene.ambientSpace.type) {
        bag.error('invalid-setting', `ambientSpace.quotient '${q.kind}' acts on the ${d.space} space, not '${scene.ambientSpace.type}'`).add();
        return;
    }
    if (q.kind === 'torus') {
        const size = q.size;
        if (!Array.isArray(size) || size.length !== 3 || size.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
            bag.error('invalid-setting', `ambientSpace.quotient.size must be three finite periods > 0 (got ${JSON.stringify(size)})`).add();
            return;
        }
    }
    const label = `quotient '${q.kind}'`;

    // One far clip for every segment, and every image in the NEE table within it of every
    // vertex (vertices lie in D up to rounding, and emitters inside D by m).
    const farClip = strategy.measurement.farClip;
    const floor = d.farClipFloor(q);
    if (farClip === undefined) {
        bag.error('invalid-setting', `${label}: measurement.farClip is required — nothing escapes a closed manifold, so the far clip is where a segment that meets nothing ends; it must be at least ${floor.formula} = ${floor.value.toPrecision(4)}`).add();
    } else if (typeof farClip === 'number' && farClip < floor.value) {
        bag.error('invalid-setting', `${label}: measurement.farClip ${farClip} is below ${floor.formula} = ${floor.value.toPrecision(4)} — a BSDF ray must be able to reach every light image NEE samples`).add();
    }

    // BSDF rays never hit a delta light, so its images outside the NEE table would be lost.
    // Every other light must lie inside D, so that each of its images is one copy.
    const placement = placementRules(scene, d);
    scene.lights.forEach((light, i) => {
        const k = LIGHT_KINDS[light.kind];
        if (k === undefined) return;   // the light rules report it
        if (k.delta) {
            bag.error('invalid-setting', `${label}: light ${i} (${light.kind}) is a delta light — BSDF sampling cannot find its images outside NEE's table; use a small sphere or disk light`).add();
            return;
        }
        if (k.region === undefined) {
            bag.error('invalid-setting', `${label}: light ${i} (${light.kind}) has no geometry to place inside D`).add();
            return;
        }
        const a = applyAuthoredDefaults(k, light as unknown as Record<string, unknown>);
        if (Object.values(a).some((v) => isValueParam(v) && v !== light.emission)) {
            bag.error('invalid-setting', `${label}: light ${i} (${light.kind}) has driven geometry — it needs a compile-time bound inside D`).add();
            return;
        }
        if (placement.lightInside(k.region.primitive, k.region.parameters(a) as Record<string, number | number[]>) === false) {
            bag.error('invalid-setting', `${label}: light ${i} (${light.kind}) is not inside D by ${QUOTIENT_MARGIN} — each light image must be one copy of a light in D`).add();
        }
    });

    const env = scene.environment?.type ?? 'none';
    if (env !== 'none') {
        bag.error('invalid-setting', `${label}: environment '${env}' — a closed manifold has no sky; light leaves only by absorption`).add();
    }

    // Media: at most a homogeneous ambient fog, where the occupant supports one. Its coefficients
    // are the same at every point, so the medium arms need no position in D, and with no medium
    // boundary the walk carries no medium state across cells; the transport loop reduces medium
    // event points into D. A heterogeneous fog would need its density read at reduced points
    // along the segment, and a medium inside an object (null interfaces, GRIN, glass interiors)
    // region state across faces.
    const usedMaterials = new Set(scene.objects.map((o) => (isInstancedObject(o) ? o.prototype.material : o.material)));
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.medium === undefined) continue;
        if (name !== scene.ambientMedium || usedMaterials.has(name)) {
            bag.error('invalid-setting', `${label}: material '${name}' has a medium (only a homogeneous ambientMedium is supported in a quotient; media inside objects, null interfaces and GRIN are not)`).add();
        } else if (!d.ambientFog) {
            bag.error('invalid-setting', `${label}: ambientMedium '${name}' — no fog is supported in this quotient (its walk carries no medium state across faces)`).add();
        } else if (mediumIsDeflecting(mat.medium)) {
            bag.error('invalid-setting', `${label}: ambientMedium '${name}' is a gradient-index (GRIN) medium — only a homogeneous fog is supported in a quotient`).add();
        } else if (isHeterogeneousMedium(mat.medium)) {
            bag.error('invalid-setting', `${label}: ambientMedium '${name}' is heterogeneous (an expression coefficient) — only a homogeneous fog is supported in a quotient`).add();
        }
    }
    // Equiangular placement reads the light's own position: it samples no image of the light,
    // so in a quotient it would miss every image but the one in D. (It also needs delta lights,
    // which a quotient rejects; this rule states the reason of its own.)
    if (strategy.estimator.mediumLightSampling === 'equiangular') {
        bag.error('invalid-setting', `${label}: mediumLightSampling 'equiangular' is not supported in a quotient — it places the medium vertex by the light's position in D, not by the light's images; use 'vertex'`).add();
    }

    scene.objects.forEach((obj, i) => placement.object(obj, `${label}: object ${i}${obj.name !== undefined ? ` ('${obj.name}')` : ''}`, emitterMaterial(scene, obj), bag));
}

/** How a quotient checks that the scene lies in D: world boxes for a torus, geodesic balls for a
 *  group acting on a curved space. `lightInside` answers for a light's backing primitive (null:
 *  no bound to check, left to other rules); `object` reports an object's errors. */
interface PlacementRules {
    lightInside(primitive: string, parameters: Record<string, number | number[]>): boolean | null;
    object(obj: ObjectDescription, at: string, emits: boolean, bag: DiagnosticBag): void;
}

function placementRules(scene: SceneDescription, d: QuotientDescriptor): PlacementRules {
    const q = scene.ambientSpace.quotient!;
    const geom = curvedGeometryOf(d.space);
    if (q.kind === 'torus') return torusPlacement(q.size);
    if (d.ballInside === undefined || geom === undefined) throw new Error(`quotient '${q.kind}' declares no placement test`);
    return ballPlacement(geom, d.ballInside);
}

/** A torus: every object's world box inside [−L/2 + m, L/2 − m] on every axis, or an unrotated
 *  box spanning whole periods on some axes (a wall or a beam, lattice-invariant along them);
 *  emitters strictly inside, so each image is one translate. */
function torusPlacement(size: Vec3): PlacementRules {
    const m = QUOTIENT_MARGIN;
    return {
        lightInside: (primitive, parameters) => {
            const box = primitiveBounds(primitive, parameters);
            return box === null ? null : insideD(box, size, m);
        },
        object: (obj, at, emits, bag) => {
            const placed = objectBox(obj);
            if (placed === 'driven') {
                bag.error('invalid-setting', `${at} has a driven placement or parameter — it needs a compile-time bound inside D`).add();
                return;
            }
            if (placed === 'unbounded') {
                bag.error('invalid-setting', `${at} is unbounded — a half-space or unbounded shape is not lattice-invariant`).add();
                return;
            }
            if (placed === 'invalid') return;   // its own rules report it
            const { box, spanAllowed } = placed;
            const axes = [0, 1, 2].map((a) => axisFit(box, a, size[a], m));
            if (axes.every((f) => f === 'inside')) return;
            if (emits) {
                bag.error('invalid-setting', `${at} emits but is not inside D by ${m} — each light image must be one translate of an emitter in D`).add();
                return;
            }
            if (spanAllowed && axes.every((f) => f !== 'neither')) return;
            bag.error('invalid-setting', `${at} crosses a face of D (its box must lie inside [−L/2 + ${m}, L/2 − ${m}] on every axis${spanAllowed ? ', or span [−L/2 − m, L/2 + m] on an axis' : ''}; only an unrotated box may span whole periods)`).add();
        },
    };
}

/** A group acting on a curved space: every object's and light's bounding ball (its center g·o,
 *  g its placement isometry, and the shape's ballBound) inside D by m. No exception for objects
 *  that span faces (they would need copies on both sides), and no unbounded shapes. */
function ballPlacement(geom: CurvedGeometry, ballInside: (c: Vec4, r: number) => boolean): PlacementRules {
    const m = QUOTIENT_MARGIN;
    // The ball about g·o: the shape sits at o with its canonical rows, placed by g (a light's
    // backing primitive by its point row alone, as curvedLightWorld places the light).
    const ball = (type: string, parameters: Record<string, number | number[]>, transform: Transform | undefined): { c: Vec4; r: number } | null => {
        const { parameters: canonical, g } = curvedConstantPlacement(geom, type, parameters, transform);
        const r = primitiveBallBound(type, canonical);
        return r === null ? null : { c: mat4Apply(g, ORIGIN), r };
    };
    return {
        lightInside: (primitive, parameters) => {
            const b = ball(primitive, parameters, undefined);
            return b === null ? null : ballInside(b.c, b.r + m);
        },
        object: (obj, at, _emits, bag) => {
            if (!isPrimitiveObject(obj)) return;   // meshes and instances: the curved-space rules report them
            if (isDrivenTransform(obj.transform) || hasDrivenParameter(obj)) {
                bag.error('invalid-setting', `${at} has a driven placement or parameter — it needs a compile-time bound inside D`).add();
                return;
            }
            if (primitiveBounds(obj.type, obj.parameters) === null) {
                bag.error('invalid-setting', `${at} is unbounded — a half-space or unbounded shape is not invariant under the group`).add();
                return;
            }
            const b = ball(obj.type, obj.parameters as Record<string, number | number[]>, obj.transform);
            if (b === null) return;   // no curved body: the space gate reports it
            if (!ballInside(b.c, b.r + m)) {
                bag.error('invalid-setting', `${at} crosses a face of D (its bounding ball, radius ${b.r}, must lie inside D by ${m}; objects spanning faces need copies on both sides, which a quotient does not make)`).add();
            }
        },
    };
}

function insideD(box: AABB, size: Vec3, m: number): boolean {
    return [0, 1, 2].every((a) => axisFit(box, a, size[a], m) === 'inside');
}

/** Where a box sits on one axis of D: inside [−L/2 + m, L/2 − m], spanning [−L/2 − m, L/2 + m]. */
function axisFit(box: AABB, a: number, L: number, m: number): 'inside' | 'spans' | 'neither' {
    if (box.min[a] >= -L / 2 + m && box.max[a] <= L / 2 - m) return 'inside';
    if (box.min[a] <= -L / 2 - m && box.max[a] >= L / 2 + m) return 'spans';
    return 'neither';
}

function emitterMaterial(scene: SceneDescription, obj: ObjectDescription): boolean {
    const name = isInstancedObject(obj) ? obj.prototype.material : obj.material;
    const mat = scene.materials[name];
    return mat !== undefined && mat.emission !== undefined && emissionMayBeNonzero(mat.emission);
}

const hasDrivenParameter = (o: PrimitiveObject): boolean =>
    Object.values(o.parameters).some((v) => typeof v !== 'number' && !(Array.isArray(v) && v.every((x) => typeof x === 'number')));

/** The local box of a primitive or a mesh (`positions`), or why there is none. */
function localBox(o: PrimitiveObject | MeshObject): AABB | 'driven' | 'unbounded' | 'invalid' {
    if (isMeshObject(o)) {
        const p = o.positions;
        if (!(p instanceof Float32Array) || p.length < 3) return 'invalid';
        const box: AABB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let i = 0; i + 2 < p.length; i += 3) {
            for (let a = 0; a < 3; a++) {
                box.min[a] = Math.min(box.min[a], p[i + a]);
                box.max[a] = Math.max(box.max[a], p[i + a]);
            }
        }
        return box;
    }
    if (hasDrivenParameter(o)) return 'driven';
    const box = primitiveBounds(o.type, o.parameters);
    return box === null ? 'unbounded' : box;
}

/** An object's world box, and whether it may span whole periods (an unrotated box primitive). */
function objectBox(obj: ObjectDescription): { box: AABB; spanAllowed: boolean } | 'driven' | 'unbounded' | 'invalid' {
    if (isInstancedObject(obj)) {
        const local = localBox(obj.prototype);
        if (typeof local === 'string') return local;
        let placements: Similarity[] | Exclude<typeof obj.placements, Transform[]>;
        if (Array.isArray(obj.placements)) {
            if (obj.placements.some((t) => isDrivenTransform(t))) return 'driven';
            placements = obj.placements.map((t) => similarityFromTransform(t));
        } else {
            placements = obj.placements;
        }
        const boxes = instanceWorldBoxes(local, placements);
        const box: AABB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let i = 0; i < boxes.length; i += 6) {
            for (let a = 0; a < 3; a++) {
                box.min[a] = Math.min(box.min[a], boxes[i + a]);
                box.max[a] = Math.max(box.max[a], boxes[i + 3 + a]);
            }
        }
        return { box, spanAllowed: false };
    }
    if (isDrivenTransform(obj.transform)) return 'driven';
    const local = localBox(obj);
    if (typeof local === 'string') return local;
    const g = similarityFromTransform(obj.transform);
    const box = transformAABB(local, (p) => similarityApplyPoint(g, p));
    const spanAllowed = !isMeshObject(obj) && obj.type === 'box' && isIdentityRotation(g.rotation);
    return { box, spanAllowed };
}
