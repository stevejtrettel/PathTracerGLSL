// Shared validation mechanics for authored scalar/spectrum properties.
//
// Today Validator chooses these contracts at the material/media call sites. The descriptor
// migration can later carry the same shape/domain data and call this function directly; the
// validation behavior and diagnostics do not need to be rewritten when ownership moves.

import { isGlslExpression, isValueParam, type SceneDescription } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';
import { PHASE_MODELS } from '../../components/volume_scattering/index.js';

export interface PropertyValueContract {
    shape: 'scalar' | 'spectrum';
    /** Only domains required by current transport mathematics, not artistic policy. */
    domain?: 'nonnegative' | 'positive';
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
                    { shape: field.glslType === 'Spectrum' ? 'spectrum' : 'scalar', domain: field.domain },
                    `Material '${name}': ${field.source}`,
                    bag,
                );
            }
        }

        if (mat.medium === undefined) continue;
        validatePropertyValue(mat.medium.sigma_a, { shape: 'spectrum', domain: 'nonnegative' },
            `Material '${name}': medium.sigma_a`, bag);
        validatePropertyValue(mat.medium.sigma_s, { shape: 'spectrum', domain: 'nonnegative' },
            `Material '${name}': medium.sigma_s`, bag);

        const phase = PHASE_MODELS[mat.medium.model ?? 'hg'];
        for (const field of phase?.properties ?? []) {
            validatePropertyValue(
                (mat.medium as unknown as Record<string, unknown>)[field.source],
                { shape: field.glslType === 'Spectrum' ? 'spectrum' : 'scalar', domain: field.domain },
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
            validateMinimum(parameterMin, contract.domain, `${label} parameter min`, bag);
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

    const values = typeof authored === 'number' ? [authored] : authored as number[];
    if (contract.domain === 'nonnegative' && values.some((v) => v < 0)) {
        bag.error('invalid-setting', `${label} components must be >= 0`).add();
    } else if (contract.domain === 'positive' && values.some((v) => v <= 0)) {
        bag.error('invalid-setting', `${label} must be > 0`).add();
    }
    validateMinimum(parameterMin, contract.domain, `${label} parameter min`, bag);
}

function validateMinimum(
    min: number | undefined,
    domain: PropertyValueContract['domain'],
    label: string,
    bag: DiagnosticBag,
): void {
    if (min === undefined) return;
    if (domain === 'nonnegative' && min < 0) {
        bag.error('invalid-setting', `${label} must be >= 0`).add();
    } else if (domain === 'positive' && min <= 0) {
        bag.error('invalid-setting', `${label} must be > 0`).add();
    }
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}
