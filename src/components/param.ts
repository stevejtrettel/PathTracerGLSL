// components/param.ts — the live-parameter spelling `{ param, default, min?, max? }`, shared by
// every authored value that can be bound to a slider.

import type { Value, ValueParam } from '../compiler/types.js';

export function isValueParam<T>(v: Value<T>): v is ValueParam<T> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && 'param' in v;
}
