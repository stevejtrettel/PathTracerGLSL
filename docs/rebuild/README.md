# PathTracer Architecture Rebuild

This directory documents the ongoing architectural refactor of the PathTracerGLSL rendering system from a module-concatenation approach to a **Compiler-Engine paradigm**.

## Overview

The original system concatenated GLSL "modules" (strings) to build shaders, but this created friction when modules needed to communicate during compilation. The new system separates concerns:

- **Compiler**: Generates complete GLSL code and execution pipelines from scene descriptions
- **Engine**: Executes pipelines blindly without knowing about scenes or strategies

This separation allows the Compiler to make intelligent decisions about code generation while the Engine focuses purely on efficient GPU execution.

## Documentation

- [**Architecture**](./architecture.md) - Detailed explanation of the Compiler-Engine paradigm
- [**Implementation Status**](./implementation-status.md) - What's built, what's missing
- [**App Integration**](./app-integration.md) - Discussion of App layer integration

## Quick Status

### ✅ Completed (Phase 0-5)
- Core type definitions (`CompiledRenderer`, `RenderPipeline`)
- `SimpleCompiler` - Hardcoded compiler for validation
- `FlexibleEngine` - Complete execution engine with:
  - `FlexibleResourceManager` - Dynamic GPU resource creation
  - `FlexibleRenderExecutor` - Generic pipeline execution
  - Parameter system integration
  - Export/read operations (`readExport('hdr')`)
- Working test page with debug and pathtracer renderers

### 🚧 Next Steps
- App layer integration (design questions to resolve)
- Real Compiler with code generation (Phase 7)
- Migration of old features (see implementation-status.md)

## Timeline

- **Phase 0-1**: Type definitions + SimpleCompiler (validation only)
- **Phase 2**: FlexibleResourceManager (dynamic framebuffer creation)
- **Phase 3**: FlexibleRenderExecutor (pipeline execution)
- **Phase 4**: FlexibleEngine (orchestration + parameter integration)
- **Phase 5**: Test page (end-to-end validation)
- **Phase 6**: Export system (read HDR/LDR data)
- **Phase 7**: Real Compiler (TODO)
- **Phase 8**: App integration (TODO - design in progress)

## Testing

Run the test page:
```bash
npm run dev
# Navigate to http://localhost:5173/test-flexible-engine.html
```

The test page demonstrates:
- Renderer switching (debug/pathtracer)
- Progressive accumulation
- Sample counting
- Export reading (`readExport('hdr')`, `readExport('ldr')`)

## Key Files

**New Architecture:**
- `src/compiler/types.ts` - Core type definitions
- `src/compiler/SimpleCompiler.ts` - Validation compiler
- `src/engine/FlexibleEngine.ts` - Main engine orchestration
- `src/engine/FlexibleResourceManager.ts` - GPU resource management
- `src/engine/FlexibleRenderExecutor.ts` - Pipeline execution

**Test:**
- `examples/test-flexible-engine.ts` - End-to-end test
- `test-flexible-engine.html` - Test page with UI

**Original Engine (reference):**
- `src/engine/` - Original implementation (still in use by existing App)
