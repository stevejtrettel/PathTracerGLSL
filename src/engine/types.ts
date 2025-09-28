// Phase 1: Core type definitions for the Engine pillar
// These types establish the contracts between ModuleRegistry, SimpleCompiler, and RenderExecutor


export const MODULE_ORDER: ModuleKind[] = [
    'ambient', 'scene', 'lighting', 'camera',  'interaction', 'transport',
    'accumulator', 'developer'
];


/**
 * Valid module types - determines required function prefixes
 */
type ModuleKind =
    | 'ambient'        // Ambient space geometry (ambient_*)
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


interface UniformBinding {
    uniform: string;                    // e.g., 'u_camera_tan_fov'
    parameters: string[];               // e.g., ['camera.fov']
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
    resolution: [number, number];
    frameIndex: number;
    time: number;
}


export type {
    ModuleDescriptor,
    ModuleKind,
    ValidationResult,
    CompiledProgram,
    EngineState,
    UniformBinding,
    EngineUniforms,
    MODULE_ORDER,
};
