// errors/resources/validation.ts

import type { ValidationResult } from '../../engine/types';

/**
 * HDR file validation configuration
 */
interface HDRValidationConfig {
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
    path: string
): ValidationResult {
    const errors: string[] = [];

    if (!response.ok) {
        if (response.status === 404) {
            errors.push(`HDR file not found: ${path}`);
        } else if (response.status === 403) {
            errors.push(`Permission denied loading HDR file: ${path}`);
        } else {
            errors.push(
                `Failed to load HDR file '${path}': ${response.status} ${response.statusText}`
            );
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate raw HDR buffer
 */
export function validateHDRBuffer(
    buffer: ArrayBuffer,
    path: string,
    config?: HDRValidationConfig
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const cfg = { ...DEFAULT_HDR_CONFIG, ...config };

    // Check for empty buffer
    if (buffer.byteLength === 0) {
        errors.push(`HDR file is empty: ${path}`);
        return { valid: false, errors };
    }

    // Check file size
    const sizeMB = buffer.byteLength / (1024 * 1024);
    if (sizeMB > cfg.maxFileSizeMB) {
        errors.push(
            `HDR file too large: ${sizeMB.toFixed(1)}MB exceeds limit of ${cfg.maxFileSizeMB}MB`
        );
    }

    // Check for minimal HDR header signature
    const bytes = new Uint8Array(buffer);
    const headerStart = String.fromCharCode(...Array.from(bytes.slice(0, 11)));

    if (!headerStart.startsWith('#?RADIANCE') && !headerStart.startsWith('#?RGBE')) {
        warnings.push(
            `HDR file '${path}' does not have standard Radiance header. ` +
            `This may cause parsing errors.`
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate parsed HDR dimensions and data
 */
export function validateHDRData(
    width: number,
    height: number,
    dataLength: number,
    path: string,
    config?: HDRValidationConfig
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const cfg = { ...DEFAULT_HDR_CONFIG, ...config };

    // Validate dimensions
    if (width <= 0 || height <= 0) {
        errors.push(`Invalid HDR dimensions: ${width}x${height}`);
    }

    if (width < cfg.minWidth || height < cfg.minHeight) {
        errors.push(
            `HDR dimensions too small: ${width}x${height} ` +
            `(minimum: ${cfg.minWidth}x${cfg.minHeight})`
        );
    }

    if (width > cfg.maxWidth || height > cfg.maxHeight) {
        errors.push(
            `HDR dimensions too large: ${width}x${height} ` +
            `(maximum: ${cfg.maxWidth}x${cfg.maxHeight})`
        );
    }

    // Validate power-of-two (recommended for some GPUs)
    const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;
    if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
        warnings.push(
            `HDR dimensions ${width}x${height} are not power-of-two. ` +
            `This may cause performance issues on some GPUs.`
        );
    }

    // Validate data size (RGB = 3 floats per pixel)
    const expectedLength = width * height * 3;
    if (dataLength !== expectedLength) {
        errors.push(
            `HDR data size mismatch: expected ${expectedLength} floats ` +
            `(${width}x${height}x3), got ${dataLength}`
        );
    }

    // Check for reasonable aspect ratio
    const aspectRatio = width / height;
    if (aspectRatio > 4 || aspectRatio < 0.25) {
        warnings.push(
            `Unusual HDR aspect ratio: ${aspectRatio.toFixed(2)}:1. ` +
            `Environment maps are typically 2:1 (equirectangular).`
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate WebGL texture creation
 */
export function validateTextureCreation(
    texture: WebGLTexture | null,
    width: number,
    height: number,
    gl: WebGL2RenderingContext
): ValidationResult {
    const errors: string[] = [];

    if (!texture) {
        errors.push('Failed to create WebGL texture');
        return { valid: false, errors };
    }

    // Check WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        const errorName = getGLErrorName(error, gl);
        errors.push(`WebGL error during texture creation: ${errorName} (0x${error.toString(16)})`);
    }

    // Check against WebGL limits
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (width > maxTextureSize || height > maxTextureSize) {
        errors.push(
            `Texture size ${width}x${height} exceeds GPU limit ${maxTextureSize}x${maxTextureSize}`
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
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
): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    // Step 1: Validate response
    const responseResult = validateHDRResponse(response, path);
    allErrors.push(...responseResult.errors);

    // Step 2: Validate buffer
    const bufferResult = validateHDRBuffer(buffer, path, config);
    allErrors.push(...bufferResult.errors);
    if (bufferResult.warnings) {
        allWarnings.push(...bufferResult.warnings);
    }

    // Step 3: Validate parsed data
    const dataResult = validateHDRData(width, height, dataLength, path, config);
    allErrors.push(...dataResult.errors);
    if (dataResult.warnings) {
        allWarnings.push(...dataResult.warnings);
    }

    // Step 4: Validate texture
    const textureResult = validateTextureCreation(texture, width, height, gl);
    allErrors.push(...textureResult.errors);

    return {
        valid: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings.length > 0 ? allWarnings : undefined
    };
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
