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
    /** The field, self-contained GLSL: `float <name>_sdf(vec3 p, <Struct> s) { … }`
     *  plus optional file-private prefixed helpers. Marching/normal are GENERATED —
     *  defining them here is rejected. */
    glsl: string;
    /** The CPU twin of the field — same math, same constants, same operator order. */
    field(p: number[], values: PrimitiveValues): number;
    /** The declared bound (never inferred): a registry analytic primitive whose
     *  parameters derive from this field's values, or an explicit 'unbounded'.
     *  ('self' is meaningless here — a scene-local field has no analytic form.) */
    marchBound: 'unbounded' | { type: string; values(v: PrimitiveValues): PrimitiveValues };
    /** Per-shape march step budget (default: the global MAX_MARCH_STEPS). */
    stepBudget?: number;
    /** Lipschitz factor for estimate-valued fields (default 1 — conservative). */
    lipschitz?: number;
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
        if (existing.local === true && existing.glsl === spec.glsl && rowsKey(existing.params) === rowsKey(spec.params)) {
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
    if (spec.glsl.includes('__')) {
        throw new Error(`defineSDF('${name}'): '__' is reserved in GLSL identifiers (ANGLE rejects it)`);
    }
    if (!new RegExp(`float\\s+${name}_sdf\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${structName}\\b`).test(spec.glsl)) {
        throw new Error(`defineSDF('${name}'): glsl must define float ${name}_sdf(vec3 p, ${structName} s)`);
    }
    if (new RegExp(`${name}_sdf_(intersect|normal|refine)\\s*\\(`).test(spec.glsl)) {
        throw new Error(`defineSDF('${name}'): ${name}_sdf_intersect / ${name}_sdf_normal / ${name}_sdf_refine are GENERATED (fable-sdf-contract §4) — delete the hand copies`);
    }
    if (spec.uvChart === true && !new RegExp(`vec2\\s+${name}_uv\\s*\\(\\s*vec3\\s+\\w+\\s*,\\s*${structName}\\b`).test(spec.glsl)) {
        throw new Error(`defineSDF('${name}'): uvChart declared but glsl does not define vec2 ${name}_uv(vec3 p, ${structName} s)`);
    }

    // --- the bound (declared, never inferred; resolvable at definition time) ------
    const mb = spec.marchBound;
    if (mb !== 'unbounded') {
        const bd = PRIMITIVES[mb.type];
        if (bd === undefined || !bd.provides.analytic || BOUND_FIELDS[mb.type] === undefined) {
            throw new Error(`defineSDF('${name}'): marchBound type '${mb.type}' must be a registry analytic bounding primitive (${Object.keys(BOUND_FIELDS).join(', ')})`);
        }
    }
    if (typeof spec.field !== 'function') {
        throw new Error(`defineSDF('${name}'): the TS field twin is required — it is what makes the declared bound CHECKED (the Validator samples it per authored object)`);
    }

    registerLocal(spec, structName);
    return name;
}

function registerLocal(spec: SceneSDFSpec, _structName: string): void {
    const d: PrimitiveDescriptor = {
        type: spec.name,
        params: spec.params,
        glsl: spec.glsl,
        provides: { sdf: true, analytic: false },
        similarityClosed: false,
        marchBound: spec.marchBound,
        ...(spec.stepBudget !== undefined ? { stepBudget: spec.stepBudget } : {}),
        ...(spec.lipschitz !== undefined ? { lipschitz: spec.lipschitz } : {}),
        ...(spec.refine !== undefined ? { refine: spec.refine } : {}),
        ...(spec.uvChart === true ? { uvChart: true } : {}),
        local: true,
        fieldTwin: spec.field,
    };
    PRIMITIVES[spec.name] = d;
}
