// components/param.ts — the live-parameter spelling `{ param, default, min?, max? }`, shared by
// every authored value that can be bound to a slider.

import type { Value, ValueParam } from '../compiler/types.js';

export function isValueParam<T>(v: Value<T>): v is ValueParam<T> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && 'param' in v;
}

/** What is wrong with a slider binding's structure, whatever the domain of its value: the
 *  parameter path must be a non-empty string, and finite bounds must be ordered. */
export function valueParamProblems(v: { param?: unknown; min?: unknown; max?: unknown }): string[] {
    const problems: string[] = [];
    if (typeof v.param !== 'string' || v.param.trim() === '') problems.push('parameter path must be a non-empty string');
    const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
    if (finite(v.min) && finite(v.max) && v.min > v.max) problems.push('parameter min must be <= max');
    return problems;
}
