# ShaderCompiler Refactoring 

## Summary

Extracted parameter-to-uniform translation from `ShaderCompiler` into a new `ParameterManager` class. ShaderCompiler now handles only GLSL compilation; ParameterManager handles runtime uniform updates driven by parameter changes.

## Motivation

**Before**: ShaderCompiler mixed two distinct responsibilities:
1. Compile GLSL source → WebGLProgram (happens once per module load)
2. Translate parameter changes → GPU uniform updates (happens every parameter change)

**Problem**: The name "ShaderCompiler" implies compilation only, but it was also doing runtime parameter management. This made the code harder to understand and prevented clean separation when adding future features like RenderCoordinator.

**After**: Clean separation of concerns:
- **ShaderCompiler**: GLSL compilation only
- **ParameterManager**: Parameter → uniform translation
- **Engine**: Orchestrates both

## What Moved

### From ShaderCompiler → ParameterManager

```typescript
// Binding metadata
private uniformBindings: Map<string, UniformBinding>
private parameterToBindings: Map<string, Set<UniformBinding>>

// Caches
private parameterCache: Map<string, any>
private uniformValueCache: Map<string, any>
private updateStats: { total: number; skipped: number }

// Methods
buildUniformBindings(modules: ModuleDescriptor[]): void
updateUniforms(changes: ParameterChanges): void
clearCache(): void
getCacheStats(): { total, skipped, skipRate }
logStatsIfNeeded(): void
```

### Stayed in ShaderCompiler

```typescript
// Programs
private mainProgram, displayProgram, activeProgram

// Engine uniform locations (u_time, u_resolution, etc.)
private uniformLocations

// Compilation
compile(modules): { mainProgram, displayProgram }
compileAndLinkProgram()
compileShader()
setActiveProgram()

// Engine-driven uniforms (not from ParameterStore)
updateEngineUniforms(uniforms: EngineUniforms)

// Debug
getDebugInfo()
```

## Key Changes

### ShaderCompiler

**Changed**: `compile()` now returns programs instead of storing them silently
```typescript
// Before
compile(modules: ModuleDescriptor[]): string

// After  
compile(modules: ModuleDescriptor[]): { 
    mainProgram: WebGLProgram; 
    displayProgram: WebGLProgram;
}
```

**Removed**: All parameter management (moved to ParameterManager)

**Kept**: Engine uniform updates (`updateEngineUniforms`) for time, resolution, frameIndex, sampleCount

### ParameterManager (NEW)

**New file**: `engine/ParameterManager.ts`

**Purpose**: Manages the parameter → uniform translation layer

**Key method**: `initialize(program: WebGLProgram, modules: ModuleDescriptor[])`
- Extracts uniformBindings from modules
- Builds reverse map: parameter path → affected uniforms
- Caches uniform locations

**Runtime**: `updateUniforms(changes: ParameterChanges)`
- Finds affected bindings
- Computes new uniform values
- Caches and updates GPU
- Reports cache hit rate (~60% typically)

### Engine

**Added**: ParameterManager instance
```typescript
private parameters: ParameterManager;
```

**Modified**: `loadModules()` now initializes both systems
```typescript
const { mainProgram, displayProgram } = this.compiler.compile(modules);
this.parameters.initialize(mainProgram, modules);  // NEW
this.compiler.setActiveProgram(mainProgram);
```

**Changed**: `updateParameters()` delegates to ParameterManager
```typescript
updateParameters(changes: ParameterChanges): void {
    this.parameters.updateUniforms(changes);  // Was: this.compiler.updateUniforms()
}
```

## Uniform Location Caching

**Important**: Each system caches its own uniform locations independently:

- **ShaderCompiler**: Caches engine uniforms (`u_time`, `u_resolution`, `u_frame_index`, `u_sample_count`)
- **ParameterManager**: Caches parameter-driven uniforms (everything from module `uniformBindings`)

This duplication is intentional - it maintains clean separation between engine-provided uniforms and parameter-driven uniforms.

## Testing

After refactoring, verified:
- ✅ Module loading works
- ✅ Rendering produces correct output
- ✅ Parameter changes update uniforms
- ✅ Cache statistics still logged
- ✅ Engine uniforms (time, resolution) still update every frame
- ✅ No performance regression

## Files Changed

- **Modified**: `engine/ShaderCompiler.ts` (simplified, ~100 lines shorter)
- **Modified**: `engine/Engine.ts` (added ParameterManager integration)
- **Created**: `engine/ParameterManager.ts` (new file, ~150 lines)

## Future Work

This refactoring enables:
- Adding RenderCoordinator without depending on "ShaderCompiler" for parameter management
- Testing uniform updates independently from shader compilation
- Optimizing parameter updates separately from compilation

## Migration Notes

**No API changes** for module authors - `uniformBindings` in ModuleDescriptor works exactly the same.

**No breaking changes** for existing code - all functionality preserved, just reorganized internally.
