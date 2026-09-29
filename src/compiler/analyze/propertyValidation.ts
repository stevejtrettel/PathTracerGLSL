// Shared validation mechanics for authored scalar/spectrum properties.
//
// Today Validator chooses these contracts at the material/media call sites. The descriptor
// migration can later carry the same shape/domain data and call this function directly; the
// validation behavior and diagnostics do not need to be rewritten when ownership moves.

import { isGlslExpression, isValueParam, type SceneDescription } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { namedKindOf, namedKindsClaiming } from '../../components/color/spectra/index.js';
import { valueParamProblems } from '../../components/param.js';
import type { RadiometricRole, RowConstraint } from '../../components/descriptors.js';
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
    role?: RadiometricRole | 'index';
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
                    { shape: field.glslType === 'Spectrum' ? 'spectrum' : 'scalar', constraint: field.constraint, role: field.semantic === 'radiometric' ? field.role : field.semantic === 'index' ? 'index' : undefined },
                    `Material '${name}': ${field.source}`,
                    bag,
                );
            }
        }

        if (mat.medium === undefined) continue;
        // Media take plain values (constants, {param} or expressions): no named kind has a
        // medium reader yet, including a wavelength-dependent GRIN index.
        const mediumSlots = [
            ['sigma_a', mat.medium.sigma_a, { shape: 'spectrum', role: 'coefficient' }],
            ['sigma_s', mat.medium.sigma_s, { shape: 'spectrum', role: 'coefficient' }],
            ['emission', mat.medium.emission, { shape: 'spectrum', role: 'emission' }],
            ['ior', mat.medium.ior, { shape: 'scalar', role: 'index' }],
        ] as const;
        for (const [prop, v, contract] of mediumSlots) {
            const label = `Material '${name}': medium.${prop}`;
            const kind = namedKindOf(v);
            if (kind) {
                bag.error('invalid-setting', `${label} cannot be a ${kind.label} value — media take a constant, a {param} or an expression`).add();
                continue;
            }
            validatePropertyValue(v, contract, label, bag);
        }

        const phase = VOLUME_SCATTERING_MODELS[mat.medium.model ?? 'hg'];
        for (const field of phase?.properties ?? []) {
            validatePropertyValue(
                (mat.medium as unknown as Record<string, unknown>)[field.source],
                { shape: field.glslType === 'Spectrum' ? 'spectrum' : 'scalar', constraint: field.constraint, role: field.semantic === 'radiometric' ? field.role : field.semantic === 'index' ? 'index' : undefined },
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
    if (value === undefined) return;
    // A value is one thing: a named kind, a {param} or an expression, never keys of two.
    const claiming = [
        ...namedKindsClaiming(value).map((k) => k.label),
        ...(isValueParam(value as never) ? ['{param}'] : []),
        ...(isGlslExpression(value) ? ['expression'] : []),
    ];
    if (claiming.length > 1) {
        bag.error('invalid-setting', `${label} carries the keys of more than one kind of value (${claiming.join(', ')})`).add();
        return;
    }
    if (isGlslExpression(value)) return;
    // A named spectrum kind (blackbody, Cauchy, Sellmeier) belongs in slots of its roles and
    // checks its own numbers.
    const kind = namedKindOf(value);
    if (kind) {
        if (contract.role === undefined || !kind.roles.includes(contract.role)) {
            const role = kind.roles[0];
            bag.error('invalid-setting', `${label}: ${kind.label} is ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role} form`).add();
            return;
        }
        kind.validate?.(value, label, (message) => bag.error('invalid-setting', message).add());
        return;
    }

    const domain = slotDomain(contract);
    let authored: unknown = value;
    let parameterMin: unknown;
    let parameterMax: unknown;
    if (isValueParam(value as never)) {
        const param = value as { param?: unknown; default?: unknown; min?: unknown; max?: unknown };
        for (const problem of valueParamProblems(param)) bag.error('invalid-setting', `${label} ${problem}`).add();
        authored = param.default;
        parameterMin = param.min;
        parameterMax = param.max;
        if (authored === undefined) {
            // No default means no value until something sets the parameter: the uniform
            // keeps GL's 0 (an ior of 0, a black albedo) with no diagnostic anywhere.
            bag.error('invalid-setting', `${label} {param: '${String(param.param)}'} needs a default — the value the render starts with`).add();
            validateBound(parameterMin, domain, `${label} parameter min`, bag);
            validateBound(parameterMax, domain, `${label} parameter max`, bag);
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

    if (domain !== undefined) {
        const violation = constraintViolation(authored as number | number[], domain);
        if (violation !== null) bag.error('invalid-setting', `${label} ${violation}`).add();
    }
    validateBound(parameterMin, domain, `${label} parameter min`, bag);
    validateBound(parameterMax, domain, `${label} parameter max`, bag);
}

/** The domain every value in a slot of this role must lie in: the multipliers and emitted
 *  light are nonnegative, an index is positive. The spectral model narrows reflectance to
 *  [0,1] separately (analyze/spectral.ts), where its bounded lift requires it. */
export function roleDomain(role: PropertyValueContract['role']): RowConstraint | undefined {
    if (role === undefined) return undefined;
    return role === 'index' ? { kind: 'positive' } : { kind: 'nonnegative' };
}

/** The domain a slot's values must lie in: the row's own constraint, or else its role's. */
export function slotDomain(contract: Pick<PropertyValueContract, 'constraint' | 'role'>): RowConstraint | undefined {
    return contract.constraint ?? roleDomain(contract.role);
}

/** A slider bound (min or max) must lie in the slot's domain too: the slider can reach it. */
function validateBound(
    bound: unknown,
    constraint: RowConstraint | undefined,
    label: string,
    bag: DiagnosticBag,
): void {
    if (bound === undefined) return;
    if (!isFiniteNumber(bound)) {
        bag.error('invalid-setting', `${label} must be a finite number`).add();
        return;
    }
    if (constraint === undefined || constraint.kind === 'min-length') return;
    const violation = constraintViolation(bound, constraint);
    if (violation !== null) bag.error('invalid-setting', `${label} ${violation}`).add();
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}
