// tests/witnesses/scenes/png.ts — a minimal PNG encoder for witness images: 8-bit gray or RGB,
// no filtering, one stored (uncompressed) deflate block. It runs in the browser and in node, so
// a fixture can state its image as a table of codes and still hand the App an ordinary file.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
    let a = 1, b = 0;
    for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: number[]): number[] {
    const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat(data));
    return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/**
 * The PNG file of an 8-bit image, rows from the top: `rows[j][i]` is the code of column i, row j
 * (one number per pixel for gray, an [r, g, b] triple for RGB).
 */
export function encodePng(rows: readonly (readonly (number | readonly [number, number, number])[])[]): Uint8Array {
    const height = rows.length, width = rows[0].length;
    const rgb = Array.isArray(rows[0][0]);
    // Each scanline is a filter byte (0: none) and the row's samples.
    const raw: number[] = [];
    for (const row of rows) {
        if (row.length !== width) throw new Error('encodePng: rows differ in length');
        raw.push(0);
        for (const px of row) raw.push(...(rgb ? (px as readonly number[]) : [px as number]));
    }
    if (raw.length > 0xffff) throw new Error('encodePng: one stored block holds at most 65535 bytes');
    const scan = new Uint8Array(raw);
    // zlib stream: header, one final stored block (LEN, NLEN), the bytes, then their Adler-32.
    const zlib = [0x78, 0x01, 0x01, raw.length & 0xff, raw.length >>> 8, ~raw.length & 0xff, (~raw.length >>> 8) & 0xff, ...raw, ...u32(adler32(scan))];
    const ihdr = [...u32(width), ...u32(height), 8, rgb ? 2 : 0, 0, 0, 0];
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk('IHDR', ihdr), ...chunk('IDAT', zlib), ...chunk('IEND', []),
    ]);
}

/** A `data:` URL of the PNG of `rows` (see encodePng). */
export function pngDataUrl(rows: Parameters<typeof encodePng>[0]): string {
    let binary = '';
    for (const b of encodePng(rows)) binary += String.fromCharCode(b);
    return `data:image/png;base64,${btoa(binary)}`;
}
