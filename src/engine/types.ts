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
type ModuleKind =
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
interface ModuleDescriptor {
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
type UniformType =
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
interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: Record<string, any>) => any;
}

/**
 * Parameter metadata for UI generation and validation
 *
 * Defines how module parameters behave and how they should be displayed.
 * This is a subset of the full metadata used by the App layer.
 */
interface ParameterMetadata {
    // Required
    type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';
    default: any;

    // For numeric types
    range?: [number, number];
    step?: number;
    values?: number[];

    // UI hints
    name?: string;
    unit?: string;
    group?: string;
    help?: string;

    // Behavior
    triggersReset?: boolean;
}

/**
 * Module validation result
 */
interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings?: string[];
}

/**
 * Compiled shader program ready for execution
 */
interface CompiledProgram {
    id: string;
    program: WebGLProgram;
    vertexSource: string;
    fragmentSource: string;
}

/**
 * Engine execution state
 */
type EngineState = 'ready' | 'running';

/**
 * Engine-provided shader uniforms
 */
interface EngineUniforms {
    resolution: [number, number];
    imageSize: [number, number];
    frameIndex: number;
    time: number;
    sampleCount: number;
    pixelOffset: [number, number];
}

/**
 * Complete rendering recipe
 *
 * A recipe defines a complete rendering configuration by composing
 * modules for world representation, optical simulation, and output.
 */
interface Recipe {
    id: string;
    name: string;
    description?: string;

    world: {
        ambient: ModuleDescriptor;
        environment: ModuleDescriptor;
        scene: ModuleDescriptor;
        lighting: ModuleDescriptor;
    };

    optics: {
        camera: ModuleDescriptor;
        interaction: ModuleDescriptor;
        transport: ModuleDescriptor;
        accumulator: ModuleDescriptor;
        developer: ModuleDescriptor;
    };

    parameters?: Record<string, any>;

    config?: {
        targetSamples?: number;
        renderMode?: 'interactive' | 'progressive' | 'production';
    };
}

export { MODULE_ORDER };

export type {
    ModuleDescriptor,
    ModuleKind,
    ValidationResult,
    CompiledProgram,
    EngineState,
    UniformBinding,
    EngineUniforms,
    UniformType,
    ParameterMetadata,
    Recipe
};
