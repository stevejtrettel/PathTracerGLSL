Looking at both versions, I can see the short one lacks the pipeline architecture detail while the long one has too much implementation code. Here's a version that strikes the right balance - specifying all necessary components while remaining focused on the contract:

# Shader Compiler Contract

## Purpose

The ShaderCompiler transforms collections of modules into complete, executable GLSL programs using an 8-stage compilation pipeline. It performs eager compilation at startup and provides instant access to pre-compiled programs.

## Required Interface

```typescript
interface ShaderCompiler {
  // Eager compilation at startup
  initialize(recipes: Recipe[]): void;
  
  // Get pre-compiled program (instant)
  getProgram(recipeName: string): CompiledProgram;
  
  // Direct compilation (used internally by initialize)
  compile(recipe: Recipe): CompiledProgram;
  
  // Query compilation results
  hasProgram(recipeName: string): boolean;
  getProgramCount(): number;
  getAllProgramNames(): string[];
  
  // Debugging
  getPipeline(): CompilationPipeline;
  getSource(programId: string): string;
  getLineMapping(programId: string): LineMapping;
  getCompilationReport(): CompilationReport;
}
```

## Compiled Program Structure

```typescript
interface CompiledProgram {
  id: string;                          // Unique identifier
  program: WebGLProgram;                // GPU program object
  uniformMap: UniformMap;               // Parameter mappings
  recipe: Recipe;                       // Source recipe
  modules: ModuleDescriptor[];         // Modules used
  metadata: {
    compiledAt: number;               // Timestamp
    vertexSource: string;             // For debugging
    fragmentSource: string;           // For debugging
    lineMap: LineMapping;             // Error line mapping
    stages: string[];                 // Pipeline stages executed
  };
}

interface LineMapping {
  lines: Array<{
    compiledLine: number;
    sourceLine: number;
    module: string;
    originalFunction?: string;
  }>;
  
  // Maps compiled shader line numbers to source module/line
  getSourceLocation(compiledLine: number): {
    module: string;
    originalLine: number;
    function?: string;
  };
}
```

## Compilation Pipeline

The compiler MUST implement an 8-stage pipeline:

```typescript
interface CompilationPipeline {
  stages: CompilationStage<any, any>[];
  compile(recipe: Recipe): CompiledProgram;
}

interface CompilationStage<TIn, TOut> {
  name: string;
  transform(input: TIn): TOut;
  validate(output: TOut): ValidationResult;
}
```

### Required Pipeline Stages

1. **CollectModulesStage**: Recipe → ModuleCollection
    - Extracts all 8 modules from recipe
    - Validates all required module types present
    - Ensures single material module (not array)

2. **ValidateDependenciesStage**: ModuleCollection → ModuleCollection
    - Builds provides/requires dependency graph
    - Validates all dependencies satisfied
    - Detects duplicate function provisions

3. **SortModulesStage**: ModuleCollection → ProcessedModule[]
    - Places Geometry first (defines types)
    - Topologically sorts remaining modules by dependencies
    - Detects circular dependencies

4. **ApplyPrefixesStage**: ProcessedModule[] → ProcessedModule[]
    - Applies module-specific prefixes to functions
    - Prefixes uniform parameters
    - Updates function mappings

5. **ResolveCallsStage**: ProcessedModule[] → ProcessedModule[]
    - Maps cross-module function calls to prefixed names
    - Validates all requires are resolved

6. **GenerateMainStage**: ProcessedModule[] → CompiledSource
    - Creates main() orchestration function
    - Generates standard vertex shader

7. **ExtractUniformsStage**: CompiledSource → CompiledWithUniforms
    - Builds uniform information for all parameters
    - Adds engine uniforms

8. **CompileGLSLStage**: CompiledWithUniforms → CompiledProgram
    - Assembles final GLSL source
    - Compiles vertex and fragment shaders
    - Links program and builds UniformMap

### Intermediate Types

```typescript
interface ProcessedModule {
  descriptor: ModuleDescriptor;
  prefixedSource: string;
  originalSource: string;
  functionMap: Map<string, string>;  // original → prefixed
}

interface CompiledSource {
  modules: ProcessedModule[];
  main: string;
  vertexShader: string;
}

interface CompiledWithUniforms extends CompiledSource {
  uniforms: UniformInfo[];
}
```

## Compilation Requirements

### Eager Compilation
- All recipes MUST be compiled during `initialize()`
- Compilation failures MUST fail fast with clear errors
- Recipe key: `geometry_material_scene_lights_camera_estimator_film_developer`

### Module Assembly Order
1. **Geometry** (first - defines types)
2. Other modules in dependency order (topological sort)
3. **Main function** (last - orchestration)

## Prefixing System

All module functions and uniforms MUST be automatically prefixed:

### Function Prefixes
| Module Kind | Prefix | Example |
|------------|--------|---------|
| geometry | `g_` | `geodesic()` → `g_geodesic()` |
| material | `m_` | `evaluate()` → `m_evaluate()` |
| scene | `sc_` | `intersect()` → `sc_intersect()` |
| lights | `l_` | `sample_light()` → `l_sample_light()` |
| camera | `c_` | `generate_ray()` → `c_generate_ray()` |
| estimator | `e_` | `estimate()` → `e_estimate()` |
| film | `f_` | `accumulate()` → `f_accumulate()` |
| developer | `d_` | `develop()` → `d_develop()` |

### Uniform Prefixes
Pattern: `u_[prefix][module_name]_[param_name]`
Example: `camera.position` → `u_camera_pinhole_position`

## Fragment Shader Assembly

The compiler MUST assemble fragment shaders in this exact order:

1. GLSL version (`#version 300 es`) and precision
2. Math utilities (always available globally)
3. Type definitions from Geometry module
4. Module sources (prefixed, in dependency order)
5. Engine uniform declarations
6. Main orchestration function

## Required Math Utilities

The compiler MUST provide these globally available utilities:
- Constants: `PI`, `EPSILON`, `MAX_DIST`
- Dimension tracking: `g_dimension_counter`
- Sampling: `next_1d()`, `next_2d()`
- Helpers: `sample_unit_disk()`, etc.
- Type aliases: `Spectrum`, `Radiance`, `RGB`

## Engine Uniforms

The compiler MUST inject and track these uniforms:

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_resolution` | vec2 | Viewport dimensions |
| `u_frame_index` | int | Current frame number |
| `u_sample_count` | int | Accumulation count |
| `u_film_reset` | bool | Clear accumulation flag |
| `u_time` | float | Seconds since start |

## Main Function Requirements

The generated main() MUST:
1. Initialize dimension counter (`g_dimension_counter = 0`)
2. Sample for antialiasing (`vec2 xi = next_2d()`)
3. Generate ray (`c_generate_ray(pixel, xi)`)
4. Estimate radiance (`e_estimate(ray)`)
5. Accumulate samples (`f_accumulate(radiance, pixel)`)
6. Develop output (`d_develop(accumulated)`)
7. Write to `gl_FragColor`

## Validation Requirements

### Stage-Specific Validation

Each pipeline stage MUST validate its output:

1. **CollectModules**: All 8 module types present
2. **ValidateDependencies**: All requires have providers, no duplicates
3. **SortModules**: Geometry is first, no circular dependencies
4. **ApplyPrefixes**: No naming conflicts after prefixing
5. **ResolveCalls**: All cross-module calls resolved
6. **GenerateMain**: Main function generated successfully
7. **ExtractUniforms**: All parameters have uniform info
8. **CompileGLSL**: Shaders compile and link successfully

### Error Reporting

Compilation errors MUST include:
- Pipeline stage where failure occurred
- Module causing the error (if applicable)
- Line number and context (for GLSL errors)
- Validation errors from the failing stage

Error context format:
```
Compilation failed at stage: ApplyPrefixes
Module: pathtracer
Line 42: ERROR: 'intersect' undeclared identifier
Context:
  40:     Ray ray = make_ray(origin, direction);
  41:     Hit hit;
> 42:     if (intersect(ray, hit)) {
  43:         return hit.material_id;
```

## Performance Requirements

- Total `initialize()` time: < 2 seconds for 2-3 typical recipes
- Individual recipe compilation: < 500ms
- Program retrieval (`getProgram()`): < 1ms (pre-compiled)
- Line mapping generation: < 5ms per program

## Integration Requirements

The compiler MUST:
- Use ModuleRegistry to resolve modules
- Build UniformMap for parameter binding
- Provide valid WebGLProgram for GPU execution
- Generate complete debugging information
- Clean up intermediate GL objects (shaders) after linking

## Invariants

1. After `initialize()`, all recipes are compiled and cached
2. `getProgram()` never triggers compilation
3. Module functions are always prefixed according to the prefix table
4. Geometry module is always first in assembled source
5. Dependencies are always ordered before dependents
6. All cross-module calls are resolved to prefixed names
7. Line mappings accurately map compiled lines to source modules
8. Failed compilation at startup prevents system initialization
