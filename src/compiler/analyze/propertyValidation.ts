// Shared validation mechanics for authored scalar/spectrum properties.
//
// Today Validator chooses these contracts at the material/media call sites. The descriptor
// migration can later carry the same shape/domain data and call this function directly; the
// validation behavior and diagnostics do not need to be rewritten when ownership moves.

import { isGlslExpression, isValueParam, isBlackbody, type SceneDescription } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import type { RowConstraint } from '../../components/descriptors.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../components/volume_scattering/index.js';

/** THE constraint interpreter (D1): one message voice for every family's rows.
 *  Shape-agnostic — scalar rules apply per-component; min-length needs a vec3. */
export function constraintViolation(value: number | number[], c: RowConstraint): string | null {
    const values = typeof value === 'number' ? [value] : value;
    if (c.kind === 'nonnegative') return values.some((v) => v < 0) ? 'components must be >= 0' : null;
    if (c.kind === 'positive') return values.some((v) => v <= 0) ? 'must be > 0' : null;
    if (c.kind === 'interval') return values.some((v) => !(v > c.min && v < c.max)) ? `must be in (${c.min}, ${+c.max.toFixed(6)})` : null;
    return Array.isArray(value) && Math.hypot(...value) < c.value ? `length must be >= ${c.value}` : null;
}

export interface PropertyValueContract {
    shape: 'scalar' | 'spectrum';
    /** Only domains required by current transport mathematics, not artistic policy —
     *  the shared RowConstraint vocabulary (descriptor-unification D1). */
    constraint?: RowConstraint;
}

/** Current contract wiring. Model/phase field shapes already come from descriptors; the
 *  two RTE coefficients are fixed medium vocabulary. As descriptors gain all authored
 *  defaults/domains, this function becomes a mechanical descriptor traversal. */
export function validateSceneProperties(scene: SceneDescription, bag: DiagnosticBag): void {
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.model !== 'none') {
            for (const field of MATERIAL_MODELS[mat.model]?.properties ?? []) {
                validatePropertyValue(
                    (mat as unknown as Record<string, unknown>)[field.source],
                    { shape: field.glslType === 'Spectrum' ? 'spectrum' : 'scalar', constraint: field.constraint },
                    `Material '${name}': ${field.source}`,
                    bag,
                );
            }
        }

        if (mat.medium === undefined) continue;
        for (const [prop, v] of [['sigma_a', mat.medium.sigma_a], ['sigma_s', mat.medium.sigma_s], ['emission', mat.medium.emission]] as const) {
            if (isBlackbody(v)) {
                bag.error('invalid-setting',
                    `Material '${name}': medium.${prop} cannot be a blackbody spelling — kelvin parameterizes SURFACE/LIGHT emission chroma; medium coefficients are extinction/ε fields`)
                    .add();
            }
        }
        validatePropertyValue(mat.medium.sigma_a, { shape: 'spectrum', constraint: { kind: 'nonnegative' } },
            `Material '${name}': medium.sigma_a`, bag);
        validatePropertyValue(mat.medium.sigma_s, { shape: 'spectrum', constraint: { kind: 'nonnegative' } },
            `Material '${name}': medium.sigma_s`, bag);

        const phase = VOLUME_SCATTERING_MODELS[mat.medium.model ?? 'hg'];
        for (const field of phase?.properties ?? []) {
            validatePropertyValue(
                (mat.medium as unknown as Record<string, unknown>)[field.source],
                { shape: field.glslType === 'Spectrum' ? 'spectrum' : 'scalar', constraint: field.constraint },
                `Material '${name}': medium.${field.source}`,
                bag,
            );
        }
    }
}

export function validatePropertyValue(
    value: unknown,
    contract: PropertyValueContract,
    label: string,
    bag: DiagnosticBag,
): void {
    if (value === undefined || isGlslExpression(value)) return;
    if (isBlackbody(value)) {
        // The blackbody spelling: dials validated here; the chroma is derived (>= 0 by
        // construction), so the generic spectrum checks below do not apply.
        const { kelvin, scale } = value.blackbody;
        const kVal = isValueParam(kelvin as never) ? (kelvin as { default?: unknown }).default : kelvin;
        if (typeof kVal !== 'number' || !Number.isFinite(kVal) || kVal <= 0) {
            bag.error('invalid-setting', `${label}: blackbody kelvin must be a finite number > 0 (constant, or a {param} with a finite default)`).add();
        }
        const sRaw = scale === undefined ? 1 : isValueParam(scale as never) ? ((scale as { default?: unknown }).default ?? 1) : scale;
        if (typeof sRaw !== 'number' || !Number.isFinite(sRaw) || sRaw < 0) {
            bag.error('invalid-setting', `${label}: blackbody scale must be a finite number >= 0`).add();
        }
        return;
    }

    let authored: unknown = value;
    let parameterMin: number | undefined;
    if (isValueParam(value as never)) {
        const param = value as { param?: unknown; default?: unknown; min?: number; max?: number };
        if (typeof param.param !== 'string' || param.param.trim() === '') {
            bag.error('invalid-setting', `${label} parameter path must be a non-empty string`).add();
        }
        if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
            bag.error('invalid-setting', `${label} parameter min must be <= max`).add();
        }
        authored = param.default;
        parameterMin = param.min;
        if (authored === undefined) {
            // No default means no value until something sets the parameter: the uniform
            // keeps GL's 0 (an ior of 0, a black albedo) with no diagnostic anywhere.
            bag.error('invalid-setting', `${label} {param: '${String(param.param)}'} needs a default — the value the render starts with`).add();
            validateMinimum(parameterMin, contract.constraint, `${label} parameter min`, bag);
            return;
        }
    }

    const shapeValid = contract.shape === 'scalar'
        ? isFiniteNumber(authored)
        : isFiniteNumber(authored) || isFiniteVec3(authored);
    if (!shapeValid) {
        bag.error('invalid-setting',
            `${label} must be ${contract.shape === 'scalar' ? 'a finite number' : 'a finite number or vec3'}`)
            .add();
        return;
    }

    if (contract.constraint !== undefined) {
        const violation = constraintViolation(authored as number | number[], contract.constraint);
        if (violation !== null) bag.error('invalid-setting', `${label} ${violation}`).add();
    }
    validateMinimum(parameterMin, contract.constraint, `${label} parameter min`, bag);
}

function validateMinimum(
    min: number | undefined,
    constraint: RowConstraint | undefined,
    label: string,
    bag: DiagnosticBag,
): void {
    if (min === undefined || constraint === undefined || constraint.kind === 'min-length') return;
    const violation = constraintViolation(min, constraint);
    if (violation !== null) bag.error('invalid-setting', `${label} ${violation}`).add();
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}
