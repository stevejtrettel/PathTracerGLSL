# Engine Implementation - Current State

## Overview

The Engine is a **simplified, functional implementation** that demonstrates the core rendering pipeline. It successfully renders frames using a modular shader system but **does not yet implement** the full contract specified in the design documents.

**Status**: ✅ Core rendering works, ⚠️ Missing advanced features

## What's Implemented (Working)

### ✅ Core Rendering Pipeline
- **Three-pass rendering**: Main (accumulation) → Display (tone mapping) → Composite (to screen)
- **Per-recipe accumulation buffers**: Each recipe maintains independent RGBA32F radiance + RGBA8 RGB
- **Ping-pong buffering**: Proper double-buffering for temporal accumulation
- **Engine uniforms**: resolution, imageSize, frameIndex, time, sampleCount, pixelOffset
- **Tiled rendering support**: pixelOffset and imageSize for rendering tiles of large images

### ✅ HDR Environment Maps
- **HDR loading**: Complete .hdr/.rgbe file parser
- **Importance sampling**: Automatic CDF generation (conditional + marginal)
- **Global texture registry**: Environment maps shared across all recipes
- **Proper binding**: Textures bound to all recipe programs automatically

### ✅ Parameter Management
- **Uniform bindings**: Maps parameters → shader uniforms via compute functions
- **Value caching**: Skips redundant GPU calls when values unchanged
- **Statistics tracking**: Reports cache hit rate every 60 frames
- **Batch awareness**: Handles parameter changes from ParameterStore

### ✅ Resource Management
- **Per-recipe buffers**: Independent accumulation for each recipe
- **Recipe switching**: Instant switching preserves each recipe's state
- **Resize handling**: Recreates all buffers (destroys accumulation - documented)
- **Proper cleanup**: disposes textures and framebuffers on demand

### ✅ Shader Compilation
- **Module ordering**: Respects MODULE_ORDER dependency chain
- **Three programs**: main, display, composite (composite is shared)
- **RNG integration**: Hash-based RNG system from pixel coords + frame index
- **Common structs**: Ray, Hit, MaterialProperties, LightSample, Frame
- **Debug info**: Source code with line numbers for error diagnosis

### ✅ Pixel Readback
- **HDR export**: readRadiance() returns Float32Array (RGBA32F)
- **LDR export**: readRGB() returns Uint8Array (RGBA8)
- **Rectangle support**: Can read subregions
- **Proper binding**: Reads from correct framebuffers

## What's Different from Design Docs

### Module System Evolution
**Design**: `geometry`, `scene`, `lighting`, `camera`, `transport`, `interaction`, `film`, `developer`
**Current**: `ambient`, `environment`, `scene`, `lighting`, `camera`, `interaction`, `transport`, `accumulator`, `developer`

Changes:
- `geometry` → `ambient` (more accurate name for differential geometry)
- `film` → `accumulator` (clearer about temporal accumulation)
- Added `environment` as separate module (for fog, participating media, sky models)

### Simplified Architecture
The current implementation **removes several layers of abstraction** for development speed:

1. **No ModuleRegistry** - Recipes directly contain ModuleDescriptors
2. **No validation layer** - Assumes modules are correct
3. **No SimpleCompiler wrapper** - ShaderCompiler is the only compiler
4. **No UniformMap abstraction** - Direct UniformBinding usage

These were intentional simplifications for the initial build.

## What's Missing (Needs Implementation)

### ❌ ModuleRegistry (High Priority)
**Purpose**: Validate modules, enforce KIND prefixing, provide module discovery

Missing features:
- Module registration and storage
- Validation of required functions (ambient_*, scene_*, etc.)
- KIND prefix enforcement checking
- Recipe compatibility checking
- Built-in module catalog
- Module search and listing

**Impact**: Currently no validation that modules implement required functions. Shader errors are the only feedback.

### ❌ Advanced Compilation Features
**Purpose**: Eager compilation, caching, reporting

Missing features:
- Compile all recipes at initialization (currently compiles on-demand)
- Compilation time tracking and reports
- Source code inspection by recipe ID
- Program deletion and recompilation
- Shader error context with line numbers near error

**Impact**: Less helpful error messages, no compilation performance tracking

### ❌ Snapshot System (Medium Priority)
**Purpose**: Periodic saves for accumulating recipes, recovery after context loss

Missing features:
- `captureSnapshot(recipeId, pixels, frame)` - periodic saves
- `getSnapshot(recipeId)` - retrieve last snapshot
- `hasSnapshot(recipeId)` - check if snapshot exists
- Automatic cleanup on recipe disposal

**Impact**: Context loss destroys all accumulation with no recovery option

### ❌ Comprehensive Resource Management
**Purpose**: Capability detection, memory tracking, fallback suggestions

Missing features:
- Full capability detection (floatRenderTargets, maxTextureSize, etc.)
- `validateCapabilities()` with error/warning/suggestion
- `suggestFallback()` for missing capabilities
- Detailed memory statistics
- `canAllocate(bytes)` memory checks

**Impact**: Minimal GPU capability checking, no memory usage tracking

### ❌ Advanced Executor Features
**Purpose**: Viewport management, state control, performance tracking

Missing features:
- Viewport stack (`pushViewport`, `popViewport`)
- Render target switching (framebuffer vs screen)
- State save/restore (`saveState`, `restoreState`)
- Frame statistics (FPS, frame timing)
- Async pixel readback (only sync currently)
- WebGL state feature control

**Impact**: No performance metrics, only synchronous pixel reads

### ❌ Error Handling System
**Purpose**: Structured error types for better debugging

Missing types:
- `EngineError` base class
- `CompilationError` with validation details
- `ResourceAllocationError` with memory info
- `ModuleNotFoundError` with alternatives

**Impact**: Generic Error objects, less informative error messages

### ❌ Context Loss Recovery
**Purpose**: Graceful degradation when GPU context lost

Missing features:
- Proper resource cleanup without GPU calls
- State preservation for recovery
- User notification about accumulation loss
- Snapshot availability reporting
- Recompilation after restore

**Impact**: Minimal context loss handling, just logs error

## Architecture Comparison

### Design Doc Vision (Full System)
```
Engine
├── ModuleRegistry (validate, search, catalog)
├── SimpleCompiler (eager compile, cache, reports)
├── ResourceManager (capabilities, snapshots, stats)
└── RenderExecutor (viewport stack, state, async readback)
```

### Current Implementation (Simplified)
```
Engine
├── ShaderCompiler (basic compilation)
├── ParameterManager (bindings + caching)
├── ResourceManager (buffers + recipe switching)
├── RenderExecutor (three-pass rendering)
└── TextureRegistry (global textures)
```

## Type System Evolution

### Design Types vs Current Types

| Design Doc | Current Code | Notes |
|------------|--------------|-------|
| `ModuleKind` (8 types) | `ModuleKind` (10 types) | Added `ambient`, `environment`, `accumulator` |
| `CompiledProgram` | Not used | Programs stored directly in Map |
| `UniformMap` | Not used | ParameterManager uses UniformBinding directly |
| `ValidationResult` | Defined but unused | No validation implemented yet |
| `EngineState` | Simplified | Only 'ready' \| 'running' (no 'error' state) |

## Key Design Decisions Implemented

### ✅ Per-Recipe Resources
Each recipe maintains completely independent GPU resources:
- Separate RGBA32F radiance buffers (ping-pong pair)
- Separate RGBA8 RGB output buffer
- Independent sample counters
- Recipe switching is O(1) and preserves all state

### ✅ Three-Pass Rendering
1. **Main Pass** (Fragment shader): Camera → Transport → Accumulator
   - Reads: previous radiance texture (unit 0)
   - Writes: current radiance buffer (RGBA32F)
   - Implements: Full path tracing pipeline

2. **Display Pass** (Fragment shader): Developer tone mapping
   - Reads: current radiance texture
   - Writes: RGB buffer (RGBA8)
   - Implements: Tone mapping operator

3. **Composite Pass** (Fragment shader): Simple blit
   - Reads: RGB texture
   - Writes: Screen
   - Implements: Final display

This separation allows:
- Swapping tone mappers without recompiling transport
- Reading raw HDR for analysis
- Exporting both HDR and LDR output

### ✅ Global vs Per-Recipe Textures
- **Global**: Environment maps (shared, loaded once)
- **Per-Recipe**: Accumulation buffers (independent state)

### ✅ Tiled Rendering Infrastructure
- `pixelOffset`: Shifts pixel coordinates for tile alignment
- `imageSize`: Full image dimensions (larger than tile)
- Camera uses these to maintain correct perspective

## Performance Characteristics

### Strengths
- **Parameter caching**: ~80-90% cache hit rate (skips GPU calls)
- **Recipe switching**: O(1) using pre-compiled programs
- **Memory efficiency**: Only active recipe's buffers in use
- **Minimal state changes**: Programs stay bound between frames

### Known Limitations
- **Resize destroys accumulation**: All recipes reset on canvas resize
- **No progressive tile accumulation**: Each tile restarts from 0
- **Synchronous pixel reads**: Blocks until GPU finishes
- **No memory tracking**: Unknown total GPU memory usage

## Integration Points

### Input from ParameterStore
```typescript
engine.updateParameters(changes: ParameterChanges)
  ↓
ParameterManager.updateUniforms()
  ↓
Finds affected UniformBindings
  ↓
Computes new uniform values
  ↓
Checks cache (skip if unchanged)
  ↓
Updates GPU via setUniformValue()
```

### Output to Display
```typescript
engine.renderFrame()
  ↓
Main Pass (accumulation)
  ↓
Display Pass (tone mapping)
  ↓
Composite Pass (to screen)
```

### Export Paths
```typescript
// HDR for scientific analysis
const hdr = engine.readRadiance();  // Float32Array, unbounded range

// LDR for PNG/JPEG
const ldr = engine.readRGB();  // Uint8Array, 0-255
```

## Testing Status

### ✅ Verified Working
- Recipe switching preserves accumulation
- Environment maps load and importance sample correctly
- Parameter changes update uniforms
- HDR and LDR readback produce correct data
- Tiled rendering shifts pixels correctly
- Resize recreates all buffers

### ⚠️ Not Yet Tested
- Context loss recovery
- Multiple simultaneous recipes
- Large texture counts (memory limits)
- Very high resolution (>8K)
- Error handling paths

## Migration Path to Full Design

The current simplified implementation can evolve to the full design:

1. **Add ModuleRegistry** - Wrap existing Recipe → modules extraction
2. **Upgrade ShaderCompiler** - Add compilation reports, caching
3. **Add Snapshot System** - Extend ResourceManager with periodic saves
4. **Enhance RenderExecutor** - Add viewport stack, state management
5. **Implement Error Types** - Replace generic Errors with structured types
6. **Add Capability Detection** - Check GPU limits at construction

The core architecture is sound - these are additive features.

## Summary

**What we have**: A clean, working renderer with modular shaders, per-recipe accumulation, HDR environment maps, and both HDR/LDR output.

**What we need**: Validation (ModuleRegistry), polish (error handling, stats), and recovery features (snapshots, context loss).

**Bottom line**: The foundation is solid. The missing pieces are quality-of-life features that make the system more robust and developer-friendly, not fundamental architecture changes.
