// compiler/plan/values.ts — resolving an authored property spelling into its planned value.
// One place for it, so every value that must agree resolves the same way: a material's
// properties, a medium's coefficients, the sky's colour, and a light's emission (authored
// lights and emissive objects alike, whose light rows and hit-side emission must be equal
// for pt ≡ pt-nee).

import type { Vec3, MaterialProperty, GlslExpression, ValueParam, BlackbodyValue } from '../types.js';
import { isGlslExpression, isValueParam, isBlackbody } from '../types.js';
import { foldBlackbody } from '../../components/lights/blackbody.js';

/** A spectrum-valued property: a constant broadcasts to vec3, a constant blackbody folds to
 *  its spectrum, {param} and GLSL spellings pass through (a {param}'s scalar default also
 *  broadcasts), and an absent value takes the fallback. */
export function resolveColorProperty(value: MaterialProperty | undefined, fallback: Vec3): Vec3 | GlslExpression | ValueParam<Vec3> | BlackbodyValue {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (isBlackbody(value)) return foldBlackbody(value);   // constant dials bake; driven survive
    if (isValueParam(value)) {
        // Scalar spectra intentionally broadcast. Do the same for a parameter default so
        // the generated vec3 uniform can never receive a scalar on its initial upload.
        if (typeof value.default === 'number') {
            return { ...value, default: [value.default, value.default, value.default] } as ValueParam<Vec3>;
        }
        return value as ValueParam<Vec3>;  // preserve — emitted as a uniform (§2.8)
    }
    if (typeof value === 'number') return [value, value, value] as Vec3;
    return value;
}

/** A scalar property: constants, {param} and GLSL spellings pass through; an absent value
 *  takes the fallback; a vector is a Planner bug (the Validator rejects it first). */
export function resolveScalarProperty(value: MaterialProperty | undefined, fallback: number): number | GlslExpression | ValueParam<number> {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (isValueParam(value)) return value as ValueParam<number>;  // preserve — emitted as a uniform (§2.8)
    if (typeof value === 'number') return value;
    // Validator reports this before planning. Keep a hard backstop for direct helper use
    // and for untyped JavaScript callers so a malformed scalar can never compile silently.
    throw new Error('Scalar material property cannot be a vector');
}
