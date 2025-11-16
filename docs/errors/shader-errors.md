# Shader Error Translation

GLSL compiler error translation into helpful, actionable diagnostics.

## Overview

When GLSL compilation fails, raw errors are cryptic:

```
ERROR: 0:245: 'interaction_surface_shaed' : no matching overloaded function found
ERROR: 0:245: 'return' : function return is not matching type
```

The shader error translator converts these into:

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

---

## Translation Pipeline

```
GLSL Compiler Error
  ↓
1. Parse (ShaderErrorParser)
   ├─ Extract error message
   ├─ Extract line number
   └─ Build line→module map
  ↓
2. Translate (ShaderErrorTranslator)
   ├─ Categorize error
   ├─ Extract function names
   ├─ Find suggestions
   └─ Add context
  ↓
3. Format (ShaderErrorFormatter)
   ├─ ANSI colors
   ├─ Source snippets
   └─ Pretty output
```

---

## Error Categories

### Missing Function

**Pattern**: `no matching overloaded function found`, `undefined`, `undeclared identifier`

**Translation**:
- Extracts function name
- Searches for similar names (Levenshtein distance)
- Lists available functions in same module kind
- Shows module context

**Example**:
```glsl
vec3 radiance = transport_tracer(ray);  // Typo
```

**Output**:
```
⚠️  Missing Function

Function 'transport_tracer' not found

💡 Did you mean 'transport_trace'?

Available functions in 'transport' modules:
  • transport_trace (from path-tracer-direct-light)
```

### Type Mismatch

**Pattern**: `type mismatch`, `cannot convert`

**Translation**:
- Shows expected vs actual types
- Points to problematic expression

**Example**:
```glsl
float x = vec3(1.0);  // Type error
```

### Syntax Error

**Pattern**: `syntax error`, `unexpected token`

**Translation**:
- Shows syntax context
- Suggests corrections

### Uniform Error

**Pattern**: `undeclared.*uniform`, `uniform.*not found`

**Translation**:
- Identifies uniform name
- Suggests checking uniformBindings
- Lists declared uniforms

---

## Module Boundary Comments

The compiler injects comments to mark module boundaries:

```glsl
// ============ camera (camera) ============
uniform vec3 u_camera_position;
// ... camera functions

// ============ interaction (interaction) ============
uniform vec3 u_albedo;
// ... interaction functions
```

These enable line number mapping:
```
Line 245 in concatenated shader
  → Line 41 in module 'interaction'
  → File: src/optics/interaction/lambert-interaction.ts
```

---

## Typo Detection

Uses Levenshtein distance to find similar names:

```typescript
function levenshteinDistance(a: string, b: string): number {
    // Computes edit distance
    // Returns number of insertions/deletions/substitutions
}

function findSuggestions(functionName: string, available: string[]): string[] {
    return available
        .map(name => ({ name, distance: levenshteinDistance(functionName, name) }))
        .filter(({ distance }) => distance <= 3)  // Max 3 edits
        .sort((a, b) => a.distance - b.distance)
        .map(({ name }) => name);
}
```

**Examples**:
- `shaed` → `shade` (distance: 1)
- `raymarsh` → `raymarch` (distance: 1)
- `tracer` → `trace` (distance: 1)

---

## Function Extraction

Auto-extracts function declarations from GLSL:

```glsl
Ray camera_generateRay(vec2 uv) { ... }
Hit scene_raymarch(Ray ray) { ... }
Surface interaction_surface_shade(Point p, Ray ray, Hit hit) { ... }
```

**Regex Pattern**:
```typescript
/(\w+)\s+(\w+_\w+)\s*\(/g
```

Extracts:
- Return type
- Function name (with module prefix)

Used for suggestions and module introspection.

---

## Source Context Extraction

Shows 3 lines before and after error:

```
Line 41:
  38 |     LightSample ls = lighting_sample(hitPoint);
  39 |     vec3 wo = -ray.direction;
  40 |     vec3 wi = ls.wi;
  41 |     vec3 radiance = interaction_surface_shaed(
                            ^^^^^^^^^^^^^^^^^^^^^^^
  42 |         hitPoint, ray, hit, wo, wi
  43 |     );
  44 |     return radiance;
```

Line numbers are relative to the module (not concatenated shader).

---

## Error Deduplication

Groups same error at multiple locations:

**Example**:
```
Function 'scene_raymarsh' not found

Locations:
  • Line 45 in transport
  • Line 78 in transport
  • Line 112 in transport
```

(Can be disabled with `showAllOccurrences: true`)

---

## Format Options

```typescript
interface FormatOptions {
    showLineNumbers?: boolean;       // Show line numbers (default: true)
    showContext?: boolean;           // Show source snippets (default: true)
    showAllOccurrences?: boolean;    // Show all error locations (default: false)
    maxContextLines?: number;        // Context lines (default: 3)
    useColors?: boolean;             // ANSI colors (default: true)
    groupByCategory?: boolean;       // Group by category (default: false)
    groupByModule?: boolean;         // Group by module (default: false)
}
```

---

## Console Output

**Colors**:
- Red: Errors
- Yellow: Warnings
- Cyan: File/module names
- Gray: Line numbers
- White: Source code
- Green: Suggestions

**Symbols**:
- `⚠️` - Warning
- `❌` - Error
- `💡` - Suggestion
- `━` - Section divider
- `•` - List item

---

## API

### translateShaderErrors

```typescript
function translateShaderErrors(
    errorLog: string,
    source: string,
    modules: ModuleDescriptor[]
): ShaderDiagnostics
```

**Usage**:
```typescript
const diagnostics = translateShaderErrors(
    glErrorLog,
    concatenatedShaderSource,
    modulesArray
);

if (!diagnostics.success) {
    const formatter = new ShaderErrorFormatter();
    const formatted = formatter.formatConsole(diagnostics);
    console.error(formatted);
}
```

### formatShaderErrors

```typescript
function formatShaderErrors(
    errorLog: string,
    source: string,
    modules: ModuleDescriptor[],
    options?: Partial<FormatOptions>
): string
```

**One-liner**:
```typescript
const formatted = formatShaderErrors(errorLog, source, modules, {
    maxContextLines: 5,
    showAllOccurrences: true
});
console.error(formatted);
```

---

## Integration

Automatically integrated in ShaderCompiler:

```typescript
// ShaderCompiler.compile()
try {
    this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
} catch (error: any) {
    const errorLog = error.message || String(error);
    const diagnostics = translateShaderErrors(errorLog, fragmentSource, modules);

    const formatter = new ShaderErrorFormatter();
    console.error(`\n❌ Shader compilation failed:\n`);
    console.error(formatter.formatConsole(diagnostics));

    return { success: false, diagnostics };
}
```

---

## Best Practices

1. **Read the suggestion** - "Did you mean?" is usually correct
2. **Check module context** - Error shows which module has the issue
3. **Look at source snippet** - Context helps understand the problem
4. **Fix typos early** - Validator catches some before compilation
5. **Use naming conventions** - `modulekind_functionname` prevents collisions

---

## Next Steps

- [Validation](validation.md) - Pre-compilation validation
- [Resource Errors](resource-errors.md) - HDR/texture errors
- [Error System Overview](README.md) - Complete error system
