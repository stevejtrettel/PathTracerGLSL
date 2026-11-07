// The one check of an authored value in a setting. A value is a named spectrum kind
// `{ <id>: … }`, a formula `{ kind: 'glsl', … }`, a slider `{ param, default, min?, max? }` or a
// number or triple; its form is the first of these whose key it carries. The check asks four
// things:
//   - keys: the value has only its form's keys (a value with an unknown key gets that one
//     message);
//   - slider: its structure (param.ts);
//   - domain: every number it can take (a constant, a slider's default and both ends) lies in
//     the setting's domain, the row's own constraint or else its role's;
//   - kind: a named kind sits in a setting of one of its roles, its declared numbers pass the
//     same checks, and its own rules hold.
// A material row that feeds a derived field computed only on the host (MaterialDerivedSpec.fn,
// no per-hit form) takes only a constant or a slider: the derived value is computed from the
// row's numbers, and a formula or a named kind has no numbers there.
// An optical row (a metal's η, κ) takes a constant, a scalar slider (a float widget) or a named
// kind: a formula's RGB result and a colored slider have no per-wavelength reading in a spectral
// program, and one rule serves both color models.
// A formula's numbers are not known before the render; its domain is the author's contract.

import { GLSL_EXPRESSION_KEYS, isGlslExpression, isValueParam, SETTING_ROLES, type SceneDescription } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { namedKindOf } from '../../components/color/spectra/index.js';
import type { SpectrumKind } from '../../components/color/spectra/spectrumKind.js';
import { SLIDER_KEYS, unknownKeysProblem, valueParamProblems } from '../../components/param.js';
import type { SpectrumRole, RowConstraint, PropertySchema, SpaceConstraints } from '../../components/descriptors.js';
import { MATERIAL_MODELS, hostDerivedFieldFedBy } from '../../components/materials/index.js';
import { VOLUME_SCATTERING_MODELS, phaseModelOf } from '../../components/volume_scattering/index.js';

/** The one interpreter of RowConstraint, with one message voice for every family's rows.
 *  Scalar rules apply per component; min-length needs a vec3. */
export function constraintViolation(value: number | number[], c: RowConstraint): string | null {
    const values = typeof value === 'number' ? [value] : value;
    if (c.kind === 'nonnegative') return values.some((v) => v < 0) ? 'components must be >= 0' : null;
    if (c.kind === 'positive') return values.some((v) => v <= 0) ? 'must be > 0' : null;
    if (c.kind === 'interval') return values.some((v) => !(v > c.min && v < c.max)) ? `must be in (${c.min}, ${+c.max.toFixed(6)})` : null;
    if (c.kind === 'closed-interval') return values.some((v) => !(v >= c.min && v <= c.max)) ? `must be in [${c.min}, ${c.max}]` : null;
    // Exact zero tests on the authored numbers: a direction is vertical or horizontal by how it is
    // written ([0, 1, 0], [1, 0, 0.5]), never up to a tolerance.
    if (c.kind === 'vertical') return Array.isArray(value) && (value[0] !== 0 || value[2] !== 0) ? 'must be vertical (x = z = 0)' : null;
    if (c.kind === 'vertical-or-horizontal') {
        return Array.isArray(value) && value[1] !== 0 && (value[0] !== 0 || value[2] !== 0) ? 'must be vertical (x = z = 0) or horizontal (y = 0)' : null;
    }
    return Array.isArray(value) && Math.hypot(...value) < c.value ? `length must be >= ${c.value}` : null;
}

/** The violations of a geometric row's value (a primitive's row, a light's authored row) in the
 *  program's space: the row's own constraint, then the further domain its body in that space
 *  requires (SpaceConstraints). */
export function rowViolations(
    value: number | number[], row: { constraint?: RowConstraint; constraintIn?: SpaceConstraints }, space: string,
): string[] {
    const found: string[] = [];
    const own = row.constraint === undefined ? null : constraintViolation(value, row.constraint);
    if (own !== null) found.push(own);
    const inSpace = row.constraintIn?.[space];
    const spaceViolation = inSpace === undefined ? null : constraintViolation(value, inSpace);
    if (spaceViolation !== null) found.push(`${spaceViolation} in ${space} space`);
    return found;
}

export interface PropertyValueContract {
    shape: 'scalar' | 'spectrum';
    role?: SpectrumRole;
    /** A domain the model's mathematics requires; when absent, the role's domain applies. */
    constraint?: RowConstraint;
}

/** What a constant must be: a number, a number or a triple (a spectrum, where a number is a
 *  gray), or exactly a triple. */
export type ValueShape = 'scalar' | 'spectrum' | 'vec3';

/** A material or phase row as a setting: its shape, its own constraint and its role. */
export function rowSetting(row: PropertySchema): PropertyValueContract {
    return { shape: row.glslType === 'Spectrum' ? 'spectrum' : 'scalar', constraint: row.constraint, role: row.role };
}

/** Checks every material row, medium setting and phase row of the scene. */
export function validateSceneProperties(scene: SceneDescription, bag: DiagnosticBag): void {
    const report = (problems: string[]) => { for (const message of problems) bag.error('invalid-setting', message).add(); };
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.model !== 'none') {
            for (const field of MATERIAL_MODELS[mat.model]?.properties ?? []) {
                const value = (mat as unknown as Record<string, unknown>)[field.source];
                const label = `Material '${name}': ${field.source}`;
                const derived = hostDerivedFieldFedBy(mat.model, field.source);
                const kind = namedKindOf(value);
                if (derived !== undefined && (kind !== undefined || isGlslExpression(value))) {
                    report([`${label} feeds the derived field '${derived.name}', which is computed on the host: it takes a constant or a {param}, not ${kind === undefined ? 'an expression' : `a ${kind.label} value`}`]);
                    continue;
                }
                if (field.role === 'optical' && (isGlslExpression(value) || (isValueParam(value as never) && Array.isArray((value as { default?: unknown }).default)))) {
                    report([`${label} is an optical constant: it takes a constant, a scalar {param} or a named spectrum kind, not ${isGlslExpression(value) ? 'an expression' : 'a vec3 {param}'}`]);
                    continue;
                }
                report(valueProblems(value, rowSetting(field), label));
            }
        }

        if (mat.medium === undefined) continue;
        // Media take plain values (constants, {param} or expressions): no named kind has a
        // medium reader yet, including a wavelength-dependent GRIN index.
        const roles = SETTING_ROLES.medium;
        const mediumSlots = [
            ['sigma_a', mat.medium.sigma_a, { shape: 'spectrum', role: roles.sigma_a }],
            ['sigma_s', mat.medium.sigma_s, { shape: 'spectrum', role: roles.sigma_s }],
            ['emission', mat.medium.emission, { shape: 'spectrum', role: roles.emission }],
            ['ior', mat.medium.ior, { shape: 'scalar', role: roles.ior }],
        ] as const;
        for (const [prop, v, contract] of mediumSlots) {
            const label = `Material '${name}': medium.${prop}`;
            const kind = namedKindOf(v);
            if (kind) {
                bag.error('invalid-setting', `${label} cannot be a ${kind.label} value — media take a constant, a {param} or an expression`).add();
                continue;
            }
            report(valueProblems(v, contract, label));
        }

        const phase = VOLUME_SCATTERING_MODELS[phaseModelOf(mat.medium)];
        for (const field of phase?.properties ?? []) {
            report(valueProblems((mat.medium as unknown as Record<string, unknown>)[field.source], rowSetting(field), `Material '${name}': medium.${field.source}`));
        }
    }
}

/** What is wrong with a value in a setting, as messages that start with `label`; none for an
 *  absent value. */
export function valueProblems(value: unknown, setting: PropertyValueContract, label: string): string[] {
    if (value === undefined) return [];
    const kind = namedKindOf(value);
    if (kind) return kindProblems(kind, value as object, setting, label);
    if (isGlslExpression(value)) {
        const keys = unknownKeysProblem(value, GLSL_EXPRESSION_KEYS);
        return keys === null ? [] : [`${label}: the expression has ${keys}`];
    }
    return numberProblems(value, setting.shape, slotDomain(setting), label, true);
}

/** A named kind: its one key, a setting of one of its roles, its declared numbers, then the
 *  rules that relate them. */
function kindProblems(kind: SpectrumKind, value: object, setting: PropertyValueContract, label: string): string[] {
    const beside = unknownKeysProblem(value, [kind.id]);
    if (beside !== null) return [`${label}: the ${kind.label} value has ${beside}`];
    if (setting.role === undefined || !kind.roles.includes(setting.role)) {
        const roles = kind.roles.length === 1 ? kind.roles[0] : `${kind.roles.slice(0, -1).join(', ')} or ${kind.roles[kind.roles.length - 1]}`;
        return [`${label}: ${kind.label} is ${/^[aeiou]/.test(roles) ? 'an' : 'a'} ${roles} form`];
    }
    const role = setting.role;
    const problems: string[] = [];
    const fields = kind.fields;
    if (fields !== undefined) {
        const names = Object.keys(fields);
        const numbers: unknown = (value as Record<string, unknown>)[kind.id];
        if (typeof numbers !== 'object' || numbers === null || Array.isArray(numbers)) {
            const spelled = names.map((n) => (fields[n].optional ? `${n}?` : n));
            return [`${label}: ${kind.label} must be an object { ${spelled.join(', ')} }`];
        }
        const keys = unknownKeysProblem(numbers, names);
        if (keys !== null) return [`${label}: ${kind.label} has ${keys}`];
        for (const [name, field] of Object.entries(fields)) {
            const number = (numbers as Record<string, unknown>)[name];
            if (number === undefined && field.optional) continue;
            if (field.name) {
                if (typeof number !== 'string') problems.push(`${label}: ${kind.label} ${name} must be a name`);
                continue;
            }
            problems.push(...numberProblems(number, field.triple ? 'vec3' : 'scalar', field.domain, `${label}: ${kind.label} ${name}`, field.slider ?? false));
        }
    }
    if (problems.length === 0) kind.validate?.(value, label, (message) => problems.push(message), role);
    return problems;
}

/** A constant, or where `slider` allows it a slider, whose every value must lie in `domain`: a
 *  constant itself; a slider's structure, its default and both ends. Messages start with
 *  `label`. */
export function numberProblems(value: unknown, shape: ValueShape, domain: RowConstraint | undefined, label: string, slider: boolean): string[] {
    if (!slider || !isValueParam(value as never)) {
        const problem = constantProblem(value, shape, domain);
        return problem === null ? [] : [`${label} ${problem}`];
    }
    const param = value as { param?: unknown; default?: unknown; min?: unknown; max?: unknown };
    const keys = unknownKeysProblem(param, SLIDER_KEYS);
    if (keys !== null) return [`${label} {param: '${String(param.param)}'} has ${keys}`];
    const problems = valueParamProblems(param).map((problem) => `${label} ${problem}`);
    if (param.default !== undefined) {
        const problem = constantProblem(param.default, shape, domain);
        if (problem !== null) problems.push(`${label} ${problem}`);
        // A default of the wrong shape says nothing about the bounds.
        if (!hasShape(param.default, shape)) return problems;
        // The default lies between the slider's ends (every component of a triple). Ends out
        // of order are already reported, and are not compared.
        const lo = isFiniteNumber(param.min) ? param.min : -Infinity;
        const hi = isFiniteNumber(param.max) ? param.max : Infinity;
        const components = typeof param.default === 'number' ? [param.default] : param.default as number[];
        if (lo <= hi && components.some((c) => c < lo)) problems.push(`${label} parameter default must be >= min`);
        if (lo <= hi && components.some((c) => c > hi)) problems.push(`${label} parameter default must be <= max`);
    }
    // A slider reaches its bounds, so they lie in the domain too.
    for (const [which, bound] of [['min', param.min], ['max', param.max]] as const) {
        if (bound === undefined) continue;
        const problem = !isFiniteNumber(bound) ? 'must be a finite number'
            : domain === undefined || domain.kind === 'min-length' ? null
            : constraintViolation(bound, domain);
        if (problem !== null) problems.push(`${label} parameter ${which} ${problem}`);
    }
    return problems;
}

/** What is wrong with one constant of the given shape whose value must lie in `domain`, or
 *  null. */
export function constantProblem(value: unknown, shape: ValueShape, domain: RowConstraint | undefined): string | null {
    if (!hasShape(value, shape)) return `must be ${SHAPE_NAMES[shape]}`;
    return domain === undefined ? null : constraintViolation(value as number | number[], domain);
}

const SHAPE_NAMES: Record<ValueShape, string> = {
    scalar: 'a finite number',
    spectrum: 'a finite number or vec3',
    vec3: 'a finite vec3',
};

function hasShape(value: unknown, shape: ValueShape): boolean {
    return shape === 'scalar' ? isFiniteNumber(value)
        : shape === 'vec3' ? isFiniteVec3(value)
        : isFiniteNumber(value) || isFiniteVec3(value);
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

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isFiniteVec3(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}
