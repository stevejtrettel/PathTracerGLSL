// authoring/loadInstances.ts — the `.inst` instance-cloud READ side (fable-instance-clouds
// §3). ONE dumb loader: header validation + Float32Array views over the fetched buffer —
// no per-instance objects, no science (radius laws etc. live OFFLINE in tools/convert-*.mjs;
// files are render-ready). The write-side layout truth is tools/inst-format.mjs; the vitest
// round-trip gate keeps the two from drifting. Mirrors loadOBJ.ts in layer and shape.

import type { AABB } from '../components/accel/bvh/bvh.js';

/** A parsed `.inst` file — typed-array views (sharing the source buffer), never objects. */
export interface InstanceTable {
    count: number;
    /** POSITIONS-ONLY world AABB from the header (hook-invariant — see the format doc §2). */
    aabb: AABB;
    /** Converter id + date + source — carried into the export reproducibility stamp. */
    provenance: string;
    positions: Float32Array;         // 3N
    sizes?: Float32Array;            // N
    colors?: Float32Array;           // 3N, LINEAR RGB
    orientations?: Float32Array;     // 4N, unit quats [x,y,z,w]
    /** Named f32 columns — hook inputs ONLY (never uploaded; laws never run on the GPU). */
    scalars: Record<string, Float32Array>;
}

const MAGIC = 0x54534e49;  // 'INST' as LE u32
const VERSION = 1;
const NAME_BYTES = 32;

/** Parse a `.inst` buffer (pure, sync). Every failure is loud and prefixed 'inst:'. */
export function parseInstances(buffer: ArrayBuffer): InstanceTable {
    if (buffer.byteLength < 48) throw new Error(`inst: buffer too small for a header (${buffer.byteLength} bytes)`);
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== MAGIC) throw new Error("inst: bad magic — not a '.inst' file");
    const version = view.getUint32(4, true);
    if (version !== VERSION) throw new Error(`inst: unsupported version ${version} (loader speaks ${VERSION})`);
    const count = view.getUint32(8, true);
    if (count === 0) throw new Error('inst: count is 0 — nothing to place');
    const flags = view.getUint32(12, true);
    // Bits 3–31 are reserved: an unknown bit means an optional block this loader cannot
    // place, so the byte arithmetic below would misdiagnose the file as corrupt.
    if ((flags & ~0x7) !== 0) {
        throw new Error(`inst: unknown flag bits 0x${(flags & ~0x7).toString(16)} — file written by a newer format version`);
    }
    const aabbF = new Float32Array(buffer, 16, 6);
    const aabb = {
        min: [aabbF[0], aabbF[1], aabbF[2]] as [number, number, number],
        max: [aabbF[3], aabbF[4], aabbF[5]] as [number, number, number],
    };
    if (!aabbF.every(Number.isFinite) || aabb.min.some((v, a) => v > aabb.max[a])) {
        throw new Error('inst: header AABB is non-finite or empty');
    }
    const k = view.getUint32(40, true);
    const namesEnd = 44 + k * NAME_BYTES;
    if (buffer.byteLength < namesEnd + 4) throw new Error('inst: buffer truncated in the column-name table');
    const dec = new TextDecoder();
    const names: string[] = [];
    for (let c = 0; c < k; c++) {
        const raw = new Uint8Array(buffer, 44 + c * NAME_BYTES, NAME_BYTES);
        const end = raw.indexOf(0);
        const name = dec.decode(raw.subarray(0, end === -1 ? NAME_BYTES : end));
        if (name.length === 0) throw new Error(`inst: scalar column ${c} has an empty name`);
        names.push(name);
    }
    if (new Set(names).size !== names.length) throw new Error('inst: duplicate scalar column names');
    const provLen = view.getUint32(namesEnd, true);
    const provPadded = provLen + ((4 - (provLen % 4)) % 4);   // not (provLen + 3) & ~3: 32-bit, wraps for huge lengths
    const headerBytes = namesEnd + 4 + provPadded;
    if (buffer.byteLength < headerBytes) throw new Error('inst: buffer truncated in the provenance string');
    const provenance = dec.decode(new Uint8Array(buffer, namesEnd + 4, provLen));

    const expectFloats = 3 * count
        + ((flags & 1) !== 0 ? count : 0)
        + ((flags & 2) !== 0 ? 3 * count : 0)
        + ((flags & 4) !== 0 ? 4 * count : 0)
        + k * count;
    if (buffer.byteLength !== headerBytes + expectFloats * 4) {
        throw new Error(`inst: byte length ${buffer.byteLength} does not match header arithmetic (${headerBytes} header + ${expectFloats} floats) — truncated or corrupt`);
    }

    let off = headerBytes;
    const block = (floats: number): Float32Array => {
        const a = new Float32Array(buffer, off, floats);
        off += floats * 4;
        return a;
    };
    const positions = block(3 * count);
    const sizes = (flags & 1) !== 0 ? block(count) : undefined;
    const colors = (flags & 2) !== 0 ? block(3 * count) : undefined;
    const orientations = (flags & 4) !== 0 ? block(4 * count) : undefined;
    const scalars: Record<string, Float32Array> = {};
    for (const name of names) scalars[name] = block(count);

    return {
        count, aabb, provenance, positions,
        ...(sizes !== undefined ? { sizes } : {}),
        ...(colors !== undefined ? { colors } : {}),
        ...(orientations !== undefined ? { orientations } : {}),
        scalars,
    };
}

/** Fetch (URL) or read (File — the drag-drop arm) and parse a `.inst` file. */
export async function loadInstances(src: string | File): Promise<InstanceTable> {
    if (typeof src === 'string') {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`inst: failed to fetch '${src}' (${res.status})`);
        return parseInstances(await res.arrayBuffer());
    }
    return parseInstances(await src.arrayBuffer());
}
