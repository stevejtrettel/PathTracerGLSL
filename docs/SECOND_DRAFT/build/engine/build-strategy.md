# Engine Implementation Strategy

## Overview

Building the Engine requires a careful balance: we need working GPU rendering immediately to validate our architecture, but we also need to build toward the full pipeline architecture. This document outlines a phased approach where each phase produces a working renderer while progressively implementing the full contract specifications.

## Core Principle: Always Render Something

Every phase must produce pixels on screen. This provides immediate validation and maintains developer momentum. We start with the simplest possible WebGL program and gradually introduce our architecture around it.

## Phase 1: Minimal Triangle Renderer
**Goal**: Get a colored triangle on screen with the basic Engine structure  
**Timeline**: 2-3 days

### Files Needed
```
engine/
  core/
    Engine.ts              // Minimal Engine class
    EngineTypes.ts        // Only essential types
  
  render/
    RenderExecutor.ts     // Triangle + draw call only
  
  shaders/
    minimal.vert.glsl     // Hardcoded vertex shader
    minimal.frag.glsl     // Hardcoded fragment shader
```

### Implementation Details

**Engine.ts** (Minimal)
```typescript
class Engine {
  private gl: WebGL2RenderingContext;
  private executor: RenderExecutor;
  private state: 'ready' | 'running' = 'ready';
  private program: WebGLProgram;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.executor = new RenderExecutor(gl);
    this.program = this.compileMinimalShader();
    gl.useProgram(this.program);
  }
  
  private compileMinimalShader(): WebGLProgram {
    // Direct compilation - no pipeline yet
    const vert = this.compileShader(MINIMAL_VERT, gl.VERTEX_SHADER);
    const frag = this.compileShader(MINIMAL_FRAG, gl.FRAGMENT_SHADER);
    return this.linkProgram(vert, frag);
  }
  
  renderFrame(): void {
    this.executor.renderFrame();
  }
}
```

**RenderExecutor.ts** (Minimal)
```typescript
class RenderExecutor {
  private triangleVAO: WebGLVertexArrayObject;
  
  constructor(gl: WebGL2RenderingContext) {
    this.setupGeometry();  // Just the triangle
  }
  
  renderFrame(): void {
    this.gl.bindVertexArray(this.triangleVAO);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    this.gl.bindVertexArray(null);
  }
}
```

**Shaders** (Hardcoded strings)
```glsl
// minimal.vert
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}

// minimal.frag  
void main() {
  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); // Magenta triangle
}
```

### Success Criteria
- [ ] Triangle renders on screen
- [ ] Basic Engine class structure exists
- [ ] RenderExecutor owns geometry
- [ ] Can call `engine.renderFrame()` repeatedly

## Phase 2: Uniform System & Parameter Flow
**Goal**: Add UniformBinder with real uniform updates  
**Timeline**: 2-3 days

### New Files
```
engine/
  uniforms/
    UniformBinder.ts      // Real implementation
    UniformMap.ts         // Parameter mapping
  
  shaders/
    basic.frag.glsl       // Uses uniforms
```

### Implementation Details

**UniformBinder.ts** (Essential features only)
```typescript
class UniformBinder {
  private pendingUpdates = new Map<string, any>();
  
  buildBindings(program: WebGLProgram): void {
    // Start with just engine uniforms
    this.uniformMap = new UniformMap();
    this.uniformMap.add('resolution', 'u_resolution', location);
    this.uniformMap.add('time', 'u_time', location);
  }
  
  frameUpdate(state: EngineStateInfo): void {
    // Update engine uniforms
    gl.uniform2f(this.uniformMap.get('resolution'), state.width, state.height);
    gl.uniform1f(this.uniformMap.get('time'), state.time);
    
    // Flush pending parameter updates
    for (const [path, value] of this.pendingUpdates) {
      // Apply uniform...
    }
  }
}
```

### Success Criteria
- [ ] Triangle color changes with time uniform
- [ ] Resolution uniform affects rendering
- [ ] Can update uniforms from outside Engine
- [ ] UniformMap tracks mappings

## Phase 3: Module System & Basic Compilation
**Goal**: Introduce modules and simple compilation (skip complex pipeline stages)  
**Timeline**: 3-4 days

### New Files
```
engine/
  registry/
    ModuleRegistry.ts     // Basic version
  
  compiler/
    ShaderCompiler.ts     // Simplified pipeline
    SimplePipeline.ts     // Just concatenation + main
  
  modules/
    TestModules.ts        // Hardcoded test modules
```

### Implementation Details

**SimplePipeline.ts** (Bypass complexity)
```typescript
class SimplePipeline {
  compile(recipe: Recipe): CompiledProgram {
    // Skip most stages for now:
    // 1. Collect modules
    const modules = this.collectModules(recipe);
    
    // 2. Concatenate sources (no prefixing yet!)
    const fragmentSource = this.concatenate(modules);
    
    // 3. Add simple main
    const main = 'void main() { gl_FragColor = vec4(1, 0, 0, 1); }';
    
    // 4. Compile
    return this.compileGLSL(VERTEX_SHADER, fragmentSource + main);
  }
}
```

**TestModules.ts**
```typescript
// Start with modules that don't need dependencies
const SimpleCamera: ModuleDescriptor = {
  id: { kind: 'camera', name: 'simple', version: '1.0' },
  fragment: {
    functions: 'Ray generate_ray(vec2 pixel) { return Ray(vec3(0), vec3(0,0,1)); }',
    provides: ['generate_ray']
  }
};
```

### Success Criteria
- [ ] Can register modules
- [ ] SimplePipeline produces working shaders
- [ ] At least one test recipe compiles
- [ ] Module functions are callable

## Phase 4: Resource Management
**Goal**: Add ResourceManager with texture/framebuffer support  
**Timeline**: 3-4 days

### New Files
```
engine/
  resources/
    ResourceManager.ts    // Film buffers, textures
    FilmManifest.ts      // Manifest system
```

### Implementation Details

**ResourceManager.ts** (Focus on film buffers)
```typescript
class ResourceManager {
  setupFilmBuffers(film: ModuleDescriptor): FilmResources {
    // Start with single buffer (no ping-pong yet)
    const texture = this.createTexture({
      width: this.viewport.width,
      height: this.viewport.height,
      format: TextureFormat.RGBA32F
    });
    
    const framebuffer = this.createFramebuffer([texture]);
    
    return { textures: [texture], framebuffer };
  }
}
```

### Success Criteria
- [ ] Can render to texture
- [ ] Film accumulation works
- [ ] Can read pixels back
- [ ] Basic capability checking works

## Phase 5: Full Compilation Pipeline
**Goal**: Implement all 8 pipeline stages  
**Timeline**: 5-7 days

### New Files
```
engine/
  compiler/
    stages/
      CollectModulesStage.ts
      ValidateDependenciesStage.ts
      SortModulesStage.ts
      ApplyPrefixesStage.ts
      ResolveCallsStage.ts
      GenerateMainStage.ts
      ExtractUniformsStage.ts
      CompileGLSLStage.ts
```

### Implementation Approach

Implement stages incrementally, testing after each:

1. **CollectModules + CompileGLSL**: Get basic flow working
2. **ApplyPrefixes**: Add prefixing, verify functions still work
3. **ValidateDependencies**: Ensure requires/provides match
4. **SortModules**: Dependency ordering
5. **ResolveCalls**: Cross-module function calls
6. **GenerateMain**: Template-based main generation
7. **ExtractUniforms**: Automatic uniform discovery

### Success Criteria
- [ ] All 8 stages execute
- [ ] Prefixing prevents naming conflicts
- [ ] Dependencies validated
- [ ] Cross-module calls work
- [ ] Line mapping accurate

## Phase 6: Production Features
**Goal**: Complete all contract requirements  
**Timeline**: 3-4 days

### Features to Add

1. **Eager Compilation**
    - Compile all recipes at startup
    - Cache programs
    - Instant switching

2. **Context Loss Handling**
    - Event listeners
    - State recovery
    - Recompilation

3. **Performance Monitoring**
    - Frame stats
    - Memory tracking
    - Update metrics

4. **Advanced Resource Management**
    - Double buffering
    - Manifest comparison
    - Capability fallbacks

5. **Debugging Tools**
    - Source inspection
    - Uniform map visualization
    - Pipeline execution logs

## Phase 7: Optimization & Polish
**Goal**: Performance and developer experience  
**Timeline**: 2-3 days

### Optimizations

1. **Uniform Batching**
    - Minimize WebGL calls
    - Change detection
    - Type-specific paths

2. **Resource Pooling**
    - Texture reuse
    - Framebuffer caching
    - Memory management

3. **Compilation Caching**
    - Source hashing
    - Persistent cache
    - Incremental compilation

4. **Developer Tools**
    - Better error messages
    - Visual debugging
    - Performance profiling

## Testing Strategy

### Phase-by-Phase Tests

**Phase 1**: Manual visual test (triangle appears)

**Phase 2**:
```typescript
test('uniforms update', () => {
  engine.updateUniform('time', 1.0);
  // Verify color changes
});
```

**Phase 3**:
```typescript
test('module registration', () => {
  registry.register(TestModule);
  expect(registry.get('camera', 'test')).toBeDefined();
});
```

**Phase 4**:
```typescript
test('render to texture', () => {
  const fb = resources.createFramebuffer();
  renderer.setRenderTarget(fb);
  renderer.renderFrame();
  const pixels = renderer.readPixels();
  expect(pixels).toBeDefined();
});
```

**Phase 5**: Test each pipeline stage individually

**Phase 6**: Integration tests with multiple recipes

**Phase 7**: Performance benchmarks

## Risk Mitigation

### Potential Issues & Solutions

1. **WebGL Context Issues**
    - Test on multiple browsers early
    - Have fallback for missing extensions
    - Clear error messages for unsupported features

2. **Pipeline Complexity**
    - Keep SimplePipeline as fallback
    - Test each stage in isolation
    - Extensive logging during development

3. **Performance Problems**
    - Profile early and often
    - Minimize string operations
    - Cache aggressively

4. **Module Compatibility**
    - Start with known-working modules
    - Validate provides/requires strictly
    - Clear error messages for mismatches

## Implementation Order Rationale

This order is designed to:

1. **Get pixels on screen immediately** (Phase 1)
2. **Establish data flow early** (Phase 2)
3. **Prove module concept works** (Phase 3)
4. **Add GPU complexity gradually** (Phase 4)
5. **Tackle hardest part with foundation in place** (Phase 5)
6. **Polish with working system** (Phases 6-7)

Each phase builds on the previous while maintaining a working renderer. This allows continuous testing and validation, reducing the risk of architectural issues discovered late.

## Definition of "Done"

The Engine is complete when:

1. All contracts are fulfilled
2. Multiple recipes compile and run
3. Recipe switching is instant
4. Error messages are actionable
5. Performance meets targets (60fps for simple scenes)
6. All subsystems properly integrated
7. Context loss handled gracefully
8. Developer tools functional

## Next Steps

1. Start with Phase 1 immediately
2. Create test harness alongside Phase 1
3. Build example recipes in parallel
4. Document deviations from contracts
5. Keep implementation notes for future maintainers

The key is maintaining momentum while building toward the full architecture. Each phase should take no more than a week, keeping the entire implementation to roughly one month of focused development.
