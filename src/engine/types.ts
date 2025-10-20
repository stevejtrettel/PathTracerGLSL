// Phase 1: Core type definitions for the Engine pillar
// These types establish the contracts between ModuleRegistry, SimpleCompiler, and RenderExecutor


const MODULE_ORDER = [
    'ambient',     // Foundation
    'scene',       // Geometry
    'environment', // EnvMaps and Fog
    'lighting',    // Lights
    'camera',      // Ray gen
    'interaction', // BRDFs
    'transport',   // Uses interaction
    'accumulator', // Uses transport output
    'developer'    // Final output
];


/**
 * Valid module types - determines required function prefixes
 */
type ModuleKind =
    | 'ambient'        // Ambient space geometry (ambient_*)
    | 'environment'     //the evironment maps and fog
    | 'scene'         // Object intersection and materials (scene_*)
    | 'lighting'      // Light sampling (lighting_*)
    | 'camera'        // Ray generation (camera_*)
    | 'interaction'   // Light-matter physics (interaction_*)
    | 'transport'     // Integration algorithms (transport_*)
    | 'accumulator'   // Accumulation (accumulator_*)
    | 'developer'     // Tone mapping (developer_*)
    | 'test';         // Phase 1 testing (test_*)


/**
 * Describes a single rendering module with its GLSL code and metadata
 */
interface ModuleDescriptor {
    id: {
        kind: ModuleKind;
        name: string;      // e.g., "pinhole", "euclidean", "red"
        version: string;   // e.g., "1.0.0"
    };

    fragment: {
        functions: string;    // The GLSL function definitions
        uniforms?: string;    // Uniform declarations (optional)
        constants?: string;   // #define statements (optional)
    };

    uniformBindings?: UniformBinding[];  // NEW

    exports: string[];      // Functions this module provides (e.g., ["camera_generateRay"])
}



type UniformType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'mat3' | 'mat4' | 'sampler2D' | 'samplerCube';

interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: Record<string, any>) => any;
}

/**
 * Result of module validation by the registry
 */
interface ValidationResult {
    valid: boolean;
    errors: string[];         // What went wrong
    warnings?: string[];      // Non-fatal issues
}

/**
 * Complete compiled program ready for GPU execution
 */
interface CompiledProgram {
    id: string;                    // Identifier for debugging
    program: WebGLProgram;         // Linked vertex + fragment shaders
    vertexSource: string;          // Vertex shader source (for debugging)
    fragmentSource: string;        // Fragment shader source (for debugging)
}

/**
 * Engine state for Phase 2
 */
type EngineState = 'ready' | 'running';



interface EngineUniforms {
    resolution: [number, number];      // Framebuffer size
    imageSize: [number, number];       // Full image size (for camera)
    frameIndex: number;
    time: number;
    sampleCount: number;
    pixelOffset: [number, number];  // for tiling
}



// Add these after your existing type definitions

interface Recipe {
    id: string;
    name: string;
    description?: string;

    world: {
        ambient: ModuleDescriptor;      // Mathematical space (direct reference)
        environment: ModuleDescriptor;  // Environment maps and fog
        scene: ModuleDescriptor;        // Objects and materials
        lighting: ModuleDescriptor;     // Light sources
    };

    optics: {
        camera: ModuleDescriptor;       // Ray generation
        interaction: ModuleDescriptor;  // Light-matter physics (BRDFs)
        transport: ModuleDescriptor;    // Integration algorithm
        accumulator: ModuleDescriptor;  // Sample accumulation
        developer: ModuleDescriptor;    // Tone mapping
    };

    parameters?: Record<string, any>;  // Recipe-specific parameter overrides

    config?: {
        targetSamples?: number;
        renderMode?: 'interactive' | 'progressive' | 'production';
    };
}



export {MODULE_ORDER};

export type {
    ModuleDescriptor,
    ModuleKind,
    ValidationResult,
    CompiledProgram,
    EngineState,
    UniformBinding,
    EngineUniforms,
    UniformType,
    Recipe
};
