// errors/engine/validation.ts

import type { Recipe, ModuleDescriptor, ValidationResult, ModuleKind } from '../../infrastructure/engine/types';

/**
 * Validate that recipe modules are in correct slots
 *
 * Ensures each module's 'kind' matches the slot it's assigned to.
 * This prevents silent failures from wrong modules in wrong slots.
 */
export function validateRecipe(recipe: Recipe): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate world modules
    if (recipe.world.ambient.id.kind !== 'ambient') {
        errors.push(
            `Recipe '${recipe.id}': ambient slot requires 'ambient' module, ` +
            `got '${recipe.world.ambient.id.kind}' (${recipe.world.ambient.id.name})`
        );
    }

    if (recipe.world.environment.id.kind !== 'environment') {
        errors.push(
            `Recipe '${recipe.id}': environment slot requires 'environment' module, ` +
            `got '${recipe.world.environment.id.kind}' (${recipe.world.environment.id.name})`
        );
    }

    if (recipe.world.scene.id.kind !== 'scene') {
        errors.push(
            `Recipe '${recipe.id}': scene slot requires 'scene' module, ` +
            `got '${recipe.world.scene.id.kind}' (${recipe.world.scene.id.name})`
        );
    }

    if (recipe.world.lighting.id.kind !== 'lighting') {
        errors.push(
            `Recipe '${recipe.id}': lighting slot requires 'lighting' module, ` +
            `got '${recipe.world.lighting.id.kind}' (${recipe.world.lighting.id.name})`
        );
    }

    // Validate optics modules
    if (recipe.optics.camera.id.kind !== 'camera') {
        errors.push(
            `Recipe '${recipe.id}': camera slot requires 'camera' module, ` +
            `got '${recipe.optics.camera.id.kind}' (${recipe.optics.camera.id.name})`
        );
    }

    if (recipe.optics.interaction.id.kind !== 'interaction') {
        errors.push(
            `Recipe '${recipe.id}': interaction slot requires 'interaction' module, ` +
            `got '${recipe.optics.interaction.id.kind}' (${recipe.optics.interaction.id.name})`
        );
    }

    if (recipe.optics.transport.id.kind !== 'transport') {
        errors.push(
            `Recipe '${recipe.id}': transport slot requires 'transport' module, ` +
            `got '${recipe.optics.transport.id.kind}' (${recipe.optics.transport.id.name})`
        );
    }

    if (recipe.optics.accumulator.id.kind !== 'accumulator') {
        errors.push(
            `Recipe '${recipe.id}': accumulator slot requires 'accumulator' module, ` +
            `got '${recipe.optics.accumulator.id.kind}' (${recipe.optics.accumulator.id.name})`
        );
    }

    if (recipe.optics.developer.id.kind !== 'developer') {
        errors.push(
            `Recipe '${recipe.id}': developer slot requires 'developer' module, ` +
            `got '${recipe.optics.developer.id.kind}' (${recipe.optics.developer.id.name})`
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate module uniform bindings match GLSL declarations
 *
 * Ensures uniformBindings reference uniforms that actually exist in the GLSL code.
 * This prevents silent failures where uniforms are never bound.
 */
export function validateModuleUniforms(module: ModuleDescriptor): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Skip validation if no bindings declared
    if (!module.uniformBindings || module.uniformBindings.length === 0) {
        return { valid: true, errors, warnings };
    }

    // Parse uniform declarations from GLSL
    const declaredUniforms = parseUniformDeclarations(module.fragment.uniforms || '');

    // Check each binding references a declared uniform
    for (const binding of module.uniformBindings) {
        const uniformName = binding.uniform;

        if (!declaredUniforms.has(uniformName)) {
            errors.push(
                `Module '${module.id.kind}/${module.id.name}': ` +
                `uniformBinding references '${uniformName}' but uniform not declared in GLSL`
            );
        }
    }

    // Warn about declared uniforms with no bindings
    // (These might be engine uniforms, so just warn)
    const boundUniforms = new Set(module.uniformBindings.map(b => b.uniform));

    for (const uniformName of declaredUniforms) {
        if (!boundUniforms.has(uniformName) && !isEngineUniform(uniformName)) {
            warnings.push(
                `Module '${module.id.kind}/${module.id.name}': ` +
                `uniform '${uniformName}' declared but has no uniformBinding`
            );
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate all modules in a recipe
 */
export function validateRecipeModules(recipe: Recipe): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    const modules = [
        recipe.world.ambient,
        recipe.world.environment,
        recipe.world.scene,
        recipe.world.lighting,
        recipe.optics.camera,
        recipe.optics.interaction,
        recipe.optics.transport,
        recipe.optics.accumulator,
        recipe.optics.developer
    ];

    for (const module of modules) {
        const result = validateModuleUniforms(module);
        allErrors.push(...result.errors);
        if (result.warnings) {
            allWarnings.push(...result.warnings);
        }
    }

    return {
        valid: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse uniform declarations from GLSL code
 * Returns set of uniform names found
 */
function parseUniformDeclarations(glslCode: string): Set<string> {
    const uniforms = new Set<string>();

    // Match: uniform <type> <name>;
    // Handles single declarations and multiple on one line
    const uniformRegex = /uniform\s+\w+\s+(\w+)\s*;/g;

    let match;
    while ((match = uniformRegex.exec(glslCode)) !== null) {
        uniforms.add(match[1]);
    }

    return uniforms;
}

/**
 * Check if a uniform is provided by the engine
 * Engine uniforms don't need module-level bindings
 */
function isEngineUniform(uniformName: string): boolean {
    const engineUniforms = [
        'u_resolution',
        'u_imageSize',
        'u_frameIndex',
        'u_time',
        'u_sampleCount',
        'u_pixelOffset',
        'u_accumulator_radiance_previous',
        'u_radiance_texture',
        'u_rgb_texture',
        'u_env_map',
        'u_env_cdf_conditional',
        'u_env_cdf_marginal',
        'u_env_size',
        'u_env_totalWeight'
    ];

    return engineUniforms.includes(uniformName);
}
