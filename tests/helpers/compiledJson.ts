// tests/helpers/compiledJson.ts — compiler output as comparable text.
//
// Plain JSON.stringify loses what matters in a CompiledScene: a Map (each renderer's shaders and
// source maps) serializes as {}, and a typed array (the packed scene data) as an object of its
// indices. This replacer writes a Map as an object of its entries and a typed array as its type,
// length and a hash of its bytes. Functions (uniform compute closures) are written as '[fn]':
// two compiles make different closures, and a closure's behaviour cannot be compared here.

import { createHash } from 'node:crypto';

export function hashText(s: string | Uint8Array): string {
    return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function compiledReplacer(_key: string, v: unknown): unknown {
    if (typeof v === 'function') return '[fn]';
    if (v instanceof Map) return Object.fromEntries(v);
    if (ArrayBuffer.isView(v)) {
        const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        return `[${v.constructor.name} ${bytes.byteLength}B ${hashText(bytes)}]`;
    }
    return v;
}

/** `value` (a CompiledScene or any part of one) as deterministic JSON text. */
export function compiledJson(value: unknown): string {
    return JSON.stringify(value, compiledReplacer);
}
