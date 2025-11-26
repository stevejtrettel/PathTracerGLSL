// app/utils/file-export.ts

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
 * Build HDR file with header
 */
export function buildHDRFile(rgbeData: Uint8Array, width: number, height: number): Uint8Array {
    const header = [
        '#?RADIANCE',
        'FORMAT=32-bit_rle_rgbe',
        '',
        `-Y ${height} +X ${width}`,
        ''
    ].join('\n');

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
export function saveHDRFile(pixels: Float32Array, width: number, height: number, filename: string): void {
    const rgbe = floatToRGBE(pixels, width, height);
    const hdrFile = buildHDRFile(rgbe, width, height);

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

/**
 * Save PNG file
 */
export function savePNGFile(pixels: Uint8Array, width: number, height: number, filename: string): void {
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

    canvas.toBlob((blob) => {
        if (!blob) return;

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
