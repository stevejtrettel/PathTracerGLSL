// compiler/types.ts

import type { UniformBinding, ParameterMetadata } from '../engine/types';

/**
 * Texture binding for environment maps and other textures
 */
interface TextureBinding {
    uniform: string;
    textureId: string;
    type: 'sampler2D' | 'samplerCube';
}

/**
 * Compiled recipe ready for engine execution
 *
 * This is the output of the Compiler and input to the Engine.
 * It contains GLSL shader source code and metadata needed for execution.
 */
interface CompiledRecipe {
    id: string;
    name: string;
    description?: string;

    /**
     * Three shader programs as GLSL source strings
     */
    shaders: {
        /** Main accumulation shader (path tracing) */
        main: {
            vertex: string;
            fragment: string;
        };
        /** Display shader (tone mapping) */
        display: {
            vertex: string;
            fragment: string;
        };
        /** Composite shader (final output to screen) */
        composite: {
            vertex: string;
            fragment: string;
        };
    };

    /**
     * How to bind application parameters to shader uniforms
     */
    uniformBindings: UniformBinding[];

    /**
     * Texture bindings (environment maps, etc.)
     */
    textureBindings?: TextureBinding[];

    /**
     * Parameter metadata for UI and validation
     */
    parameters?: Record<string, ParameterMetadata>;

    /**
     * Rendering configuration
     */
    config?: {
        targetSamples?: number;
        renderMode?: 'interactive' | 'progressive' | 'production';
    };
}

export type {
    CompiledRecipe,
    TextureBinding
};
