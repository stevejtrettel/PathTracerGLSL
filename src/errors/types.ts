import type { ModuleDescriptor } from '../engine/types.js';

// ============================================================================
// Raw GLSL Compiler Output
// ============================================================================

/**
 * Raw error from GLSL compiler before any processing
 */
export interface GLSLError {
    type: 'error' | 'warning';
    line: number;           // Line in concatenated shader
    message: string;        // Raw GLSL error message
    raw: string;           // Complete original error line
}

// ============================================================================
// Source Location & Context
// ============================================================================

/**
 * Location information mapped back to source modules
 */
export interface SourceLocation {
    line: number;              // Line in concatenated shader
    module: string;            // Module name (e.g., 'pinhole', 'pathtracer')
    moduleKind: string;        // Module kind (e.g., 'camera', 'transport')
    moduleLineNumber: number;  // Line within the module's source
    context: string;           // Surrounding source code (3-5 lines)
}

/**
 * Maps concatenated shader line numbers to module locations
 */
export interface LineMap {
    [lineNumber: number]: {
        module: ModuleDescriptor;
        moduleStartLine: number;  // Where this module starts in concatenated shader
        moduleEndLine: number;    // Where this module ends
    } | null;  // null for header/system lines
}

// ============================================================================
// Translated & Enhanced Errors
// ============================================================================

/**
 * Error after translation with helpful context
 */
export interface TranslatedError {
    // Classification
    severity: 'error' | 'warning';
    category: ErrorCategory;

    // Core message
    message: string;
    detail?: string;  // Additional explanation

    // Function-specific (for missing_function category)
    functionName?: string;
    requiredBy?: string;        // Module that needs the function
    expectedProvider?: string;  // Module that should provide it

    // All locations where this error occurs
    locations: SourceLocation[];

    // Helpful suggestions
    suggestion?: string;
    alternatives?: string[];  // Available similar functions

    // Original error for reference
    originalError: GLSLError;
}

export type ErrorCategory =
    | 'missing_function'
    | 'type_mismatch'
    | 'syntax'
    | 'undeclared_variable'
    | 'uniform_error'
    | 'linker_error'
    | 'other';

// ============================================================================
// Final Output
// ============================================================================

/**
 * Complete diagnostics output for shader compilation
 */
export interface ShaderDiagnostics {
    success: boolean;

    // Categorized errors
    errors: TranslatedError[];
    warnings: TranslatedError[];

    // Source information
    source: string;              // Full concatenated shader source
    sourceWithLineNumbers: string;

    // Module information
    modules: ModuleDescriptor[];

    // Statistics
    stats: {
        totalErrors: number;
        totalWarnings: number;
        missingFunctions: number;
        typeMismatches: number;
        syntaxErrors: number;
        linkerErrors: number;
        other: number;
    };
}

// ============================================================================
// Formatter Options
// ============================================================================

export interface FormatOptions {
    // Display options
    showLineNumbers: boolean;
    showContext: boolean;
    showAllOccurrences: boolean;  // vs just first occurrence
    maxContextLines: number;

    // Coloring (for console output)
    useColors: boolean;

    // Grouping
    groupByCategory: boolean;
    groupByModule: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
    showLineNumbers: true,
    showContext: true,
    showAllOccurrences: false,
    maxContextLines: 2,
    useColors: true,
    groupByCategory: false,
    groupByModule: false
};
