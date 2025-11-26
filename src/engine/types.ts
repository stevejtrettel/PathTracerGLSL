// engine/types.ts

/**
 * Module execution order for shader compilation
 * Determines dependency chain from foundation to final output
 */
const MODULE_ORDER = [
    'ambient',      // Foundation: mathematical space
    'scene',        // Geometry and materials
    'environment',  // Environment maps and fog
    'lighting',     // Light sources
    'camera',       // Ray generation
    'interaction',  // BRDFs and light-matter physics
    'transport',    // Integration algorithms
    'accumulator',  // Sample accumulation
    'developer'     // Tone mapping and output
] as const;

/**
 * Valid module types
 */
export type ModuleKind =
    | 'ambient'        // ambient_*
    | 'environment'    // environment_*
    | 'scene'          // scene_*
    | 'lighting'       // lighting_*
    | 'camera'         // camera_*
    | 'interaction'    // interaction_*
    | 'transport'      // transport_*
    | 'accumulator'    // accumulator_*
    | 'developer'      // developer_*
    | 'test';          // test_*

/**
 * Module descriptor with GLSL code and metadata
 */
export interface ModuleDescriptor {
    id: {
        kind: ModuleKind;
        name: string;
        version: string;
    };

    fragment: {
        functions: string;
        uniforms?: string;
        constants?: string;
    };

    uniformBindings?: UniformBinding[];
    exports?: string[];  // Optional: may be removed in favor of GLSL compiler validation

    /**
     * Parameter definitions for this module
     * Maps parameter paths to their metadata (type, default, range, etc.)
     */
    parameters?: Record<string, ParameterMetadata>;
}

/**
 * Supported GLSL uniform types
 */
export type UniformType =
    | 'float'
    | 'int'
    | 'bool'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'mat3'
    | 'mat4'
    | 'sampler2D'
    | 'samplerCube';

/**
 * Binding between shader uniform and application parameters
 */
export interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: Record<string, any>) => any;
}

/**
 * Parameter metadata for UI generation and validation
 *
 * Defines how module parameters behave and how they should be displayed.
 */
export interface ParameterMetadata {
    // Required
    type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';
    default: any;

    // For numeric types
    range?: [number, number];
    step?: number;
    values?: number[];
    options?: string[];  // Named options for discrete int values

    // UI hints
    name?: string;
    unit?: string;
    group?: string;
    help?: string;

    // Behavior
    triggersReset?: boolean;
}

/**
 * Engine execution state
 */
export type EngineState = 'ready' | 'running';

export { MODULE_ORDER };
