// compiler/Compiler.ts

import type { Recipe, UniformBinding, ParameterMetadata } from '../engine/types';
import type { CompiledRecipe, TextureBinding } from './types';
import {
    buildMainShaderSource,
    buildDisplayShaderSource,
    buildVertexShaderSource
} from './utils/shader-builder-utils';

/**
 * Compiler - Transforms recipes into compiled shaders
 *
 * Takes high-level recipes (module composition) and generates
 * complete GLSL shader programs ready for WebGL compilation.
 *
 * Current implementation: Concatenates modules in dependency order.
 * Future: Will perform analysis and generate optimized code without module boundaries.
 */
class Compiler {
    /**
     * Compile a recipe into GLSL shader programs
     *
     * @param recipe - Recipe with module composition
     * @returns CompiledRecipe with GLSL source code
     */
    compile(recipe: Recipe): CompiledRecipe {
        // Collect all modules from recipe
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

        // Build shader sources using existing concatenation logic
        const vertexSource = buildVertexShaderSource();
        const mainFragmentSource = buildMainShaderSource(modules);
        const displayFragmentSource = buildDisplayShaderSource(modules);
        const compositeFragmentSource = this.buildCompositeShaderSource();

        // Collect uniform bindings from all modules
        const uniformBindings = this.collectUniformBindings(modules);

        // Collect texture bindings from all modules
        const textureBindings = this.collectTextureBindings(modules);

        // Collect parameter metadata from all modules
        const parameters = this.collectParameters(modules);

        return {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description,
            shaders: {
                main: {
                    vertex: vertexSource,
                    fragment: mainFragmentSource
                },
                display: {
                    vertex: vertexSource,
                    fragment: displayFragmentSource
                },
                composite: {
                    vertex: vertexSource,
                    fragment: compositeFragmentSource
                }
            },
            uniformBindings,
            textureBindings,
            parameters,
            config: recipe.config
        };
    }

    /**
     * Build the simple composite shader (passthrough to screen)
     */
    private buildCompositeShaderSource(): string {
        return `#version 300 es
precision highp float;

uniform sampler2D u_rgb_texture;

out vec4 fragColor;

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    vec3 color = texelFetch(u_rgb_texture, coord, 0).rgb;
    fragColor = vec4(color, 1.0);
}`;
    }

    /**
     * Collect uniform bindings from all modules
     */
    private collectUniformBindings(modules: Array<{ uniformBindings?: UniformBinding[] }>): UniformBinding[] {
        const bindings: UniformBinding[] = [];

        for (const module of modules) {
            if (module.uniformBindings) {
                bindings.push(...module.uniformBindings);
            }
        }

        return bindings;
    }

    /**
     * Collect texture bindings from all modules
     * (Currently minimal, will expand when environment maps are properly integrated)
     */
    private collectTextureBindings(modules: Array<any>): TextureBinding[] | undefined {
        // TODO: Implement texture binding collection
        // For now, return undefined (no texture bindings)
        return undefined;
    }

    /**
     * Collect parameter metadata from all modules
     */
    private collectParameters(modules: Array<{ parameters?: Record<string, ParameterMetadata> }>): Record<string, ParameterMetadata> | undefined {
        const allParameters: Record<string, ParameterMetadata> = {};
        let hasParameters = false;

        for (const module of modules) {
            if (module.parameters) {
                Object.assign(allParameters, module.parameters);
                hasParameters = true;
            }
        }

        return hasParameters ? allParameters : undefined;
    }
}

export { Compiler };
