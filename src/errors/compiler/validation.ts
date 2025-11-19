// errors/compiler/validation.ts

import type { CompiledRenderer, RenderPipeline } from '../../compiler/types.js';
import type { ValidationResult } from '../types.js';

/**
 * Validate a CompiledRenderer structure
 *
 * TODO: Implement full validation:
 * - Check renderer has shaders
 * - Check renderer has pipeline
 * - Check pipeline is valid (validatePipeline)
 * - Check shader IDs referenced in passes exist in shaders map
 * - Check uniform bindings are valid
 */
export function validateCompiledRenderer(renderer: CompiledRenderer): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // TODO: Implement validation logic
    // For now, just basic checks
    if (!renderer.id) {
        errors.push('Renderer missing id');
    }

    if (!renderer.shaders || renderer.shaders.size === 0) {
        errors.push('Renderer has no shaders');
    }

    if (!renderer.pipeline) {
        errors.push('Renderer missing pipeline');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate a RenderPipeline structure
 *
 * TODO: Implement full validation:
 * - Check pipeline has framebuffers
 * - Check pipeline has passes
 * - Check framebuffer IDs in passes exist in framebuffers array
 * - Check texture IDs in pass inputs exist
 * - Check shader IDs in passes exist
 * - Validate execution types
 * - Validate swap instructions reference existing buffers
 */
export function validatePipeline(pipeline: RenderPipeline): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // TODO: Implement validation logic
    // For now, just basic checks
    if (!pipeline.framebuffers || pipeline.framebuffers.length === 0) {
        errors.push('Pipeline has no framebuffers');
    }

    if (!pipeline.passes || pipeline.passes.length === 0) {
        errors.push('Pipeline has no render passes');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}
