// app/utils/file-export.ts

/**
 * Reproducibility stamp — everything needed to re-produce an exported image:
 * the scene, the full strategy JSON, the live parameters (camera pose etc.),
 * the sample count, the RNG salt, and the code revision. Written into the
 * Radiance header as comment lines and into PNG as tEXt chunks.
 */
export interface RenderStamp {
    scene: string;
    strategy: unknown;
    parameters: Record<string, unknown>;
    spp: number;
    resolution: [number, number];
    resetSalt: number;
    git: string;
    date: string;
}

function stampEntries(stamp: RenderStamp): Array<[string, string]> {
    // Values must be single-line (Radiance headers are line-based) and ASCII-safe
    // (PNG tEXt is Latin-1): JSON.stringify emits no newlines, and escapeAscii
    // handles the rest.
    return [
        ['scene', stamp.scene],
        ['strategy', JSON.stringify(stamp.strategy)],
        ['parameters', JSON.stringify(stamp.parameters)],
        ['spp', String(stamp.spp)],
        ['resolution', `${stamp.resolution[0]}x${stamp.resolution[1]}`],
        ['resetSalt', String(stamp.resetSalt)],
        ['git', stamp.git],
        ['date', stamp.date],
    ].map(([k, v]) => [k, escapeAscii(v)] as [string, string]);
}

function escapeAscii(s: string): string {
    return s.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * Convert Float32Array RGBA → RGBE format
 */
export function floatToRGBE(floats: Float32Array, width: number, height: number): Uint8Array {
    const rgbe = new Uint8Array(width * height * 4);

    for (let i = 0; i < width * height; i++) {
        const r = floats[i * 4 + 0];
        const g = floats[i * 4 + 1];
        const b = floats[i * 4 + 2];

        const maxVal = Math.max(r, g, b);

        if (maxVal < 1e-32) {
            rgbe[i * 4 + 0] = 0;
            rgbe[i * 4 + 1] = 0;
            rgbe[i * 4 + 2] = 0;
            rgbe[i * 4 + 3] = 0;
        } else {
            let exponent = Math.floor(Math.log2(maxVal)) + 1;
            const scale = Math.pow(2, -exponent) * 256;
            exponent = Math.max(-128, Math.min(127, exponent));

            // Clamped at 0 too: a Uint8Array stores -26 as 230, so a negative channel
            // (a transport bug, but it happens) would surface as a bright one.
            rgbe[i * 4 + 0] = Math.max(0, Math.min(255, Math.floor(r * scale)));
            rgbe[i * 4 + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
            rgbe[i * 4 + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
            rgbe[i * 4 + 3] = exponent + 128;
        }
    }

    return rgbe;
}

/**
 * The Radiance header. The stamp goes in as `# key=value` comment lines — legal anywhere
 * between the magic line and the resolution line, ignored by readers. The pixel rows that
 * follow run top to bottom (`-Y height`).
 */
export function hdrHeader(width: number, height: number, stamp?: RenderStamp): Uint8Array {
    const lines = ['#?RADIANCE', 'FORMAT=32-bit_rle_rgbe'];
    if (stamp) {
        for (const [key, value] of stampEntries(stamp)) lines.push(`# ${key}=${value}`);
    }
    // The resolution line must stay last, preceded by the blank line ending the header.
    lines.push('', `-Y ${height} +X ${width}`, '');
    return new TextEncoder().encode(lines.join('\n'));
}

/**
 * Build an HDR file from RGBE rows stored bottom row first (the readPixels order).
 */
export function buildHDRFile(rgbeData: Uint8Array, width: number, height: number, stamp?: RenderStamp): Uint8Array {
    const headerBytes = hdrHeader(width, height, stamp);
    const fileData = new Uint8Array(headerBytes.length + width * height * 4);
    fileData.set(headerBytes, 0);

    let offset = headerBytes.length;
    for (let y = height - 1; y >= 0; y--) {
        fileData.set(rgbeData.subarray(y * width * 4, (y + 1) * width * 4), offset);
        offset += width * 4;
    }
    return fileData;
}

/**
 * Save HDR file
 */
export function saveHDRFile(pixels: Float32Array, width: number, height: number, filename: string, stamp?: RenderStamp): void {
    const rgbe = floatToRGBE(pixels, width, height);
    const hdrFile = buildHDRFile(rgbe, width, height, stamp);
    downloadBlob(new Blob([hdrFile as BlobPart], { type: 'application/octet-stream' }), filename);
}

/** Hand a blob to the browser as a download. The object URL is released a minute later,
 *  not at once: revoking right after click() can cancel a large download in some browsers. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- PNG ---------------------------------------------------------------------
// Written directly rather than through canvas.toBlob: a canvas is capped by the browser's
// canvas-area limit (Safari's is 16.7 M pixels — less than one 8K frame), and toBlob
// reports failure only as a null blob. The stamp goes in as tEXt chunks (keyword
// `pathtracer:<key>`) right after IHDR.

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length | type | data | CRC(type + data). */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encode an 8-bit RGB PNG. `rowRGBA(y)` returns row y, counted from the TOP, as RGBA bytes
 * (alpha is dropped). Every scanline uses the Paeth filter, and the scanlines stream through
 * the browser's zlib: CompressionStream('deflate') produces the RFC 1950 stream that IDAT
 * holds, so no full-size intermediate is ever built.
 */
export async function encodePNG(
    width: number,
    height: number,
    rowRGBA: (y: number) => Uint8Array,
    stamp?: RenderStamp,
): Promise<Blob> {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr.set([8, 2, 0, 0, 0], 8);   // bit depth 8, color type 2 (RGB), deflate, adaptive filtering, no interlace

    const deflate = new CompressionStream('deflate');
    const compressed = readChunks(deflate.readable);   // read while writing, or backpressure stalls the writes
    const writer = deflate.writable.getWriter();

    const stride = 1 + 3 * width;
    const rowsPerWrite = Math.max(1, Math.floor((1 << 20) / stride));
    let above = new Uint8Array(3 * width);   // the row above the first counts as zero
    let row = new Uint8Array(3 * width);
    for (let y0 = 0; y0 < height; y0 += rowsPerWrite) {
        const n = Math.min(rowsPerWrite, height - y0);
        const out = new Uint8Array(n * stride);
        for (let i = 0; i < n; i++) {
            const src = rowRGBA(y0 + i);
            for (let x = 0; x < width; x++) {
                row[3 * x] = src[4 * x];
                row[3 * x + 1] = src[4 * x + 1];
                row[3 * x + 2] = src[4 * x + 2];
            }
            out[i * stride] = 4;   // filter type 4: Paeth
            paethFilter(row, above, out, i * stride + 1);
            [above, row] = [row, above];
        }
        await writer.write(out);
    }
    await writer.close();

    const parts: Uint8Array[] = [PNG_SIGNATURE, pngChunk('IHDR', ihdr)];
    if (stamp) {
        for (const [key, value] of stampEntries(stamp)) {
            // tEXt data: keyword \0 text. Both are ASCII by construction (stampEntries escapes).
            parts.push(pngChunk('tEXt', new TextEncoder().encode(`pathtracer:${key}\0${value}`)));
        }
    }
    for (const data of await compressed) parts.push(pngChunk('IDAT', data));
    parts.push(pngChunk('IEND', new Uint8Array(0)));
    return new Blob(parts as BlobPart[], { type: 'image/png' });
}

/** Paeth-filter one RGB scanline (3 bytes per pixel) into out[at..]. */
function paethFilter(row: Uint8Array, above: Uint8Array, out: Uint8Array, at: number): void {
    for (let i = 0; i < row.length; i++) {
        const a = i >= 3 ? row[i - 3] : 0;     // left
        const b = above[i];                    // up
        const c = i >= 3 ? above[i - 3] : 0;   // up-left
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[at + i] = (row[i] - predictor) & 0xff;
    }
}

async function readChunks(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return chunks;
        chunks.push(value);
    }
}

/**
 * Save a PNG from RGBA bytes stored bottom row first (the readPixels order).
 */
export async function savePNGFile(pixels: Uint8Array, width: number, height: number, filename: string, stamp?: RenderStamp): Promise<void> {
    const rowBytes = width * 4;
    const blob = await encodePNG(width, height,
        (y) => pixels.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), stamp);
    downloadBlob(blob, filename);
}
