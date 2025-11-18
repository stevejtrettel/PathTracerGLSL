# Error Reporting System Specification

## Table of Contents
1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Directory Structure](#directory-structure)
4. [Type Definitions](#type-definitions)
5. [Component Specifications](#component-specifications)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Future Extensions](#future-extensions)

---

## Problem Statement

### The Challenge: Module Validation

We need to validate that shader modules (camera, transport, interaction, etc.) are compatible and provide all required functions. The core problem: **one module calling a function that another module should provide but doesn't**.

### Original Approach: TypeScript Metadata Validation

**Idea:** Maintain explicit lists of `requires` and `provides` for each module.

```typescript
// Example metadata
{
  id: { kind: 'transport', name: 'pathtracer' },
  requires: {
    camera: ['camera_generateRay'],
    lighting: ['lighting_sample', 'lighting_pdf'],
    interaction: ['interaction_surface_shade', 'interaction_surface_scatter']
  },
  provides: ['transport_trace']
}
```

**Problems with this approach:**
1. **High maintenance burden** - Every function call requires metadata update
2. **Error-prone** - Easy to forget updating metadata when code changes
3. **Duplication** - Information exists in both metadata and code
4. **Still doesn't catch type mismatches** - Only validates function existence
5. **No semantic understanding** - Can't detect signature mismatches
6. **Bureaucratic** - Slows down research iteration

### New Approach: GLSL Compiler-Based Validation

**Key Insight:** The GLSL compiler already validates everything we need! It:
- ✅ Detects missing functions
- ✅ Validates function signatures
- ✅ Catches type mismatches
- ✅ Reports multiple errors at once
- ✅ Provides line numbers
- ✅ Requires zero maintenance

**The Challenge:** GLSL error messages are cryptic and lack module context.

**Raw GLSL Error:**
```
ERROR: 0:234: 'camera_generateRay' : no matching overloaded function found
ERROR: 0:235: 'lighting_sample_direct' : no matching overloaded function found
ERROR: 0:237: '+' : wrong operand types
```

**Our Goal - Translated Error:**
```
❌ Missing Function: camera_generateRay

Required by: transport module 'pathtracer'
Expected provider: camera module 'pinhole'

Called in 3 places:
  • Line 45 in transport module
  • Line 67 in transport module
  • Line 123 in transport module

Did you mean 'camera_generate_ray'?
(Note: Check underscore vs camelCase)

Context (first occurrence):
  43:     vec2 xi = random2();
  44:     
  45:     Ray ray = camera_generateRay(pixel, xi);
                    ^^^^^^^^^^^^^^^^^
  46:     Spectrum s = transport_integrate(ray);
```

**Benefits:**
1. **Zero maintenance** - Just write code, compiler validates
2. **Comprehensive** - Catches all GLSL-level errors
3. **Accurate** - No false positives
4. **Fast iteration** - No metadata to manage
5. **Better errors** - We add helpful context and suggestions

---

## Architecture Overview

### The Error Reporting Pipeline

```
GLSL Compiler Error
        ↓
   Parse Raw Error
        ↓
   Map to Modules
        ↓
  Translate & Enhance
        ↓
    Deduplicate
        ↓
   Format for Display
```

### Key Design Principles

1. **Separation of Concerns**
   - Parsing: Extract structured data from compiler output
   - Translation: Add context and helpful information
   - Formatting: Display-specific presentation

2. **Deduplication**
   - Same error at multiple locations → Single aggregated report
   - Keep all line numbers but show context once

3. **Helpful Suggestions**
   - Typo detection (Levenshtein distance)
   - List available alternatives
   - Module compatibility hints

4. **Module Awareness**
   - Map line numbers back to source modules
   - Understand which module should provide what
   - Suggest compatible module combinations

---

## Directory Structure

### Top-Level `errors/` Folder

We're creating a top-level `errors/` folder to house all error reporting concerns. This is infrastructure that will be used across the entire system.

```
src/
├── engine/
├── app/
├── math/
├── world/
├── optics/
└── errors/                    ← NEW
    ├── index.ts              # Public API
    ├── types.ts              # Core type definitions
    │
    ├── shader/               # Shader compilation errors
    │   ├── ShaderErrorParser.ts
    │   ├── ShaderErrorTranslator.ts
    │   ├── ShaderErrorFormatter.ts
    │   └── utils/
    │       ├── line-mapping.ts
    │       ├── function-extraction.ts
    │       └── typo-detection.ts
    │
    ├── module/               # Module loading/validation errors (future)
    │   └── ModuleValidator.ts
    │
    ├── parameter/            # Parameter validation errors (future)
    │   └── ParameterValidator.ts
    │
    ├── formatters/           # Shared formatting utilities
    │   ├── ConsoleFormatter.ts
    │   ├── HTMLFormatter.ts
    │   └── MarkdownFormatter.ts
    │
    └── utils/                # Shared error utilities
        ├── error-aggregation.ts
        └── source-context.ts
```

### Error Categories We'll Handle Long-Term

1. **Shader Compilation Errors** (Current Focus)
   - Missing functions
   - Type mismatches
   - Syntax errors
   - Uniform errors

2. **Module Loading Errors** (Future)
   - Invalid module structure
   - Missing required fields
   - Incompatible versions
   - Circular dependencies

3. **Parameter Validation Errors** (Future)
   - Invalid parameter types
   - Out-of-range values
   - Missing required parameters
   - Type coercion failures

4. **Runtime Errors** (Future)
   - WebGL context loss
   - Resource allocation failures
   - Texture loading errors

5. **Recipe Compilation Errors** (Future)
   - Incompatible module combinations
   - Missing resources
   - Configuration conflicts

### Why Top-Level?

- **Used everywhere:** Shader errors (engine), parameter errors (app), module errors (world/optics)
- **Cross-cutting concern:** Not specific to any pillar
- **Infrastructure:** Like `math/`, it's foundational
- **Signals quality:** First-class error handling improves developer experience

---

## Type Definitions

### Core Error Types (`errors/types.ts`)

```typescript
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
  };
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
    other: number;
  };
}

// ============================================================================
// Module Information (from engine/types.ts)
// ============================================================================

export interface ModuleDescriptor {
  id: {
    kind: string;  // 'camera', 'transport', etc.
    name: string;
    version: string;
  };
  fragment: {
    functions: string;
    uniforms?: string;
    constants?: string;
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
```

### Module Prefix Mapping (`errors/shader/types.ts`)

```typescript
/**
 * Map module kinds to their function prefixes
 */
export const MODULE_PREFIX_MAP: Record<string, string> = {
  ambient: 'ambient',
  environment: 'environment',
  scene: 'scene',
  lighting: 'lighting',
  camera: 'camera',
  interaction: 'interaction',
  transport: 'transport',
  accumulator: 'accumulator',
  developer: 'developer'
};

/**
 * Reverse map: prefix to module kind
 */
export const PREFIX_MODULE_MAP: Record<string, string> = 
  Object.fromEntries(
    Object.entries(MODULE_PREFIX_MAP).map(([k, v]) => [v, k])
  );

/**
 * Core functions that must exist for each module kind
 */
export const REQUIRED_FUNCTIONS: Record<string, string[]> = {
  camera: ['camera_generateRay'],
  transport: ['transport_trace'],
  interaction: [
    'interaction_surface_shade',
    'interaction_surface_scatter',
    'interaction_surface_pdf'
  ],
  accumulator: ['accumulator_accumulate'],
  developer: ['developer_develop'],
  // ambient, scene, lighting have context-dependent requirements
};
```

---

## Component Specifications

### 1. ShaderErrorParser (`errors/shader/ShaderErrorParser.ts`)

**Purpose:** Parse raw GLSL compiler output into structured errors.

**Class Structure:**
```typescript
export class ShaderErrorParser {
  /**
   * Parse GLSL compiler error log into structured errors
   * 
   * GLSL error format varies by implementation but typically:
   * - "ERROR: 0:123: message"
   * - "WARNING: 0:45: message"
   * - "ERROR: 0:123: 'identifier' : specific error details"
   * 
   * @param errorLog - Raw error string from gl.getShaderInfoLog() or gl.getProgramInfoLog()
   * @returns Array of structured errors
   */
  parse(errorLog: string): GLSLError[];
  
  /**
   * Build a map from concatenated shader line numbers to module locations
   * 
   * Strategy:
   * 1. Look for module boundary comments: "// ============ moduleName (kind) ============"
   * 2. Track which lines belong to which module
   * 3. Handle edge cases (header, RNG system, main function)
   * 
   * @param source - Full concatenated shader source
   * @param modules - Array of module descriptors in compilation order
   * @returns Map from line number to module location info
   */
  buildLineMap(source: string, modules: ModuleDescriptor[]): LineMap;
  
  /**
   * Get source code context around a line
   * 
   * @param source - Full source code
   * @param line - Target line number (1-indexed)
   * @param contextLines - Number of lines before/after to include (default: 2)
   * @returns Formatted context string with line numbers
   */
  getContext(source: string, line: number, contextLines?: number): string;
  
  /**
   * Convert line number to module location
   * 
   * @param line - Line number in concatenated shader
   * @param lineMap - Line map from buildLineMap()
   * @returns Module location or null if not in any module
   */
  lineToLocation(line: number, lineMap: LineMap): SourceLocation | null;
}
```

**Implementation Notes:**

1. **GLSL Error Format Detection**
   - Different browsers/drivers may have slightly different formats
   - Be flexible in regex matching
   - Handle multi-line errors if they exist

2. **Module Boundary Detection**
   - The shader builder adds comments: `// ============ moduleName (kind) ============`
   - These mark where each module starts
   - Calculate module line ranges from these markers

3. **Edge Cases**
   - Lines before first module (header, common structs, RNG)
   - Lines after last module (main function, output)
   - Empty lines and comment-only lines

4. **Context Extraction**
   - Preserve indentation
   - Add line numbers for reference
   - Highlight the error line (with marker like `>` or color)

**Example Line Map Structure:**
```typescript
{
  1: null,  // Header
  15: null, // Common structs
  50: { module: ambientModule, moduleStartLine: 50, moduleEndLine: 120 },
  234: { module: transportModule, moduleStartLine: 200, moduleEndLine: 450 },
  // ...
}
```

---

### 2. ShaderErrorTranslator (`errors/shader/ShaderErrorTranslator.ts`)

**Purpose:** Translate raw GLSL errors into helpful, context-aware messages.

**Class Structure:**
```typescript
export class ShaderErrorTranslator {
  private modules: ModuleDescriptor[];
  private source: string;
  private lineMap: LineMap;
  private parser: ShaderErrorParser;
  
  constructor(modules: ModuleDescriptor[], source: string) {
    this.modules = modules;
    this.source = source;
    this.parser = new ShaderErrorParser();
    this.lineMap = this.parser.buildLineMap(source, modules);
  }
  
  /**
   * Translate array of GLSL errors into enhanced errors
   * 
   * Process:
   * 1. Categorize each error
   * 2. Add module context
   * 3. Generate suggestions
   * 4. Deduplicate
   * 
   * @param glslErrors - Raw errors from parser
   * @returns Translated and deduplicated errors
   */
  translate(glslErrors: GLSLError[]): TranslatedError[];
  
  /**
   * Check if error is a missing function
   * Pattern: "'function_name' : no matching overloaded function found"
   */
  private isMissingFunction(error: GLSLError): boolean;
  
  /**
   * Check if error is a type mismatch
   * Pattern: "wrong operand types" or "cannot convert"
   */
  private isTypeMismatch(error: GLSLError): boolean;
  
  /**
   * Check if error is a syntax error
   * Pattern: "syntax error" or "unexpected token"
   */
  private isSyntaxError(error: GLSLError): boolean;
  
  /**
   * Translate missing function error
   * 
   * Steps:
   * 1. Extract function name from error message
   * 2. Determine which module should provide it (from prefix)
   * 3. Get list of available functions from that module
   * 4. Find similar functions (typo detection)
   * 5. Generate helpful suggestion
   * 
   * @param error - Raw GLSL error
   * @returns Enhanced error with suggestions
   */
  private translateMissingFunction(error: GLSLError): TranslatedError;
  
  /**
   * Translate type mismatch error
   * 
   * @param error - Raw GLSL error
   * @returns Enhanced error
   */
  private translateTypeMismatch(error: GLSLError): TranslatedError;
  
  /**
   * Translate syntax error
   * 
   * @param error - Raw GLSL error
   * @returns Enhanced error
   */
  private translateSyntaxError(error: GLSLError): TranslatedError;
  
  /**
   * Generic translation for unrecognized errors
   * Just adds module context, no special processing
   * 
   * @param error - Raw GLSL error
   * @returns Enhanced error with basic context
   */
  private translateGeneric(error: GLSLError): TranslatedError;
  
  /**
   * Deduplicate errors - same error at multiple locations
   * 
   * Strategy:
   * 1. Group errors by (category, functionName, message)
   * 2. Aggregate locations
   * 3. Keep first context, list all line numbers
   * 
   * @param errors - Array of translated errors
   * @returns Deduplicated errors with aggregated locations
   */
  private deduplicate(errors: TranslatedError[]): TranslatedError[];
  
  /**
   * Create grouping key for deduplication
   * 
   * @param error - Translated error
   * @returns String key for grouping
   */
  private makeDeduplicationKey(error: TranslatedError): string;
  
  /**
   * Extract function name from error message
   * Handles: "'function_name' : ..."
   * 
   * @param message - GLSL error message
   * @returns Function name or null
   */
  private extractFunctionName(message: string): string | null;
  
  /**
   * Extract module prefix from function name
   * E.g., "camera_generateRay" → "camera"
   * 
   * @param functionName - Full function name
   * @returns Prefix or null
   */
  private extractPrefix(functionName: string): string | null;
  
  /**
   * Find which module should provide a function based on prefix
   * 
   * @param prefix - Function prefix
   * @returns Module descriptor or null
   */
  private findProviderModule(prefix: string): ModuleDescriptor | null;
  
  /**
   * Extract all function declarations from module source
   * 
   * Strategy:
   * - Match: "ReturnType prefix_functionName("
   * - Handle multi-line declarations
   * - Skip functions in comments
   * 
   * @param module - Module descriptor
   * @returns Array of function names
   */
  private extractFunctions(module: ModuleDescriptor): string[];
  
  /**
   * Find similar function name (typo detection)
   * Uses Levenshtein distance
   * 
   * @param target - Function being searched for
   * @param available - Available functions
   * @param maxDistance - Maximum edit distance (default: 3)
   * @returns Best match or null
   */
  private findSimilar(
    target: string,
    available: string[],
    maxDistance?: number
  ): string | null;
}
```

**Implementation Notes:**

1. **Function Name Extraction**
   - GLSL errors quote identifiers: `'function_name'`
   - Regex: `/'(\w+)'/`
   - May need to handle more complex patterns

2. **Module Provider Detection**
   - Split function on first underscore: `camera_generateRay` → `camera`
   - Look up in `MODULE_PREFIX_MAP`
   - Find corresponding module in `modules` array

3. **Function Declaration Parsing**
   - Regex for function declarations: `/\b(\w+\s+)?prefix_\w+\s*\(/g`
   - Need to handle:
     - Return types (void, float, vec3, etc.)
     - Multi-line declarations
     - Comments containing function-like patterns
   - Extract just the function name, not full signature

4. **Typo Detection (Levenshtein Distance)**
   - Calculate edit distance between target and each available function
   - Return closest match if distance ≤ maxDistance
   - Handle common mistakes:
     - Underscore vs camelCase
     - Missing prefix
     - Swapped letters

5. **Deduplication Strategy**
   - Group by: `${category}:${functionName}:${message}`
   - Merge: Combine locations arrays
   - Keep: First occurrence's context
   - Show: All line numbers but only one context

**Example Missing Function Translation:**

Input (GLSL):
```
ERROR: 0:234: 'camera_generateRay' : no matching overloaded function found
ERROR: 0:267: 'camera_generateRay' : no matching overloaded function found
ERROR: 0:345: 'camera_generateRay' : no matching overloaded function found
```

Output (Translated):
```typescript
{
  severity: 'error',
  category: 'missing_function',
  message: "Function 'camera_generateRay' not found",
  functionName: 'camera_generateRay',
  requiredBy: 'transport module "pathtracer"',
  expectedProvider: 'camera module "pinhole"',
  locations: [
    { line: 234, module: 'pathtracer', moduleLineNumber: 45, ... },
    { line: 267, module: 'pathtracer', moduleLineNumber: 78, ... },
    { line: 345, module: 'pathtracer', moduleLineNumber: 156, ... }
  ],
  suggestion: "Did you mean 'camera_generate_ray'?",
  alternatives: ['camera_getPdf', 'camera_getFrame'],
  originalError: { ... }
}
```

---

### 3. ShaderErrorFormatter (`errors/shader/ShaderErrorFormatter.ts`)

**Purpose:** Format translated errors for different output targets (console, HTML, etc.).

**Class Structure:**
```typescript
export class ShaderErrorFormatter {
  private options: FormatOptions;
  
  constructor(options: Partial<FormatOptions> = {}) {
    this.options = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  }
  
  /**
   * Format complete diagnostics for console output
   * 
   * @param diagnostics - Complete shader diagnostics
   * @returns Formatted string for console.log()
   */
  formatConsole(diagnostics: ShaderDiagnostics): string;
  
  /**
   * Format single error for console
   * 
   * @param error - Translated error
   * @returns Formatted error string
   */
  formatError(error: TranslatedError): string;
  
  /**
   * Format diagnostics summary
   * 
   * @param diagnostics - Complete diagnostics
   * @returns Summary string (e.g., "3 errors, 2 warnings")
   */
  formatSummary(diagnostics: ShaderDiagnostics): string;
  
  /**
   * Format as HTML for web UI (future)
   * 
   * @param diagnostics - Complete diagnostics
   * @returns HTML string
   */
  formatHTML(diagnostics: ShaderDiagnostics): string;
  
  /**
   * Format as Markdown (future)
   * 
   * @param diagnostics - Complete diagnostics
   * @returns Markdown string
   */
  formatMarkdown(diagnostics: ShaderDiagnostics): string;
  
  /**
   * Apply ANSI color codes if options.useColors is true
   * 
   * @param text - Text to colorize
   * @param color - Color name
   * @returns Colorized text
   */
  private colorize(text: string, color: 'red' | 'yellow' | 'blue' | 'green' | 'gray'): string;
}
```

**Console Format Example:**
```
❌ Shader compilation failed with 2 error(s)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ Missing Function: camera_generateRay

Required by: transport module 'pathtracer'
Expected provider: camera module 'pinhole'

Called in 3 places:
  • Line 45 in transport module
  • Line 78 in transport module
  • Line 156 in transport module

💡 Did you mean 'camera_generate_ray'?
   (Note: Check underscore vs camelCase in function name)

Available functions in camera module:
  • camera_generate_ray
  • camera_get_pdf
  • camera_get_frame

Context (first occurrence, line 45):
   43:     vec2 xi = random2();
   44:     
   45:     Ray ray = camera_generateRay(pixel, xi);
                     ^^^^^^^^^^^^^^^^^^
   46:     Spectrum s = transport_integrate(ray);
   47:     return s;

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ Type Mismatch

Line 123 in interaction module 'disney'

Cannot convert from 'vec3' to 'float'

Context:
  121:     vec3 color = props.albedo;
  122:     float roughness = props.roughness;
  123:     float metallic = color;  // ERROR: vec3 assigned to float
                           ^^^^^
  124:     return computeBRDF(...);

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**ANSI Color Codes:**
```typescript
const COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  reset: '\x1b[0m'
};
```

---

### 4. Utility Functions

#### `errors/shader/utils/line-mapping.ts`

```typescript
/**
 * Extract module boundaries from concatenated shader source
 * 
 * Looks for comment markers: // ============ moduleName (kind) ============
 * 
 * @param source - Full concatenated shader
 * @returns Array of module boundaries
 */
export function extractModuleBoundaries(source: string): Array<{
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
}>;

/**
 * Find which module a line belongs to
 * 
 * @param line - Line number
 * @param boundaries - Module boundaries
 * @returns Module info or null
 */
export function findModuleForLine(
  line: number,
  boundaries: ReturnType<typeof extractModuleBoundaries>
): { name: string; kind: string; localLine: number } | null;
```

#### `errors/shader/utils/function-extraction.ts`

```typescript
/**
 * Extract all function declarations from GLSL source
 * 
 * @param source - GLSL source code
 * @param prefix - Function prefix to filter by (optional)
 * @returns Array of function names
 */
export function extractFunctionDeclarations(
  source: string,
  prefix?: string
): string[];

/**
 * Extract function signature (for future type checking)
 * 
 * @param source - GLSL source code
 * @param functionName - Function to find
 * @returns Function signature or null
 */
export function extractFunctionSignature(
  source: string,
  functionName: string
): {
  returnType: string;
  name: string;
  parameters: Array<{ type: string; name: string }>;
} | null;
```

#### `errors/shader/utils/typo-detection.ts`

```typescript
/**
 * Calculate Levenshtein distance between two strings
 * 
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance
 */
export function levenshteinDistance(a: string, b: string): number;

/**
 * Find closest match to target from array of candidates
 * 
 * @param target - String to match
 * @param candidates - Array of possible matches
 * @param maxDistance - Maximum acceptable distance
 * @returns Best match or null
 */
export function findClosestMatch(
  target: string,
  candidates: string[],
  maxDistance?: number
): { match: string; distance: number } | null;

/**
 * Check if two function names are likely typo variants
 * Handles common patterns:
 * - Underscore vs camelCase: "generate_ray" vs "generateRay"
 * - Letter swaps: "generate" vs "genreate"
 * 
 * @param a - First function name
 * @param b - Second function name
 * @returns True if likely same function with typo
 */
export function areLikelyTypos(a: string, b: string): boolean;
```

---

### 5. Public API (`errors/index.ts`)

```typescript
// Re-export types
export * from './types';

// Re-export main classes
export { ShaderErrorParser } from './shader/ShaderErrorParser';
export { ShaderErrorTranslator } from './shader/ShaderErrorTranslator';
export { ShaderErrorFormatter } from './shader/ShaderErrorFormatter';

// Re-export utilities
export * from './shader/utils/line-mapping';
export * from './shader/utils/function-extraction';
export * from './shader/utils/typo-detection';

/**
 * Convenience function: Complete error translation pipeline
 * 
 * This is the main entry point most code will use.
 * 
 * @param errorLog - Raw GLSL compiler error string
 * @param source - Full concatenated shader source
 * @param modules - Array of module descriptors
 * @param options - Formatting options
 * @returns Complete diagnostics
 */
export function translateShaderErrors(
  errorLog: string,
  source: string,
  modules: ModuleDescriptor[],
  options?: Partial<FormatOptions>
): ShaderDiagnostics;

/**
 * Convenience function: Parse and format in one call
 * 
 * @param errorLog - Raw GLSL error string
 * @param source - Full shader source
 * @param modules - Module descriptors
 * @param options - Format options
 * @returns Formatted string for console output
 */
export function formatShaderErrors(
  errorLog: string,
  source: string,
  modules: ModuleDescriptor[],
  options?: Partial<FormatOptions>
): string;
```

**Implementation:**
```typescript
export function translateShaderErrors(
  errorLog: string,
  source: string,
  modules: ModuleDescriptor[],
  options?: Partial<FormatOptions>
): ShaderDiagnostics {
  // 1. Parse raw errors
  const parser = new ShaderErrorParser();
  const glslErrors = parser.parse(errorLog);
  
  // 2. Translate
  const translator = new ShaderErrorTranslator(modules, source);
  const translated = translator.translate(glslErrors);
  
  // 3. Separate errors and warnings
  const errors = translated.filter(e => e.severity === 'error');
  const warnings = translated.filter(e => e.severity === 'warning');
  
  // 4. Calculate statistics
  const stats = {
    totalErrors: errors.length,
    totalWarnings: warnings.length,
    missingFunctions: errors.filter(e => e.category === 'missing_function').length,
    typeMismatches: errors.filter(e => e.category === 'type_mismatch').length,
    syntaxErrors: errors.filter(e => e.category === 'syntax').length,
    other: errors.filter(e => e.category === 'other').length
  };
  
  return {
    success: errors.length === 0,
    errors,
    warnings,
    source,
    sourceWithLineNumbers: addLineNumbers(source),
    modules,
    stats
  };
}

export function formatShaderErrors(
  errorLog: string,
  source: string,
  modules: ModuleDescriptor[],
  options?: Partial<FormatOptions>
): string {
  const diagnostics = translateShaderErrors(errorLog, source, modules);
  const formatter = new ShaderErrorFormatter(options);
  return formatter.formatConsole(diagnostics);
}
```

---

## Integration Points

### Integration with ShaderCompiler (`engine/ShaderCompiler.ts`)

The error reporting system integrates at shader compilation time:

```typescript
// engine/ShaderCompiler.ts
import { translateShaderErrors, ShaderErrorFormatter } from '../errors';

class ShaderCompiler {
  compile(modules: ModuleDescriptor[]): CompilationResult {
    const mainSource = buildMainShaderSource(modules);
    const displaySource = buildDisplayShaderSource(modules);
    const vertexSource = buildVertexShaderSource();
    
    try {
      // Attempt compilation
      const mainProgram = this.compileAndLinkProgram(
        vertexSource,
        mainSource,
        'main'
      );
      
      const displayProgram = this.compileAndLinkProgram(
        vertexSource,
        displaySource,
        'display'
      );
      
      const compositeProgram = this.compileAndLinkProgram(
        vertexSource,
        this.buildCompositeShaderSource(),
        'composite'
      );
      
      return {
        success: true,
        mainProgram,
        displayProgram,
        compositeProgram
      };
      
    } catch (error: any) {
      // Compilation failed - translate errors
      const diagnostics = translateShaderErrors(
        error.message,  // GLSL compiler error log
        mainSource,
        modules
      );
      
      // Format for console
      const formatter = new ShaderErrorFormatter();
      const formattedErrors = formatter.formatConsole(diagnostics);
      
      // Log to console
      console.error(formattedErrors);
      
      // Return failure with diagnostics
      return {
        success: false,
        diagnostics
      };
    }
  }
  
  // ... rest of ShaderCompiler
}
```

### Type Updates for ShaderCompiler

Update `engine/types.ts`:

```typescript
import type { ShaderDiagnostics } from '../errors/types';

export type CompilationResult = 
  | {
      success: true;
      mainProgram: WebGLProgram;
      displayProgram: WebGLProgram;
      compositeProgram: WebGLProgram;
    }
  | {
      success: false;
      diagnostics: ShaderDiagnostics;
    };
```

### Integration with Engine

Update `engine/Engine.ts` to handle compilation failures gracefully:

```typescript
class Engine {
  initialize(recipes: Recipe[]): void {
    console.log(`Initializing ${recipes.length} recipes...`);
    
    for (const recipe of recipes) {
      this.recipes.set(recipe.id, recipe);
      const modules = this.extractModules(recipe);
      
      // Compile with error handling
      const result = this.compiler.compile(modules);
      
      if (!result.success) {
        // Compilation failed
        throw new Error(
          `Failed to compile recipe "${recipe.id}". ` +
          `See console for detailed error messages.`
        );
      }
      
      // Success - store programs
      this.programs.set(recipe.id, {
        main: result.mainProgram,
        display: result.displayProgram
      });
      
      if (!this.compositeProgram) {
        this.compositeProgram = result.compositeProgram;
      }
      
      this.resources.setupAccumulationBuffers(recipe.id);
    }
    
    // ... rest of initialization
  }
}
```

---

## Testing Strategy

### Unit Tests

Create `errors/shader/__tests__/` directory:

1. **Parser Tests** (`ShaderErrorParser.test.ts`)
   - Parse various GLSL error formats
   - Handle multi-line errors
   - Build line maps correctly
   - Extract context properly

2. **Translator Tests** (`ShaderErrorTranslator.test.ts`)
   - Detect missing functions
   - Generate correct suggestions
   - Deduplicate errors
   - Handle edge cases (no prefix, unknown module)

3. **Formatter Tests** (`ShaderErrorFormatter.test.ts`)
   - Format console output
   - Apply colors correctly
   - Handle empty error lists

4. **Utility Tests** (`utils/*.test.ts`)
   - Levenshtein distance calculations
   - Function extraction
   - Line mapping

### Integration Tests

Test with real shader compilation:

```typescript
// errors/__tests__/integration.test.ts
describe('Shader Error Integration', () => {
  it('should detect missing camera function', () => {
    const modules = [
      // Camera module without generateRay
      {
        id: { kind: 'camera', name: 'broken', version: '1.0' },
        fragment: {
          functions: `
            // Missing camera_generateRay!
            float camera_getPdf(Ray ray) { return 1.0; }
          `
        }
      },
      // Transport that calls it
      {
        id: { kind: 'transport', name: 'pathtracer', version: '1.0' },
        fragment: {
          functions: `
            Spectrum transport_trace(Ray ray) {
              Ray r = camera_generateRay(vec2(0), vec2(0));
              return Spectrum(0);
            }
          `
        }
      }
    ];
    
    const source = buildMainShaderSource(modules);
    const errorLog = "ERROR: 0:123: 'camera_generateRay' : no matching overloaded function found";
    
    const diagnostics = translateShaderErrors(errorLog, source, modules);
    
    expect(diagnostics.success).toBe(false);
    expect(diagnostics.errors).toHaveLength(1);
    expect(diagnostics.errors[0].category).toBe('missing_function');
    expect(diagnostics.errors[0].functionName).toBe('camera_generateRay');
    expect(diagnostics.errors[0].expectedProvider).toContain('camera');
  });
});
```

### Test Fixtures

Create `errors/__tests__/fixtures/`:
- Sample shader sources
- Sample module descriptors
- Sample GLSL error logs
- Expected translated outputs

---

## Implementation Checklist

### Phase 1: Core Infrastructure (Priority 1)

- [ ] Create `errors/` directory structure
- [ ] Define all types in `errors/types.ts`
- [ ] Define shader-specific types in `errors/shader/types.ts`
- [ ] Implement `ShaderErrorParser`
  - [ ] Parse GLSL errors
  - [ ] Build line maps
  - [ ] Extract context
- [ ] Implement basic `ShaderErrorTranslator`
  - [ ] Missing function detection
  - [ ] Basic translation
  - [ ] Deduplication
- [ ] Implement `ShaderErrorFormatter`
  - [ ] Console formatting
  - [ ] Color support
- [ ] Public API in `errors/index.ts`
- [ ] Integration with `ShaderCompiler`
- [ ] Update `engine/types.ts` for new compilation result

### Phase 2: Enhanced Features (Priority 2)

- [ ] Implement typo detection
  - [ ] Levenshtein distance
  - [ ] Find similar functions
- [ ] Implement function extraction utility
- [ ] Implement module-aware suggestions
- [ ] Add type mismatch translation
- [ ] Add syntax error translation
- [ ] Better context formatting (highlight error line)

### Phase 3: Polish (Priority 3)

- [ ] HTML formatter for UI
- [ ] Markdown formatter
- [ ] Unit tests for all components
- [ ] Integration tests
- [ ] Documentation
- [ ] Error recovery suggestions ("try using X module")

---

## Watch Out For

### 1. GLSL Error Format Variations

Different browsers and drivers format errors differently:

```typescript
// Common formats:
"ERROR: 0:123: message"                    // Most common
"ERROR: 0:123: 'identifier' : message"     // With identifier
"ERROR: program_name:123: message"         // Some drivers
"0(123) : error C1234: message"           // NVIDIA-style
```

**Solution:** Use flexible regex patterns, handle multiple formats.

### 2. Multi-line Error Messages

Some errors span multiple lines:

```
ERROR: 0:123: 'function_name' : no matching overloaded function found
       Candidates are:
         float function_name(vec3)
         float function_name(vec4)
```

**Solution:** Treat continuation lines specially, preserve full message.

### 3. Line Number Mapping Edge Cases

- Header lines (before first module)
- RNG system lines
- Main function (after last module)
- Empty lines
- Comment-only lines

**Solution:** Handle explicitly, may map to `null` or special "system" category.

### 4. Function Declaration Parsing Challenges

GLSL allows:
```glsl
// Multi-line
vec3
camera_generateRay(
    vec2 pixel,
    vec2 xi
);

// Inline
vec3 camera_generateRay(vec2 pixel, vec2 xi) { ... }

// In comments (should ignore)
// vec3 camera_generateRay(vec2, vec2)
```

**Solution:** 
- Use multi-line regex with `DOTALL` flag
- Filter out commented code
- May need to tokenize properly

### 5. Deduplication Key Collisions

Two different errors might generate same key:

```typescript
// Both produce key: "missing_function:camera_generateRay"
error1: { functionName: 'camera_generateRay', module: 'transport1' }
error2: { functionName: 'camera_generateRay', module: 'transport2' }
```

**Solution:** Include calling module in key if needed:
```typescript
const key = `${category}:${functionName}:${requiredBy}`;
```

### 6. Performance with Large Shaders

- Full source concatenation can be large (10k+ lines)
- Line mapping for every error
- Function extraction via regex

**Solution:**
- Cache line maps
- Cache function lists
- Lazy evaluation where possible

### 7. ANSI Color Codes in Non-Terminal Environments

Color codes will show as garbage if output goes to file or non-supporting terminal.

**Solution:** 
```typescript
const supportsColor = process.stdout?.isTTY ?? false;
const options = { useColors: supportsColor };
```

### 8. Module Ordering Assumptions

Code assumes modules are in specific order matching `MODULE_ORDER`.

**Solution:** Verify order in parser, warn if unexpected.

---

## Future Extensions

### 1. HTML Error Viewer

Interactive web-based error viewer:
- Expandable error details
- Syntax-highlighted code
- Click to jump to line
- Filter by module/category

### 2. Module Compatibility Database

Build a database of known compatible/incompatible module combinations:

```typescript
interface ModuleCompatibility {
  module: string;
  requires: {
    [moduleKind: string]: string[];  // Required capabilities
  };
  incompatibleWith: string[];  // Known incompatible modules
  suggestions: string[];  // Alternative module recommendations
}
```

### 3. Autocorrect Suggestions

Not just typos, but semantic suggestions:

```
❌ lighting_sample_direct not found

This transport module requires direct light sampling.

💡 Suggestions:
   1. Switch to 'simple' lighting module (supports direct sampling)
   2. Switch to 'pathtracer' transport (doesn't need direct sampling)
   3. Add ambient_log_map to your ambient module to enable sampling
```

### 4. Error Recovery

Attempt to compile with alternative module combinations:

```typescript
if (compilation fails with module A) {
  try module B as alternative
  report: "Compilation failed with module A, succeeded with module B"
}
```

### 5. Statistical Error Analysis

Track common errors across sessions:
- Most frequent errors
- Error patterns
- Module compatibility issues
- Helpful for documentation

### 6. IDE Integration

Generate error output in Language Server Protocol format for IDE integration.

---

## Example Usage

### Basic Usage

```typescript
import { translateShaderErrors, ShaderErrorFormatter } from './errors';

// In ShaderCompiler.compile()
try {
  const program = compileProgram(source);
  return { success: true, program };
} catch (error: any) {
  const diagnostics = translateShaderErrors(
    error.message,
    source,
    modules
  );
  
  const formatter = new ShaderErrorFormatter();
  console.error(formatter.formatConsole(diagnostics));
  
  return { success: false, diagnostics };
}
```

### Advanced Usage

```typescript
import {
  ShaderErrorParser,
  ShaderErrorTranslator,
  ShaderErrorFormatter
} from './errors';

// Custom pipeline
const parser = new ShaderErrorParser();
const glslErrors = parser.parse(errorLog);

const translator = new ShaderErrorTranslator(modules, source);
const translated = translator.translate(glslErrors);

const formatter = new ShaderErrorFormatter({
  showAllOccurrences: true,
  maxContextLines: 3,
  useColors: true
});

const output = formatter.formatConsole({
  success: false,
  errors: translated,
  warnings: [],
  source,
  sourceWithLineNumbers: addLineNumbers(source),
  modules,
  stats: calculateStats(translated)
});

console.error(output);
```

---

## Summary

This error reporting system provides:

1. ✅ **Zero-maintenance validation** via GLSL compiler
2. ✅ **Comprehensive error detection** (functions, types, syntax)
3. ✅ **Helpful error messages** with context and suggestions
4. ✅ **Deduplication** to avoid overwhelming output
5. ✅ **Module awareness** to guide fixes
6. ✅ **Extensible architecture** for future error types
7. ✅ **Clean separation** of parsing, translation, and formatting

The system is designed to grow from shader errors to handle all error types across the system, making it a valuable long-term investment in developer experience and code quality.