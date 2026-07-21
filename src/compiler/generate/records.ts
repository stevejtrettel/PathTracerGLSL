// compiler/generate/records.ts — the analytic RECORD pair (fable-object-tables §3),
// BOTH SIDES GENERATED FROM THE DESCRIPTOR ROWS (a strengthening of the doc's sketch:
// no per-descriptor record code at all — rows are already the ONE truth for struct/
// ctor/validation (A1), so the pack layout and the GLSL reader derive from the same
// field walk and cannot drift; a contract test pins the float counts).
//
// Record wire format (fixed stride ANALYTIC_RECORD_TEXELS):
//   texel 0 (header):  (primKindCode, regionId, 0, 0)
//   texels 1..4:       row fields then derived fields, DENSE floats (vec3 = 3, number
//                      = 1), zero-padded — the reader reconstructs by the same walk.
// The App packs (recordPack) at upload; table-mode programs read via the generated
// `<type>_from_record(sampler2D rec, uint base)` returning the SAME struct the unrolled
// ctor builds — every downstream function (<type>_intersect/_normal/_sdf) is unchanged.

import type { PrimitiveDescriptor } from '../../components/descriptors.js';
import { structName } from '../../components/geometry/index.js';
import { ANALYTIC_RECORD_TEXELS } from '../../components/intersection/index.js';

const PAYLOAD_FLOATS = (ANALYTIC_RECORD_TEXELS - 1) * 4;

/** The field walk BOTH sides share: rows then derived fields, each with its float width. */
function recordFields(d: PrimitiveDescriptor): Array<{ width: 1 | 3 }> {
    return [
        ...d.params.map((p) => ({ width: p.shape === 'vec3' ? 3 as const : 1 as const })),
        ...(d.derivedFields ?? []).map((f) => ({ width: f.shape === 'vec3' ? 3 as const : 1 as const })),
    ];
}

/** Pack one object's CANONICAL (folded) values into payload floats (App-side; the header
 *  texel is written by the caller). Derived fields are computed by the descriptor's own
 *  derivedCtorFields — the same computation the unrolled ctor bakes. */
export function recordPack(d: PrimitiveDescriptor, values: Record<string, number | number[]>): number[] {
    const floats: number[] = [];
    for (const row of d.params) {
        const v = values[row.name];
        if (Array.isArray(v)) floats.push(v[0], v[1], v[2]);
        else floats.push(v as number);
    }
    for (const dv of d.derivedCtorFields?.(values) ?? []) {
        if (Array.isArray(dv)) floats.push(dv[0], dv[1], dv[2]);
        else floats.push(dv);
    }
    if (floats.length > PAYLOAD_FLOATS) {
        throw new Error(`recordPack: primitive '${d.type}' needs ${floats.length} payload floats > ${PAYLOAD_FLOATS} — raise ANALYTIC_RECORD_TEXELS deliberately (fable-object-tables §3)`);
    }
    while (floats.length < PAYLOAD_FLOATS) floats.push(0);
    return floats;
}

/** Generate the GLSL reader for one primitive kind — the record pair's other half,
 *  from the SAME field walk. Emitted only in table-mode programs. */
export function generateRecordReader(d: PrimitiveDescriptor): string {
    const fields = recordFields(d);
    const totalFloats = fields.reduce((a, f) => a + f.width, 0);
    if (totalFloats > PAYLOAD_FLOATS) {
        throw new Error(`record reader: primitive '${d.type}' exceeds the record stride`);
    }
    const texels = Math.ceil(totalFloats / 4);
    const comp = (f: number): string => `t${f >> 2}.${'xyzw'[f & 3]}`;
    const lines: string[] = [
        `${structName(d)} ${d.type}_from_record(sampler2D rec, uint base) {`,
    ];
    for (let i = 0; i < texels; i++) {
        lines.push(`    vec4 t${i} = texelFetch(rec, data_texel1d(base + ${i + 1}u), 0);`);
    }
    let f = 0;
    const args: string[] = [];
    for (const field of fields) {
        if (field.width === 3) {
            args.push(`vec3(${comp(f)}, ${comp(f + 1)}, ${comp(f + 2)})`);
            f += 3;
        } else {
            args.push(comp(f));
            f += 1;
        }
    }
    lines.push(`    return ${structName(d)}(${args.join(', ')});`);
    lines.push('}');
    return lines.join('\n');
}
