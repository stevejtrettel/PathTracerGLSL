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

            rgbe[i * 4 + 0] = Math.min(255, Math.floor(r * scale));
            rgbe[i * 4 + 1] = Math.min(255, Math.floor(g * scale));
            rgbe[i * 4 + 2] = Math.min(255, Math.floor(b * scale));
            rgbe[i * 4 + 3] = exponent + 128;
        }
    }

    return rgbe;
}

/**
 * Build HDR file with header. The stamp goes in as `# key=value` comment lines —
 * legal anywhere between the magic line and the resolution line, ignored by readers.
 */
export function buildHDRFile(rgbeData: Uint8Array, width: number, height: number, stamp?: RenderStamp): Uint8Array {
    const lines = ['#?RADIANCE', 'FORMAT=32-bit_rle_rgbe'];
    if (stamp) {
        for (const [key, value] of stampEntries(stamp)) lines.push(`# ${key}=${value}`);
    }
    // The resolution line must stay last, preceded by the blank line ending the header.
    lines.push('', `-Y ${height} +X ${width}`, '');
    const header = lines.join('\n');

    const headerBytes = new TextEncoder().encode(header);
    const totalSize = headerBytes.length + width * height * 4;
    const fileData = new Uint8Array(totalSize);

    fileData.set(headerBytes, 0);

    let offset = headerBytes.length;
    for (let y = height - 1; y >= 0; y--) {
        const rowStart = y * width * 4;
        const rowEnd = rowStart + width * 4;
        fileData.set(rgbeData.slice(rowStart, rowEnd), offset);
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

    const blob = new Blob([hdrFile as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ---- PNG tEXt stamping ------------------------------------------------------
// canvas.toBlob writes a bare PNG; the stamp is spliced in afterwards as one
// tEXt chunk per entry (keyword `pathtracer:<key>`), inserted right after IHDR.

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

function textChunk(keyword: string, text: string): Uint8Array {
    // tEXt: length | 'tEXt' | keyword \0 text | CRC(type+data). Both strings are
    // ASCII by construction (stampEntries escapes), so TextEncoder is safe.
    const data = new TextEncoder().encode(`${keyword}\0${text}`);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set([0x74, 0x45, 0x58, 0x74], 4); // 'tEXt'
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
}

/** Splice the stamp into an encoded PNG as tEXt chunks (exported for tests/tooling). */
export async function embedPNGStamp(blob: Blob, stamp: RenderStamp): Promise<Blob> {
    const png = new Uint8Array(await blob.arrayBuffer());
    // 8-byte signature, then IHDR (always first): 12 bytes of framing + data.
    const ihdrLength = new DataView(png.buffer).getUint32(8);
    const insertAt = 8 + 12 + ihdrLength;
    const chunks = stampEntries(stamp).map(([key, value]) => textChunk(`pathtracer:${key}`, value));
    const total = png.length + chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    out.set(png.subarray(0, insertAt), 0);
    let offset = insertAt;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    out.set(png.subarray(insertAt), offset);
    return new Blob([out as BlobPart], { type: 'image/png' });
}

/**
 * Save PNG file
 */
export function savePNGFile(pixels: Uint8Array, width: number, height: number, filename: string, stamp?: RenderStamp): void {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Create ImageData and flip Y
    const imageData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = ((height - 1 - y) * width + x) * 4;
            const dstIdx = (y * width + x) * 4;

            imageData.data[dstIdx + 0] = pixels[srcIdx + 0];
            imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
            imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
            imageData.data[dstIdx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob(async (blob) => {
        if (!blob) return;
        if (stamp) blob = await embedPNGStamp(blob, stamp);

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 'image/png');
}
