// engine/types.ts

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

