// errors/core/codes.ts

/**
 * Error codes for the path tracer compiler and engine
 *
 * Organized by category:
 * - glsl-*: GLSL shader errors
 * - scene-*: Scene definition errors
 * - strategy-*: Strategy configuration errors
 * - engine-*: Engine/runtime errors
 * - resource-*: GPU resource errors
 *
 * Each code has a description and category for documentation and tooling.
 */

export interface ErrorCodeDefinition {
    code: string;
    category: 'glsl' | 'scene' | 'strategy' | 'engine' | 'resource' | 'validation';
    description: string;
}

/**
 * GLSL Shader Errors
 */
export const GLSL_ERRORS = {
    'undefined-function': {
        code: 'undefined-function',
        category: 'glsl' as const,
        description: 'A function is called but not defined'
    },
    'undefined-variable': {
        code: 'undefined-variable',
        category: 'glsl' as const,
        description: 'A variable is used but not declared'
    },
    'type-mismatch': {
        code: 'type-mismatch',
        category: 'glsl' as const,
        description: 'Type mismatch in expression or assignment'
    },
    'syntax-error': {
        code: 'syntax-error',
        category: 'glsl' as const,
        description: 'GLSL syntax error'
    },
    'missing-return': {
        code: 'missing-return',
        category: 'glsl' as const,
        description: 'Function missing return statement'
    },
    'redefinition': {
        code: 'redefinition',
        category: 'glsl' as const,
        description: 'Symbol is already defined'
    },
    'invalid-operation': {
        code: 'invalid-operation',
        category: 'glsl' as const,
        description: 'Invalid operation for operand types'
    },
    'array-bounds': {
        code: 'array-bounds',
        category: 'glsl' as const,
        description: 'Array index out of bounds'
    },
    'compile-failed': {
        code: 'compile-failed',
        category: 'glsl' as const,
        description: 'GLSL compilation failed (general)'
    },
    'link-failed': {
        code: 'link-failed',
        category: 'glsl' as const,
        description: 'GLSL program linking failed'
    }
};

/**
 * Scene Definition Errors
 */
export const SCENE_ERRORS = {
    'missing-geometry': {
        code: 'missing-geometry',
        category: 'scene' as const,
        description: 'Scene requires at least one geometry primitive'
    },
    'invalid-material': {
        code: 'invalid-material',
        category: 'scene' as const,
        description: 'Invalid material definition'
    },
    'missing-material': {
        code: 'missing-material',
        category: 'scene' as const,
        description: 'Referenced material does not exist'
    },
    'invalid-transform': {
        code: 'invalid-transform',
        category: 'scene' as const,
        description: 'Invalid transformation matrix'
    },
    'circular-reference': {
        code: 'circular-reference',
        category: 'scene' as const,
        description: 'Circular reference in scene graph'
    }
};

/**
 * Strategy Configuration Errors
 */
export const STRATEGY_ERRORS = {
    'unknown-strategy': {
        code: 'unknown-strategy',
        category: 'strategy' as const,
        description: 'Unknown rendering strategy'
    },
    'invalid-setting': {
        code: 'invalid-setting',
        category: 'strategy' as const,
        description: 'Invalid strategy setting value'
    },
    'missing-required': {
        code: 'missing-required',
        category: 'strategy' as const,
        description: 'Missing required strategy setting'
    },
    'incompatible-options': {
        code: 'incompatible-options',
        category: 'strategy' as const,
        description: 'Strategy options are incompatible'
    }
};

/**
 * Engine/Runtime Errors
 */
export const ENGINE_ERRORS = {
    'webgl-not-supported': {
        code: 'webgl-not-supported',
        category: 'engine' as const,
        description: 'WebGL2 is not supported in this browser'
    },
    'context-lost': {
        code: 'context-lost',
        category: 'engine' as const,
        description: 'WebGL context was lost'
    },
    'renderer-not-found': {
        code: 'renderer-not-found',
        category: 'engine' as const,
        description: 'Requested renderer does not exist'
    },
    'invalid-state': {
        code: 'invalid-state',
        category: 'engine' as const,
        description: 'Engine is in an invalid state for this operation'
    }
};

/**
 * GPU Resource Errors
 */
export const RESOURCE_ERRORS = {
    'texture-creation-failed': {
        code: 'texture-creation-failed',
        category: 'resource' as const,
        description: 'Failed to create GPU texture'
    },
    'framebuffer-incomplete': {
        code: 'framebuffer-incomplete',
        category: 'resource' as const,
        description: 'Framebuffer is incomplete'
    },
    'buffer-not-found': {
        code: 'buffer-not-found',
        category: 'resource' as const,
        description: 'Referenced buffer does not exist'
    },
    'out-of-memory': {
        code: 'out-of-memory',
        category: 'resource' as const,
        description: 'GPU out of memory'
    },
    'hdr-load-failed': {
        code: 'hdr-load-failed',
        category: 'resource' as const,
        description: 'Failed to load HDR environment map'
    }
};

/**
 * Validation Errors
 */
export const VALIDATION_ERRORS = {
    'invalid-pipeline': {
        code: 'invalid-pipeline',
        category: 'validation' as const,
        description: 'Render pipeline configuration is invalid'
    },
    'missing-shader': {
        code: 'missing-shader',
        category: 'validation' as const,
        description: 'Pipeline references non-existent shader'
    },
    'missing-framebuffer': {
        code: 'missing-framebuffer',
        category: 'validation' as const,
        description: 'Pipeline references non-existent framebuffer'
    },
    'invalid-uniform': {
        code: 'invalid-uniform',
        category: 'validation' as const,
        description: 'Uniform binding is invalid'
    },
    // --- CompiledRenderer structural validation (errors/compiler/validation.ts) ---
    'renderer-no-id': {
        code: 'renderer-no-id',
        category: 'validation' as const,
        description: 'CompiledRenderer must have a non-empty id'
    },
    'renderer-no-shaders': {
        code: 'renderer-no-shaders',
        category: 'validation' as const,
        description: 'CompiledRenderer must have at least one shader'
    },
    'renderer-no-passes': {
        code: 'renderer-no-passes',
        category: 'validation' as const,
        description: 'CompiledRenderer must have at least one render pass'
    },
    'pass-invalid-shader': {
        code: 'pass-invalid-shader',
        category: 'validation' as const,
        description: 'Render pass references a shader not present in the renderer'
    },
    'pass-invalid-output': {
        code: 'pass-invalid-output',
        category: 'validation' as const,
        description: 'Render pass outputs to an unknown framebuffer'
    },
    'pass-invalid-attachment': {
        code: 'pass-invalid-attachment',
        category: 'validation' as const,
        description: 'Render pass uses a color attachment outside the valid range 0-7'
    },
    'pass-invalid-texture': {
        code: 'pass-invalid-texture',
        category: 'validation' as const,
        description: 'Render pass binds a texture from an unknown framebuffer'
    },
    'pass-mrt-multiple-buffers': {
        code: 'pass-mrt-multiple-buffers',
        category: 'validation' as const,
        description: 'MRT outputs of a pass span multiple base framebuffers'
    },
    'swap-invalid-buffer': {
        code: 'swap-invalid-buffer',
        category: 'validation' as const,
        description: 'Swap instruction references an unknown buffer'
    },
    'swap-not-double-buffer': {
        code: 'swap-not-double-buffer',
        category: 'validation' as const,
        description: 'Swap targets a framebuffer that is not a double_buffer (§9 rule 4)'
    },
    'swap-rotate-unsupported': {
        code: 'swap-rotate-unsupported',
        category: 'validation' as const,
        description: "SwapInstruction type 'rotate' is a locked contract type the engine does not implement yet"
    },
    'pipeline-screen-count': {
        code: 'pipeline-screen-count',
        category: 'validation' as const,
        description: "Pipeline must declare exactly one framebuffer of type 'screen' (§9 rule 1)"
    },
    'export-invalid-buffer': {
        code: 'export-invalid-buffer',
        category: 'validation' as const,
        description: 'Export target references an unknown framebuffer'
    },
    'uniform-duplicate': {
        code: 'uniform-duplicate',
        category: 'validation' as const,
        description: 'A uniform is bound by more than one binding'
    },
    'uniform-conflict': {
        code: 'uniform-conflict',
        category: 'validation' as const,
        description: 'Two feature contributions declare the same uniform with different type/path'
    },
    'texture-conflict': {
        code: 'texture-conflict',
        category: 'validation' as const,
        description: 'Two feature contributions declare the same texture with different sources'
    },
    'seam-conflict': {
        code: 'seam-conflict',
        category: 'validation' as const,
        description: 'Two feature contributions provide the same GLSL seam (T4: one definition per seam)'
    },
    'seam-missing': {
        code: 'seam-missing',
        category: 'validation' as const,
        description: 'A feature requires a GLSL seam no feature provides (T4 structural link check)'
    },
    'seam-unused': {
        code: 'seam-unused',
        category: 'validation' as const,
        description: 'A provided GLSL seam nothing requires — dead generated code (exact-linkage check, the dual of seam-missing)'
    }
};

/**
 * Compiler Codegen Errors/Warnings (analyze + generate stages)
 */
export const COMPILER_ERRORS = {
    'empty-scene': {
        code: 'empty-scene',
        category: 'scene' as const,
        description: 'Scene has no objects — nothing will be rendered (warning)'
    },
    'unsupported-environment': {
        code: 'unsupported-environment',
        category: 'scene' as const,
        description: 'Environment type not yet supported (falls back to none)'
    },
    'shader-compile-error': {
        code: 'shader-compile-error',
        category: 'glsl' as const,
        description: 'Generated GLSL failed to compile'
    }
};

/**
 * GLSL Warnings
 */
export const GLSL_WARNINGS = {
    'unused-variable': {
        code: 'unused-variable',
        category: 'glsl' as const,
        description: 'Variable is declared but never used'
    },
    'unused-uniform': {
        code: 'unused-uniform',
        category: 'glsl' as const,
        description: 'Uniform is declared but never read'
    },
    'unused-function': {
        code: 'unused-function',
        category: 'glsl' as const,
        description: 'Function is defined but never called'
    },
    'implicit-cast': {
        code: 'implicit-cast',
        category: 'glsl' as const,
        description: 'Implicit type cast may lose precision'
    },
    'division-by-zero': {
        code: 'division-by-zero',
        category: 'glsl' as const,
        description: 'Potential division by zero'
    }
};

/**
 * All error codes combined
 */
export const ALL_ERROR_CODES = {
    ...GLSL_ERRORS,
    ...SCENE_ERRORS,
    ...STRATEGY_ERRORS,
    ...ENGINE_ERRORS,
    ...RESOURCE_ERRORS,
    ...VALIDATION_ERRORS,
    ...COMPILER_ERRORS,
    ...GLSL_WARNINGS
} as const;

/**
 * Get error code definition
 */
export function getErrorDefinition(code: string): ErrorCodeDefinition | undefined {
    return ALL_ERROR_CODES[code as keyof typeof ALL_ERROR_CODES];
}

/**
 * Check if a code is a known error code
 */
export function isKnownCode(code: string): boolean {
    return code in ALL_ERROR_CODES;
}
