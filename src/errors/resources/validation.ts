// errors/resources/validation.ts

import { DiagnosticBag } from '../core/DiagnosticBag.js';

/**
 * HDR file validation configuration
 */
export interface HDRValidationConfig {
    maxWidth?: number;      // Default: 8192
    maxHeight?: number;     // Default: 8192
    minWidth?: number;      // Default: 16
    minHeight?: number;     // Default: 16
    maxFileSizeMB?: number; // Default: 100MB
}

const DEFAULT_HDR_CONFIG: Required<HDRValidationConfig> = {
    maxWidth: 8192,
    maxHeight: 8192,
    minWidth: 16,
    minHeight: 16,
    maxFileSizeMB: 100
};

/**
 * Validate HDR file fetch response
 */
export function validateHDRResponse(
    response: Response,
    path: string,
    bag?: DiagnosticBag
): DiagnosticBag {
    const diagnostics = bag ?? new DiagnosticBag('hdr-loader');

    if (!response.ok) {
        if (response.status === 404) {
            diagnostics.error('hdr-not-found', `HDR file not found: ${path}`)
                .suggest(`Check that the file exists at: ${path}`)
                .add();
        } else if (response.status === 403) {
            diagnostics.error('hdr-permission-denied', `Permission denied loading HDR file: ${path}`)
                .suggest('Check file permissions or CORS settings')
                .add();
        } else {
            diagnostics.error('hdr-fetch-failed',
                `Failed to load HDR file '${path}': ${response.status} ${response.statusText}`)
                .add();
        }
    }

    return diagnostics;
}

/**
 * Validate raw HDR buffer
 */
export function validateHDRBuffer(
    buffer: ArrayBuffer,
    path: string,
    config?: HDRValidationConfig,
    bag?: DiagnosticBag
): DiagnosticBag {
    const diagnostics = bag ?? new DiagnosticBag('hdr-loader');
    const cfg = { ...DEFAULT_HDR_CONFIG, ...config };

    // Check for empty buffer
    if (buffer.byteLength === 0) {
        diagnostics.error('hdr-empty', `HDR file is empty: ${path}`).add();
        return diagnostics;
    }

    // Check file size
    const sizeMB = buffer.byteLength / (1024 * 1024);
    if (sizeMB > cfg.maxFileSizeMB) {
        diagnostics.error('hdr-too-large',
            `HDR file too large: ${sizeMB.toFixed(1)}MB exceeds limit of ${cfg.maxFileSizeMB}MB`)
            .suggest(`Use a smaller HDR file or increase maxFileSizeMB limit`)
            .add();
    }

    // Check for minimal HDR header signature
    const bytes = new Uint8Array(buffer);
    const headerStart = String.fromCharCode(...Array.from(bytes.slice(0, 11)));

    if (!headerStart.startsWith('#?RADIANCE') && !headerStart.startsWith('#?RGBE')) {
        diagnostics.warning('hdr-invalid-header',
            `HDR file '${path}' does not have standard Radiance header`)
            .suggest('This may cause parsing errors. Ensure file is in RGBE/HDR format.')
            .add();
    }

    return diagnostics;
}

/**
 * Validate parsed HDR dimensions and data
 */
export function validateHDRData(
    width: number,
    height: number,
    dataLength: number,
    _path: string,
    config?: HDRValidationConfig,
    bag?: DiagnosticBag
): DiagnosticBag {
    const diagnostics = bag ?? new DiagnosticBag('hdr-loader');
    const cfg = { ...DEFAULT_HDR_CONFIG, ...config };

    // Validate dimensions
    if (width <= 0 || height <= 0) {
        diagnostics.error('hdr-invalid-dimensions', `Invalid HDR dimensions: ${width}x${height}`)
            .add();
    }

    if (width < cfg.minWidth || height < cfg.minHeight) {
        diagnostics.error('hdr-too-small',
            `HDR dimensions too small: ${width}x${height} (minimum: ${cfg.minWidth}x${cfg.minHeight})`)
            .add();
    }

    if (width > cfg.maxWidth || height > cfg.maxHeight) {
        diagnostics.error('hdr-too-large-dimensions',
            `HDR dimensions too large: ${width}x${height} (maximum: ${cfg.maxWidth}x${cfg.maxHeight})`)
            .add();
    }

    // Validate power-of-two (recommended for some GPUs)
    const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;
    if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
        diagnostics.warning('hdr-non-pot',
            `HDR dimensions ${width}x${height} are not power-of-two`)
            .suggest('This may cause performance issues on some GPUs.')
            .add();
    }

    // Validate data size (RGB = 3 floats per pixel)
    const expectedLength = width * height * 3;
    if (dataLength !== expectedLength) {
        diagnostics.error('hdr-data-mismatch',
            `HDR data size mismatch: expected ${expectedLength} floats (${width}x${height}x3), got ${dataLength}`)
            .add();
    }

    // Check for reasonable aspect ratio
    const aspectRatio = width / height;
    if (aspectRatio > 4 || aspectRatio < 0.25) {
        diagnostics.warning('hdr-unusual-aspect',
            `Unusual HDR aspect ratio: ${aspectRatio.toFixed(2)}:1`)
            .suggest('Environment maps are typically 2:1 (equirectangular).')
            .add();
    }

    return diagnostics;
}

/**
 * Validate WebGL texture creation
 */
export function validateTextureCreation(
    texture: WebGLTexture | null,
    width: number,
    height: number,
    gl: WebGL2RenderingContext,
    bag?: DiagnosticBag
): DiagnosticBag {
    const diagnostics = bag ?? new DiagnosticBag('hdr-loader');

    if (!texture) {
        diagnostics.error('texture-create-failed', 'Failed to create WebGL texture')
            .suggest('GPU may be out of memory or context may be lost')
            .add();
        return diagnostics;
    }

    // Check WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        const errorName = getGLErrorName(error, gl);
        diagnostics.error('texture-gl-error',
            `WebGL error during texture creation: ${errorName} (0x${error.toString(16)})`)
            .add();
    }

    // Check against WebGL limits
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (width > maxTextureSize || height > maxTextureSize) {
        diagnostics.error('texture-exceeds-limit',
            `Texture size ${width}x${height} exceeds GPU limit ${maxTextureSize}x${maxTextureSize}`)
            .suggest(`Use a smaller HDR file (max ${maxTextureSize}px)`)
            .add();
    }

    return diagnostics;
}

/**
 * Comprehensive HDR loading validation
 *
 * Validates the entire HDR loading pipeline:
 * 1. Fetch response
 * 2. Buffer contents
 * 3. Parsed dimensions and data
 * 4. WebGL texture creation
 */
export function validateHDRLoad(
    response: Response,
    buffer: ArrayBuffer,
    width: number,
    height: number,
    dataLength: number,
    texture: WebGLTexture | null,
    gl: WebGL2RenderingContext,
    path: string,
    config?: HDRValidationConfig
): DiagnosticBag {
    const diagnostics = new DiagnosticBag('hdr-loader');

    // Step 1: Validate response
    validateHDRResponse(response, path, diagnostics);

    // Step 2: Validate buffer (only if response was OK)
    if (!diagnostics.hasErrors()) {
        validateHDRBuffer(buffer, path, config, diagnostics);
    }

    // Step 3: Validate parsed data (only if buffer was valid)
    if (!diagnostics.hasErrors()) {
        validateHDRData(width, height, dataLength, path, config, diagnostics);
    }

    // Step 4: Validate texture (only if data was valid)
    if (!diagnostics.hasErrors()) {
        validateTextureCreation(texture, width, height, gl, diagnostics);
    }

    return diagnostics;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get human-readable WebGL error name
 */
function getGLErrorName(error: number, gl: WebGL2RenderingContext): string {
    switch (error) {
        case gl.INVALID_ENUM: return 'INVALID_ENUM';
        case gl.INVALID_VALUE: return 'INVALID_VALUE';
        case gl.INVALID_OPERATION: return 'INVALID_OPERATION';
        case gl.OUT_OF_MEMORY: return 'OUT_OF_MEMORY';
        case gl.INVALID_FRAMEBUFFER_OPERATION: return 'INVALID_FRAMEBUFFER_OPERATION';
        case gl.CONTEXT_LOST_WEBGL: return 'CONTEXT_LOST_WEBGL';
        default: return 'UNKNOWN_ERROR';
    }
}
