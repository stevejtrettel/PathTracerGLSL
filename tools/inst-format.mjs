// tools/inst-format.mjs — the `.inst` instance-cloud WRITE-side layout truth
// (fable-instance-clouds §2/§6). Plain JS so every writer — converters, the fixture
// generator — AND vitest can import it; hand-rolling the byte layout anywhere else is
// the drift class this module kills (the ledger pattern applied to the file format).
// The read side is src/authoring/loadInstances.ts; the vitest round-trip gate
// (encode → parseInstances → deep-equal) is the format's contract test.
//
// Layout (version 1, little-endian, all payload blocks f32 and 4-byte aligned):
//   0        magic 'INST'
//   4        u32 version = 1
//   8        u32 count N
//   12       u32 flags: bit0 sizes, bit1 colors, bit2 orientations
//   16       f32×6 POSITIONS-ONLY AABB (min.xyz, max.xyz) — hook-invariant (§2)
//   40       u32 K (scalar column count)
//   44       K×32 column names (UTF-8, zero-padded to 32 bytes each)
//   44+32K   u32 P (provenance byte length)
//   48+32K   provenance UTF-8, zero-padded to a multiple of 4
//   then, each present iff flagged, in this order:
//   positions f32×3N | sizes f32×N | colors f32×3N (LINEAR RGB) |
//   orientations f32×4N (unit quats [x,y,z,w], identity (0,0,0,1)) | scalars K×(f32×N)

export const INST_MAGIC = 0x54534e49;  // 'INST' read as LE u32
export const INST_VERSION = 1;
export const INST_NAME_BYTES = 32;

export const FLAG_SIZES = 1;
export const FLAG_COLORS = 2;
export const FLAG_ORIENTATIONS = 4;

/**
 * Encode an instance cloud. `table`:
 *   positions     Float32Array(3N)  required
 *   sizes         Float32Array(N)   optional
 *   colors        Float32Array(3N)  optional (LINEAR RGB)
 *   orientations  Float32Array(4N)  optional (unit quats [x,y,z,w])
 *   scalars       { name: Float32Array(N) } optional (insertion order = block order)
 *   provenance    string            optional (converter id + date + source)
 * Returns an ArrayBuffer. The header AABB is computed from positions (positions-only).
 */
export function encodeInstances(table) {
    const { positions, sizes, colors, orientations, scalars = {}, provenance = '' } = table;
    if (!(positions instanceof Float32Array) || positions.length === 0 || positions.length % 3 !== 0) {
        throw new Error('inst encode: positions must be a nonempty Float32Array of length 3N');
    }
    const n = positions.length / 3;
    const checkLen = (name, arr, per) => {
        if (arr !== undefined && (!(arr instanceof Float32Array) || arr.length !== per * n)) {
            throw new Error(`inst encode: ${name} must be a Float32Array of length ${per}N (${per * n}), got ${arr?.length}`);
        }
    };
    checkLen('sizes', sizes, 1);
    checkLen('colors', colors, 3);
    checkLen('orientations', orientations, 4);

    const names = Object.keys(scalars);
    const enc = new TextEncoder();
    const nameBytes = names.map((name) => {
        const b = enc.encode(name);
        if (b.length === 0 || b.length >= INST_NAME_BYTES) {
            throw new Error(`inst encode: scalar column name '${name}' must be 1..${INST_NAME_BYTES - 1} UTF-8 bytes`);
        }
        return b;
    });
    if (new Set(names).size !== names.length) throw new Error('inst encode: duplicate scalar column names');
    for (const name of names) checkLen(`scalars.${name}`, scalars[name], 1);

    const provBytes = enc.encode(provenance);
    const provPadded = (provBytes.length + 3) & ~3;
    const headerBytes = 44 + names.length * INST_NAME_BYTES + 4 + provPadded;
    const blockFloats = 3 * n
        + (sizes !== undefined ? n : 0)
        + (colors !== undefined ? 3 * n : 0)
        + (orientations !== undefined ? 4 * n : 0)
        + names.length * n;
    const buffer = new ArrayBuffer(headerBytes + blockFloats * 4);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setUint32(0, INST_MAGIC, true);
    view.setUint32(4, INST_VERSION, true);
    view.setUint32(8, n, true);
    const flags = (sizes !== undefined ? FLAG_SIZES : 0)
        | (colors !== undefined ? FLAG_COLORS : 0)
        | (orientations !== undefined ? FLAG_ORIENTATIONS : 0);
    view.setUint32(12, flags, true);
    const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let a = 0; a < 3; a++) {
            const v = positions[i + a];
            if (v < aabb[a]) aabb[a] = v;
            if (v > aabb[3 + a]) aabb[3 + a] = v;
        }
    }
    for (let a = 0; a < 6; a++) view.setFloat32(16 + a * 4, aabb[a], true);
    view.setUint32(40, names.length, true);
    nameBytes.forEach((b, k) => bytes.set(b, 44 + k * INST_NAME_BYTES));
    const provOff = 44 + names.length * INST_NAME_BYTES;
    view.setUint32(provOff, provBytes.length, true);
    bytes.set(provBytes, provOff + 4);

    const floats = new Float32Array(buffer, headerBytes);
    let off = 0;
    const write = (arr) => { floats.set(arr, off); off += arr.length; };
    write(positions);
    if (sizes !== undefined) write(sizes);
    if (colors !== undefined) write(colors);
    if (orientations !== undefined) write(orientations);
    for (const name of names) write(scalars[name]);
    return buffer;
}
