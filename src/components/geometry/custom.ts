// Scene-local SDF fields (fable-sdf-contract §5.2) — the ZERO-CEREMONY door.
//
// A registry shape is a folder + descriptor + registry line: right for a reusable,
// parameterized shape, heavy for "the surface I invented for this one image". This
// module lets a scene define such a field where it is used — ONE call, self-contained
// in the scene file — and the compiler generates everything else exactly as it does
// for registry shapes (struct, ctor, march loop, gradient normal, containment,
// placement, derived AABB). Written once, used once, deleted with its scene.
//
// The contract is the SAME contract:
//   · the field is CANONICAL (origin-centred; position/rotation/scale are placement's
//     alone — point rows are rejected here);
//   · every declaration is CHECKED: definition-time checks live below (symbols, rows,
//     bound resolvability), and the Validator samples the definition's own TS twin
//     against the declared bound over each authored object's RESOLVED values, so a
//     bound that clips is a compile error, never a silently chopped render.
//
// The twin is the price of honesty: the GLSL cannot run on the CPU, so the bound gate
// needs the same math in TS. It is also what MEASURES a bound when no closed form
// exists (the knob recipe). Keep it transcribed, not re-derived.

import type { PrimitiveDescriptor, PrimitiveParamSpec, PrimitiveValues } from '../descriptors.js';
import { PRIMITIVES } from './index.js';
import { BOUND_FIELDS } from './boundCheck.js';

export interface SceneSDFSpec {
    /** The type name — becomes the object `type`, the GLSL symbol prefix
     *  (`<name>_sdf`) and the struct name (capitalized). Lower-camel identifier. */
    name: string;
    /** Parameter rows (fable-sdf-contract §3). At least one (a zero-field GLSL struct
     *  is illegal); `point` rows are rejected — a scene-local field is CANONICAL. */
    params: PrimitiveParamSpec[];
    /** The field, self-contained GLSL, per space. A string is the Euclidean body,
     *  `float <name>_sdf(vec3 p, <Struct> s) { … }`, plus optional file-private prefixed helpers.
     *  A record keys bodies by space (`euclidean`, `hyperbolic`, `spherical`); a curved body is
     *  `float <name>_sdf(Point p, <Struct> s)` over a point p of the model (a vec4) in the
     *  object's frame, written with the curved SDF vocabulary (components/ambient/sdf.glsl and the
     *  occupants' sdf_plane / sdf_tube), so one source can serve both curved spaces. A field
     *  supports exactly the spaces it has a body for. Marching/normal are GENERATED — defining
     *  them here is rejected. */
    glsl: string | Partial<Record<SDFSpace, string>>;
    /** The Euclidean body also serves H³ through the Klein chart: the field is evaluated at
     *  k(p) = p.xyz/p.w of the object's frame, and the shape is the preimage of the Euclidean
     *  one (a chart radius r is a hyperbolic radius atanh r). Sound with no scale factor: the
     *  chart never stretches distance (|k(p) − k(q)| ≤ d(p, q)), so a 1-Lipschitz lower bound of
     *  Euclidean distance stays one of hyperbolic distance. It marches unbounded in H³, so the
     *  field must be such a lower bound everywhere in the open unit ball, not only inside its
     *  declared bound. An accepted hit's true residual can reach march_epsilon·cosh²ρ at
     *  distance ρ from the object's origin (declare `refine` with that factor if it matters). */
    kleinChart?: boolean;
    /** The CPU twin of the field — same math, same constants, same operator order.
     *  OPTIONAL (owner-decided Aug 11): WITH a twin, the Validator samples the
     *  declared bound against it at compile time, per object, at the authored values
     *  — a clipping bound is a compile error. WITHOUT one, the declared bound is
     *  TRUSTED: a too-small bound silently chops geometry with no error anywhere,
     *  which is exactly the failure the twin exists to catch. Omit for quick
     *  experiments; add the twin when the shape starts to matter. */
    field?(p: number[], values: PrimitiveValues): number;
    /** The declared bound (never inferred): a registry analytic primitive whose
     *  parameters derive from this field's values, or an explicit 'unbounded'.
     *  ('self' is meaningless here — a scene-local field has no analytic form.) */
    marchBound: 'unbounded' | { type: string; values(v: PrimitiveValues): PrimitiveValues };
    /** Per-shape march step budget (default: the global MAX_MARCH_STEPS). */
    stepBudget?: number;
    /** Hit-refinement conservatism factor (fable-sdf-contract §4): declare the
     *  worst-case ratio of true surface distance to the field's estimate near the
     *  surface, and accepted hits get sign-bracketed to the true crossing. ABSENT =
     *  no refinement, no cost (right for true distances and value/gradient
     *  estimates, whose residual is already ~march_epsilon). */
    refine?: number;
    /** Declares `vec2 <name>_uv(vec3 p, <Struct> s)` in the glsl. */
    uvChart?: boolean;
}

const IDENT = /^[a-z][a-zA-Z0-9]*$/;

/** The spaces a scene-local field may have a body for. */
export type SDFSpace = 'euclidean' | 'hyperbolic' | 'spherical';
const SDF_SPACES: readonly SDFSpace[] = ['euclidean', 'hyperbolic', 'spherical'];

/** The bodies of a spec, keyed by space (a string is the Euclidean body). */
function bodiesOf(spec: SceneSDFSpec): Partial<Record<SDFSpace, string>> {
    return typeof spec.glsl === 'string' ? { euclidean: spec.glsl } : spec.glsl;
}

/** The hyperbolic body of a Klein-chart field: the Euclidean body and its overload on points of
 *  the model (GLSL overloads on vec3 / vec4). */
function kleinBody(name: string, structName: string, euclidean: string): string {
    return `${euclidean}\n// The Klein chart k(p) = p.xyz/p.w of the object's frame (defineSDF kleinChart).\n`
        + `float ${name}_sdf(Point p, ${structName} s) {\n    return ${name}_sdf(p.xyz / p.w, s);\n}\n`;
}

const definitionKey = (spec: SceneSDFSpec): string => JSON.stringify([bodiesOf(spec), spec.kleinChart === true]);

const rowsKey = (params: PrimitiveParamSpec[]): string =>
    JSON.stringify(params.map((p) => [p.name, p.kind, p.shape, p.required, p.default ?? null]));

/**
 * Define a scene-local SDF field and register it for compilation. Returns the type
 * name, for use as the object `type` in the scene description.
 *
 * Re-defining the SAME name with the SAME glsl/rows is idempotent (module hot-reload
 * re-runs scene files); anything else — a registry name, or a different definition
 * under an existing name — throws at definition time, before a compile can confuse
 * two shapes.
 */
export function defineSDF(spec: SceneSDFSpec): string {
    const { name } = spec;
    if (!IDENT.test(name)) {
        throw new Error(`defineSDF('${name}'): name must be a lower-camel identifier (it becomes the GLSL symbol prefix and struct name)`);
    }
    const structName = name[0].toUpperCase() + name.slice(1);

    const existing = PRIMITIVES[name];
    if (existing !== undefined) {
        if (existing.local === true && LOCAL_KEYS.get(name) === definitionKey(spec) && rowsKey(existing.params) === rowsKey(spec.params)) {
            // Hot-reload of the defining module: same definition, refresh the closures.
            registerLocal(spec, structName);
            return name;
        }
        throw new Error(existing.local === true
            ? `defineSDF('${name}'): a DIFFERENT scene-local field is already registered under this name — scene-local names are global to the session, pick a distinct one`
            : `defineSDF('${name}'): collides with the registry primitive '${name}' — pick a distinct name`);
    }

    // --- rows (the contract-test rules, enforced at definition time) -------------
    if (spec.params.length === 0) {
        throw new Error(`defineSDF('${name}'): declare at least one parameter row (a zero-field GLSL struct is illegal — a 'size' length row is the usual minimum)`);
    }
    for (const row of spec.params) {
        if (!IDENT.test(row.name)) throw new Error(`defineSDF('${name}'): row '${row.name}' is not a lower-camel identifier`);
        if (row.kind === 'point') {
            throw new Error(`defineSDF('${name}'): row '${row.name}' is kind 'point' — scene-local fields are CANONICAL (fable-sdf-contract §2): author the field at the origin and place it with transform.position`);
        }
        if (row.required === (row.default !== undefined)) {
            throw new Error(`defineSDF('${name}'): row '${row.name}' must be required XOR carry a default`);
        }
        if ((row.kind === 'vector' || row.kind === 'direction') && row.shape !== 'vec3') {
            throw new Error(`defineSDF('${name}'): row '${row.name}' (${row.kind}) must be shape 'vec3'`);
        }
    }

    // --- glsl (the symbol contract, same regexes as the registry contract test) ---
    const bodies = bodiesOf(spec);
    const keys = Object.keys(bodies) as SDFSpace[];
    if (keys.length === 0 || keys.some((k) => !SDF_SPACES.includes(k))) {
        throw new Error(`defineSDF('${name}'): glsl must be a string (the Euclidean body) or a record of bodies keyed by ${SDF_SPACES.join(', ')}`);
    }
    for (const space of keys) {
        const src = bodies[space]!;
        const pointType = space === 'euclidean' ? 'vec3' : 'Point';
        if (src.includes('__')) {
            throw new Error(`defineSDF('${name}'): '__' is reserved in GLSL identifiers (ANGLE rejects it)`);
        }
        if (!new RegExp(`float\\s+${name}_sdf\\s*\\(\\s*${pointType}\\s+\\w+\\s*,\\s*${structName}\\b`).test(src)) {
            throw new Error(`defineSDF('${name}'): the ${space} body must define float ${name}_sdf(${pointType} p, ${structName} s)`);
        }
        if (new RegExp(`${name}_sdf_(intersect|refine)\\s*\\(`).test(src)) {
            throw new Error(`defineSDF('${name}'): ${name}_sdf_intersect / ${name}_sdf_refine are GENERATED (fable-sdf-contract §4) — delete the hand copies`);
        }
        // `<name>_sdf_normal` MAY be authored in a Euclidean body (experimental, scene-local
        // only): a value/gradient field knows its exact ∇f, and the generated 4-tap is a worse
        // estimate of it. Defining it there suppresses the generated one. Curved normals are
        // always generated.
        if (space !== 'euclidean' && new RegExp(`${name}_sdf_normal\\s*\\(`).test(src)) {
            throw new Error(`defineSDF('${name}'): the ${space} body defines ${name}_sdf_normal; curved normals are generated`);
        }
    }
    if (spec.uvChart === true && (bodies.euclidean === undefined || !new RegExp(`vec2\\s+${name}_uv\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${structName}\\b`).test(bodies.euclidean))) {
        throw new Error(`defineSDF('${name}'): uvChart declared but the Euclidean body does not define vec2 ${name}_uv(vec3 p, ${structName} s)`);
    }
    if (spec.kleinChart === true) {
        if (bodies.euclidean === undefined || bodies.hyperbolic !== undefined) {
            throw new Error(`defineSDF('${name}'): kleinChart serves H³ with the Euclidean body — give a Euclidean body and no hyperbolic one`);
        }
        if (new RegExp(`${name}_sdf_normal\\s*\\(`).test(bodies.euclidean)) {
            throw new Error(`defineSDF('${name}'): kleinChart with an authored ${name}_sdf_normal — the curved normal is generated`);
        }
    }

    // --- the bound (declared, never inferred; resolvable at definition time) ------
    const mb = spec.marchBound;
    if (mb !== 'unbounded') {
        const bd = PRIMITIVES[mb.type];
        if (bd === undefined || !bd.provides.analytic || BOUND_FIELDS[mb.type] === undefined) {
            throw new Error(`defineSDF('${name}'): marchBound type '${mb.type}' must be a registry analytic bounding primitive (${Object.keys(BOUND_FIELDS).join(', ')})`);
        }
    }
    registerLocal(spec, structName);
    return name;
}

/** The definition each registered scene-local name was made from (the hot-reload comparison). */
const LOCAL_KEYS = new Map<string, string>();

function registerLocal(spec: SceneSDFSpec, structName: string): void {
    // Each body is reported under the folder path a registry occupant of its name would have.
    const origin = (space: SDFSpace) => `components/geometry/${spec.name}/${spec.name}${space === 'euclidean' ? '' : `_${space}`}.glsl`;
    const bodies = bodiesOf(spec);
    const glsl: Record<string, { origin: string; source: string }> = {};
    for (const space of Object.keys(bodies) as SDFSpace[]) glsl[space] = { origin: origin(space), source: bodies[space]! };
    if (spec.kleinChart === true) glsl.hyperbolic = { origin: origin('hyperbolic'), source: kleinBody(spec.name, structName, bodies.euclidean!) };
    LOCAL_KEYS.set(spec.name, definitionKey(spec));
    const d: PrimitiveDescriptor = {
        type: spec.name,
        params: spec.params,
        glsl,
        provides: { sdf: true, analytic: false },
        similarityClosed: false,
        marchBound: spec.marchBound,
        ...(spec.stepBudget !== undefined ? { stepBudget: spec.stepBudget } : {}),
        ...(spec.refine !== undefined ? { refine: spec.refine } : {}),
        ...(spec.uvChart === true ? { uvChart: true } : {}),
        local: true,
        ...(spec.field !== undefined ? { fieldTwin: spec.field } : {}),
        ...(spec.kleinChart === true ? { kleinChart: true } : {}),
    };
    PRIMITIVES[spec.name] = d;
}
