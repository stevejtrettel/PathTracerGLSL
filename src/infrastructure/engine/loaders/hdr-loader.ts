// hdr-loader.ts

export interface HDRData {
    width: number;
    height: number;
    data: Float32Array;  // RGB floats (width * height * 3)
}

export class HDRLoader {
    /**
     * Parse an HDR file from raw bytes
     */
    static parse(buffer: ArrayBuffer): HDRData {
        const bytes = new Uint8Array(buffer);

        // Parse header to find dimensions and data start
        const header = this.parseHeader(bytes);

        // Decompress the RLE-encoded pixel data
        const rgbeData = this.decompressRLE(
            bytes,
            header.dataOffset,
            header.width,
            header.height
        );

        // Convert RGBE to float RGB
        const floatData = this.rgbeToFloat(rgbeData, header.width, header.height);

        return {
            width: header.width,
            height: header.height,
            data: floatData
        };
    }

    /**
     * Parse HDR header for dimensions
     */
    private static parseHeader(bytes: Uint8Array): {
        width: number;
        height: number;
        dataOffset: number;
    } {
        let offset = 0;
        let width = 0;
        let height = 0;

        // Read lines until we find resolution
        while (offset < bytes.length) {
            let line = '';

            // Read until newline
            while (offset < bytes.length && bytes[offset] !== 0x0A) {
                line += String.fromCharCode(bytes[offset++]);
            }
            offset++; // Skip newline

            // Check for resolution line: -Y [height] +X [width]
            const resMatch = line.match(/-Y (\d+) \+X (\d+)/);
            if (resMatch) {
                height = parseInt(resMatch[1]);
                width = parseInt(resMatch[2]);
                break;
            }
        }

        if (width === 0 || height === 0) {
            throw new Error('Failed to parse HDR dimensions');
        }

        return { width, height, dataOffset: offset };
    }

    /**
     * Decompress RLE-encoded scanlines
     */
    private static decompressRLE(
        bytes: Uint8Array,
        offset: number,
        width: number,
        height: number
    ): Uint8Array {
        const output = new Uint8Array(width * height * 4); // RGBE
        let outputOffset = 0;

        for (let y = 0; y < height; y++) {
            // Check for RLE scanline marker [2, 2, width_hi, width_lo]
            if (bytes[offset] !== 2 || bytes[offset + 1] !== 2) {
                // Not RLE, just raw pixels
                for (let x = 0; x < width * 4; x++) {
                    output[outputOffset++] = bytes[offset++];
                }
                continue;
            }

            // Verify scanline width
            const scanlineWidth = (bytes[offset + 2] << 8) | bytes[offset + 3];
            if (scanlineWidth !== width) {
                throw new Error(`Scanline width mismatch: ${scanlineWidth} vs ${width}`);
            }
            offset += 4;

            // Decompress each channel separately
            const scanlineBuffer = new Uint8Array(width * 4);

            for (let channel = 0; channel < 4; channel++) {
                let ptr = channel * width;
                let ptrEnd = (channel + 1) * width;

                while (ptr < ptrEnd) {
                    const byte1 = bytes[offset++];

                    if (byte1 > 128) {
                        // Run of same value
                        const count = byte1 - 128;
                        const value = bytes[offset++];

                        for (let i = 0; i < count; i++) {
                            scanlineBuffer[ptr++] = value;
                        }
                    } else {
                        // Literal values
                        const count = byte1;

                        for (let i = 0; i < count; i++) {
                            scanlineBuffer[ptr++] = bytes[offset++];
                        }
                    }
                }
            }

            // Interleave channels back to RGBE pixels
            for (let x = 0; x < width; x++) {
                output[outputOffset++] = scanlineBuffer[x];                // R
                output[outputOffset++] = scanlineBuffer[x + width];        // G
                output[outputOffset++] = scanlineBuffer[x + width * 2];    // B
                output[outputOffset++] = scanlineBuffer[x + width * 3];    // E
            }
        }

        return output;
    }

    /**
     * Convert RGBE bytes to float RGB
     */
    private static rgbeToFloat(
        rgbeData: Uint8Array,
        width: number,
        height: number
    ): Float32Array {
        const floatData = new Float32Array(width * height * 3); // RGB only
        let rgbeOffset = 0;
        let floatOffset = 0;

        for (let i = 0; i < width * height; i++) {
            const r = rgbeData[rgbeOffset++];
            const g = rgbeData[rgbeOffset++];
            const b = rgbeData[rgbeOffset++];
            const e = rgbeData[rgbeOffset++];

            // Convert RGBE to float: rgb * 2^(e-128)
            const scale = Math.pow(2, e - 128);

            floatData[floatOffset++] = (r / 255) * scale;
            floatData[floatOffset++] = (g / 255) * scale;
            floatData[floatOffset++] = (b / 255) * scale;
        }

        return floatData;
    }
}
