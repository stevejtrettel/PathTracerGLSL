// errors/index.ts
// Unified error system for the path tracer

// Core diagnostic system
export * from './core/index.js';

// Reporters (console, JSON output)
export * from './reporters/index.js';

// Resource validation (HDR loading, textures)
export {
    validateHDRResponse,
    validateHDRBuffer,
    validateHDRData,
    validateTextureCreation,
    validateHDRLoad,
    type HDRValidationConfig
} from './resources/validation.js';
