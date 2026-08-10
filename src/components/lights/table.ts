// components/lights/table.ts — the light TABLE's layout truth (fable-light-bvh §4).
// Family-root shared part (the power.ts precedent): under lightSelection 'bvh' every
// registry light is table-RESIDENT in the records channel — the per-light accessor/
// dispatch chains (O(n) GLSL text) are not emitted. ONE function decides the row
// geometry; three readers consume it: dataTenantsOf (region size), the App packer
// (bytes), and the Generator's per-kind loaders (float offsets) — stride, codes, and
// field positions cannot drift.
//
// Row = 1 HEADER texel (kindCode, 0, 0, 0) + payload texels: the kind's schema rows
// in declared order followed by its derived ctor fields — exactly the generated
// struct's ctor order, so a loader fills the struct by positional float reads (a vec3
// may span texel boundaries; the generator emits the gather). Stride = the max over
// PRESENT kinds (uniform stride — the walk indexes rows by light id alone); kind
// codes = registry order over present kinds (the scene-table precedent).

import { LIGHT_KINDS } from './index.js';

export interface LightTableLayout {
    /** Texels per light row (header + widest present kind's payload). */
    strideTexels: number;
    /** kind → header code (registry order over PRESENT kinds). */
    codeOf: Map<string, number>;
    /** code → kind (the inverse, for the generator's dispatch arms). */
    kinds: string[];
}

/** Payload float count of one kind's row: schema rows + derived ctor fields. */
export function lightRowFloats(kind: string): number {
    const d = LIGHT_KINDS[kind];
    if (d === undefined) throw new Error(`light table: unregistered kind '${kind}'`);
    let f = 0;
    for (const row of d.params) f += row.shape === 'number' ? 1 : 3;
    for (const row of d.derivedFields ?? []) f += row.shape === 'number' ? 1 : 3;
    return f;
}

export function lightTableLayout(presentKinds: Iterable<string>): LightTableLayout {
    const present = new Set(presentKinds);
    const kinds = Object.keys(LIGHT_KINDS).filter((k) => present.has(k));
    const codeOf = new Map<string, number>(kinds.map((k, i) => [k, i]));
    let maxFloats = 0;
    for (const k of kinds) maxFloats = Math.max(maxFloats, lightRowFloats(k));
    return { strideTexels: 1 + Math.ceil(maxFloats / 4), codeOf, kinds };
}

/** One packed table-input light: kind + RESOLVED registry values (constants by the
 *  bvh v1 pins — driven emission is Validator-rejected under the tree). */
export interface LightTableEntry {
    kind: string;
    values: Record<string, number | number[]>;
}

/** Pack the whole table: n·stride texels, light order = row order = light id. */
export function packLightTable(lights: readonly LightTableEntry[], layout: LightTableLayout): Float32Array {
    const out = new Float32Array(lights.length * layout.strideTexels * 4);
    lights.forEach((l, li) => {
        const d = LIGHT_KINDS[l.kind];
        if (d === undefined) throw new Error(`light table: unregistered kind '${l.kind}'`);
        const code = layout.codeOf.get(l.kind);
        if (code === undefined) throw new Error(`light table: kind '${l.kind}' missing from the layout's present set`);
        const base = li * layout.strideTexels * 4;
        out[base] = code;   // header texel: (kindCode, 0, 0, 0)
        let f = base + 4;   // payload floats start at the second texel
        const put = (v: number | number[], vec3: boolean): void => {
            if (vec3) {
                const a = v as number[];
                out[f++] = a[0]; out[f++] = a[1]; out[f++] = a[2];
            } else {
                out[f++] = v as number;
            }
        };
        for (const row of d.params) put(l.values[row.name], row.shape === 'vec3');
        const derived = d.derivedCtorFields?.(l.values) ?? [];
        (d.derivedFields ?? []).forEach((row, i) => put(derived[i], row.shape === 'vec3'));
    });
    return out;
}
