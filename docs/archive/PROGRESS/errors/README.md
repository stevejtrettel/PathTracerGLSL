# Error System

Comprehensive validation and error reporting system.

## Overview

PathTracerGLSL has a three-stage error system:

```
1. Pre-Compilation Validation (errors/engine/)
   ├─ Recipe structure
   ├─ Uniform bindings
   └─ Module compatibility

2. Compilation Error Translation (errors/shader/)
   ├─ GLSL parser errors
   ├─ Missing functions
   └─ Type mismatches

3. Runtime Validation (errors/resources/)
   ├─ HDR loading
   ├─ Texture creation
   └─ WebGL state
```

All errors provide:
- Clear, actionable messages
- Module/file context
- Suggestions for fixes
- Console-friendly formatting

---

## Error Types

### Engine Validation (`errors/engine/`)

**When**: Before shader compilation

**What it catches**:
- Wrong module kinds in recipe slots
- Uniform bindings referencing non-existent uniforms
- Missing required modules
- Type mismatches in bindings

**Example**:
```
❌ Recipe validation failed for 'pathtracer':
  • transport slot requires 'transport' module, got 'camera' (pinhole-camera)
```

See [Validation Documentation](validation.md) for details.

### Shader Error Translation (`errors/shader/`)

**When**: During shader compilation

**What it catches**:
- GLSL syntax errors
- Missing functions
- Undefined variables
- Type mismatches
- Linker errors

**Example**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Missing Function

Function 'interaction_surface_shaed' not found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Did you mean 'interaction_surface_shade'?

Module: optics/interaction/lambert-interaction
Line 41:
  39 |     vec3 wo = -ray.direction;
  40 |     vec3 wi = ls.wi;
  41 |     vec3 radiance = interaction_surface_shaed(
                            ^^^^^^^^^^^^^^^^^^^^^^^
```

See [Shader Errors Documentation](shader-errors.md) for details.

### Resource Validation (`errors/resources/`)

**When**: During resource loading (HDR, textures)

**What it catches**:
- Missing files (404)
- Invalid file formats
- Corrupted data
- Oversized textures (GPU limits)
- Invalid dimensions

**Example**:
```
❌ HDR loading failed:
  • HDR file not found: /hdri/missing.hdr

❌ Invalid HDR data:
  • HDR dimensions too large: 16384x8192 (maximum: 8192x8192)

⚠️  HDR data warnings:
  • HDR dimensions 1024x512 are not power-of-two
  • Unusual HDR aspect ratio: 3.5:1. Environment maps are typically 2:1
```

See [Resource Errors Documentation](resource-errors.md) for details.

---

## Error Flow

```
User Code
  ↓
Engine.initialize(recipes)
  ↓
╔═════════════════════════════╗
║ 1. Pre-Compilation          ║
║    Validation               ║
╠═════════════════════════════╣
║ validateRecipe()            ║
║ ├─ Check module kinds       ║
║ └─ Check slots match        ║
║                             ║
║ validateRecipeModules()     ║
║ ├─ Parse GLSL uniforms      ║
║ ├─ Check uniformBindings    ║
║ └─ Warn about unbound       ║
╚═════════════════════════════╝
  ↓ (if valid)
╔═════════════════════════════╗
║ 2. Shader Compilation       ║
╠═════════════════════════════╣
║ ShaderCompiler.compile()    ║
║ ├─ Concatenate modules      ║
║ ├─ Compile GLSL             ║
║ └─ Link program             ║
║   ↓ (if error)              ║
║ translateShaderErrors()     ║
║ ├─ Parse error log          ║
║ ├─ Map lines to modules     ║
║ ├─ Extract context          ║
║ └─ Generate suggestions     ║
╚═════════════════════════════╝
  ↓ (if valid)
╔═════════════════════════════╗
║ 3. Resource Loading         ║
╠═════════════════════════════╣
║ loadEnvironmentHDR()        ║
║ ├─ Validate fetch           ║
║ ├─ Validate buffer          ║
║ ├─ Parse HDR                ║
║ ├─ Validate dimensions      ║
║ └─ Create texture           ║
╚═════════════════════════════╝
```

---

## Validation Functions

### Recipe Validation

```typescript
import { validateRecipe } from './src/errors/engine/validation';

const result = validateRecipe(recipe);
// Returns: { valid: boolean; errors: string[]; warnings?: string[] }

if (!result.valid) {
    console.error('Recipe errors:', result.errors);
}
```

### Module Uniform Validation

```typescript
import { validateModuleUniforms } from './src/errors/engine/validation';

const result = validateModuleUniforms(module);

if (!result.valid) {
    console.error('Uniform errors:', result.errors);
}

if (result.warnings && result.warnings.length > 0) {
    console.warn('Warnings:', result.warnings);
}
```

### HDR Validation

```typescript
import { validateHDRResponse, validateHDRBuffer, validateHDRData } from './src/errors/resources/validation';

// Validate fetch response
const responseResult = validateHDRResponse(response, path);

// Validate buffer contents
const bufferResult = validateHDRBuffer(buffer, path);

// Validate parsed data
const dataResult = validateHDRData(width, height, dataLength, path);
```

---

## Error Categories

### Shader Error Categories

```typescript
type ErrorCategory =
    | 'missing_function'  // Function not found
    | 'type_mismatch'     // Type incompatibility
    | 'syntax'            // GLSL syntax error
    | 'linker_error'      // Program linking failed
    | 'uniform_error'     // Uniform issue
    | 'other';            // Uncategorized
```

Each category gets specific handling and suggestions.

---

## Diagnostics Output

### ShaderDiagnostics Type

```typescript
interface ShaderDiagnostics {
    success: boolean;
    errors: TranslatedError[];
    warnings: TranslatedError[];
    source: string;
    sourceWithLineNumbers: string;
    modules: ModuleDescriptor[];
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
```

### TranslatedError Type

```typescript
interface TranslatedError {
    severity: 'error' | 'warning';
    category: ErrorCategory;
    message: string;
    detail?: string;
    functionName?: string;
    requiredBy?: string;
    expectedProvider?: string;
    locations: SourceLocation[];
    suggestion?: string;
    alternatives?: string[];
    originalError: GLSLError;
}
```

---

## Console Output Formatting

Errors use ANSI colors and Unicode symbols for readability:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Missing Function
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Function 'scene_raymarsh' not found

Module: world/scene/raymarch-scene
Line 45:
  43 |     // Trace scene
  44 |     vec3 hitPoint = ray.origin + ray.direction * t;
  45 |     Hit hit = scene_raymarsh(ray);
                      ^^^^^^^^^^^^^^^

💡 Did you mean 'scene_raymarch'?

Available functions in 'scene' modules:
  • scene_raymarch (from raymarch-scene)
  • scene_pointAt (from raymarch-scene)
```

**Features**:
- Error category with icon
- Module context
- Source code snippet with line numbers
- Error location highlighting
- Suggestions ("Did you mean?")
- Available alternatives

---

## Error Handling Best Practices

### 1. Validate Early

```typescript
// ✅ Good: Validate before compilation
const recipeResult = validateRecipe(recipe);
if (!recipeResult.valid) {
    throw new Error('Invalid recipe');
}

const uniformResult = validateRecipeModules(recipe);
if (!uniformResult.valid) {
    throw new Error('Invalid uniforms');
}

// Now compile (errors are less likely)
const compilationResult = compiler.compile(modules);
```

### 2. Handle Errors Gracefully

```typescript
try {
    await app.loadEnvironmentHDR('/hdri/env.hdr');
} catch (error) {
    console.error('Failed to load HDR:', error.message);
    // Fall back to default environment
    app.setParameter('environment.radiance', [1, 1, 1]);
}
```

### 3. Provide Context

```typescript
// ❌ Bad: Generic error
throw new Error('Compilation failed');

// ✅ Good: Specific context
throw new Error(
    `Failed to compile recipe "${recipe.id}". ` +
    `See console for detailed error messages.`
);
```

### 4. Log Warnings

```typescript
if (result.warnings && result.warnings.length > 0) {
    console.warn(`⚠️  Warnings for '${recipe.id}':`);
    result.warnings.forEach(warn => console.warn(`  • ${warn}`));
}
```

---

## Testing Errors

See `tests/error-reporting/` for test utilities and examples.

**Quick test**:
```bash
# Introduce deliberate error
node tests/error-reporting/test-error-reporting.js

# Run dev server
npm run dev

# Check browser console for error output

# Revert test
node tests/error-reporting/revert-test.js
```

---

## Further Reading

- [Validation](validation.md) - Pre-compilation validation details
- [Shader Errors](shader-errors.md) - GLSL error translation
- [Resource Errors](resource-errors.md) - HDR/texture validation
- [Architecture](../architecture.md) - Error system integration
