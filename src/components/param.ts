// components/param.ts — the live-parameter spelling `{ param, default, min?, max? }`, shared by
// every authored value that can be bound to a slider.

import type { Value, ValueParam } from '../compiler/types.js';

export function isValueParam<T>(v: Value<T>): v is ValueParam<T> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && 'param' in v;
}

/** The keys a slider may have. */
export const SLIDER_KEYS = ['param', 'default', 'min', 'max'] as const;

/** "an unknown key 'x' (its keys: a, b)" when `value` has a key outside `keys`, else null. One
 *  wording for every authored value whose form fixes its keys: a slider, a formula, a named
 *  spectrum kind. */
export function unknownKeysProblem(value: object, keys: readonly string[]): string | null {
    const unknown = Object.keys(value).filter((k) => !keys.includes(k));
    if (unknown.length === 0) return null;
    return `${unknown.length === 1 ? 'an unknown key' : 'unknown keys'} ${unknown.map((k) => `'${k}'`).join(', ')} (its keys: ${keys.join(', ')})`;
}

/** What is wrong with a slider's structure, whatever the shape and domain of its value: the
 *  parameter path must be a non-empty string, a default must be given, and finite bounds must be
 *  ordered. Its keys are checked separately (`unknownKeysProblem` with `SLIDER_KEYS`), and so is
 *  its default against its bounds, once the default's shape is known. */
export function valueParamProblems(v: { param?: unknown; default?: unknown; min?: unknown; max?: unknown }): string[] {
    const problems: string[] = [];
    if (typeof v.param !== 'string' || v.param.trim() === '') problems.push('parameter path must be a non-empty string');
    // No default means no value until something sets the parameter: the uniform keeps GL's 0
    // (an ior of 0, a black albedo) with no diagnostic anywhere.
    if (v.default === undefined) problems.push(`{param: '${String(v.param)}'} needs a default — the value the render starts with`);
    const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
    if (finite(v.min) && finite(v.max) && v.min > v.max) problems.push('parameter min must be <= max');
    return problems;
}
