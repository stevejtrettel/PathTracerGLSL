# Phase Checklists

## Phase 1: Minimal Triangle Renderer
**Goal**: Colored triangle on screen with basic Engine structure  
**Success Metric**: Purple triangle visible, no WebGL errors

### Setup Tasks
- [ ] Create directory structure:
  ```
  src/engine/
    core/
      Engine.ts
      EngineTypes.ts
    render/
      RenderExecutor.ts
    shaders/
      minimal.vert
      minimal.frag
  ```

### Core Types (EngineTypes.ts)
- [ ] Define minimal `EngineState` type
- [ ] Define `Viewport` interface
- [ ] Define `FrameConfig` interface (just `clear` for now)
- [ ] Export `FULLSCREEN_TRIANGLE_VERTICES` constant

### RenderExecutor Implementation
- [ ] Create class with `gl: WebGL2RenderingContext`
- [ ] Implement `setupGeometry()`:
    - [ ] Create VAO
    - [ ] Create vertex buffer
    - [ ] Upload triangle vertices (-1,-1), (3,-1), (-1,3)
    - [ ] Set up position attribute at location 0
    - [ ] Unbind VAO
- [ ] Implement `renderFrame()`:
    - [ ] Bind VAO
    - [ ] Call `drawArrays(TRIANGLES, 0, 3)`
    - [ ] Unbind VAO
- [ ] Add `isInitialized()` getter
- [ ] Add `dispose()` method

### Engine Implementation
- [ ] Constructor:
    - [ ] Store `gl` context
    - [ ] Create `RenderExecutor`
    - [ ] Call `executor.setupGeometry()`
    - [ ] Compile minimal shaders
    - [ ] Link program
    - [ ] Use program
- [ ] Implement `compileShader()` helper
- [ ] Implement `linkProgram()` helper
- [ ] Implement `renderFrame()` → calls `executor.renderFrame()`
- [ ] Add `getState()` method
- [ ] Add `dispose()` method

### Minimal Shaders
- [ ] `minimal.vert`:
  ```glsl
  #version 300 es
  in vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
  ```
- [ ] `minimal.frag`:
  ```glsl
  #version 300 es
  precision highp float;
  out vec4 fragColor;
  void main() {
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
  }
  ```

### Validation
- [ ] Triangle renders (purple/magenta)
- [ ] No console errors
- [ ] Check with `gl.getError()` returns `NO_ERROR`
- [ ] `executor.isInitialized()` returns true
- [ ] Can call `renderFrame()` multiple times

### Test App
- [ ] Create `test/phase1.html`
- [ ] Create canvas element
- [ ] Get WebGL2 context
- [ ] Create Engine instance
- [ ] Call `renderFrame()` in loop
- [ ] Add FPS counter

---

## Phase 2: Uniform System & Parameter Flow
**Goal**: Working uniform updates with time-based animation  
**Success Metric**: Triangle color pulses with time

### New Files
- [ ] Create:
  ```
  src/engine/
    uniforms/
      UniformBinder.ts
      UniformMap.ts
    shaders/
      basic.vert
      basic.frag
  ```

### UniformMap Implementation
- [ ] Create `UniformMapping` interface
- [ ] Implement `UniformMap` class:
    - [ ] `mappings: Map<string, UniformMapping>`
    - [ ] `addMapping(paramPath, glslName, location, type)`
    - [ ] `getMapping(paramPath)`
    - [ ] `getAllMappings()`
    - [ ] `debugPrint()` method

### UniformBinder Implementation
- [ ] Constructor with `gl`
- [ ] Private `uniformMap: UniformMap | null`
- [ ] Private `pendingUpdates: Map<string, any>`
- [ ] `buildBindings(program)`:
    - [ ] Create new UniformMap
    - [ ] Get location for `u_resolution`
    - [ ] Get location for `u_time`
    - [ ] Add mappings to map
- [ ] `queueUpdate(path, value)`
- [ ] `frameUpdate(engineState)`:
    - [ ] Update `u_resolution`
    - [ ] Update `u_time`
    - [ ] Flush pending updates
    - [ ] Clear pending updates

### Update Engine
- [ ] Add `uniforms: UniformBinder` field
- [ ] Create UniformBinder in constructor
- [ ] After program compilation, call `uniforms.buildBindings(program)`
- [ ] Add `updateUniforms(changes)` method
- [ ] Modify `renderFrame()`:
    - [ ] Create `EngineStateInfo`
    - [ ] Call `uniforms.frameUpdate(state)`
    - [ ] Then call `executor.renderFrame()`

### Update Shaders
- [ ] `basic.frag`:
  ```glsl
  #version 300 es
  precision highp float;
  
  uniform vec2 u_resolution;
  uniform float u_time;
  
  out vec4 fragColor;
  
  void main() {
    float pulse = sin(u_time) * 0.5 + 0.5;
    fragColor = vec4(pulse, 0.0, 1.0 - pulse, 1.0);
  }
  ```

### Validation
- [ ] Triangle color changes over time
- [ ] Uniforms found (no null locations)
- [ ] `uniformMap.debugPrint()` shows mappings
- [ ] Can update custom uniforms via `queueUpdate`
- [ ] No WebGL errors

---

## Phase 3: Module System & Basic Compilation
**Goal**: Load and compile modular shaders  
**Success Metric**: Shader built from modules renders

### New Files
- [ ] Create:
  ```
  src/engine/
    registry/
      ModuleRegistry.ts
    compiler/
      ShaderCompiler.ts
      SimplePipeline.ts
    modules/
      test/
        TestCamera.ts
        TestEstimator.ts
        TestFilm.ts
        TestDeveloper.ts
  ```

### ModuleRegistry Implementation
- [ ] Private `modules: Map<string, ModuleDescriptor>`
- [ ] `register(module)`:
    - [ ] Basic validation (has id, kind, name)
    - [ ] Store in map
- [ ] `get(kind, name)`
- [ ] `has(kind, name)`
- [ ] `resolveModules(recipe)`:
    - [ ] Get all 8 modules
    - [ ] Return ModuleCollection

### Test Modules
- [ ] Create minimal valid modules:
  ```typescript
  // TestCamera.ts
  export const TestCamera: ModuleDescriptor = {
    id: { kind: 'camera', name: 'test', version: '1.0.0' },
    fragment: {
      functions: `
        Ray generate_ray(vec2 pixel, vec2 xi) {
          vec2 ndc = pixel / u_resolution * 2.0 - 1.0;
          return Ray(vec3(0), normalize(vec3(ndc, -1)));
        }
      `,
      provides: ['generate_ray']
    }
  };
  ```
- [ ] Similar for Estimator, Film, Developer
- [ ] Include required Geometry module

### SimplePipeline Implementation
- [ ] `compile(recipe)`:
    - [ ] Stage 1: Collect modules from recipe
    - [ ] Stage 2: Concatenate sources
    - [ ] Stage 3: Add hardcoded main
    - [ ] Stage 4: Compile with WebGL
    - [ ] Return CompiledProgram

### ShaderCompiler Implementation
- [ ] Constructor with `gl` and `registry`
- [ ] Private `pipeline: SimplePipeline`
- [ ] `compile(recipe)`:
    - [ ] Check recipe compatibility
    - [ ] Resolve modules
    - [ ] Run pipeline
    - [ ] Return program
- [ ] `initialize(recipes)`:
    - [ ] For each recipe, compile and store

### Update Engine
- [ ] Add `registry: ModuleRegistry`
- [ ] Add `compiler: ShaderCompiler`
- [ ] Register test modules in constructor
- [ ] Add `initialize(recipes)` method
- [ ] Add `selectRecipe(name)` method

### Validation
- [ ] Modules register successfully
- [ ] Recipe compiles without errors
- [ ] Concatenated shader is valid GLSL
- [ ] Rendered output (even if simple)
- [ ] Can switch between recipes

---

## Phase 4: Resource Management
**Goal**: Render to texture with accumulation  
**Success Metric**: Progressive accumulation visible

### New Files
- [ ] Create:
  ```
  src/engine/
    resources/
      ResourceManager.ts
      FilmManifest.ts
      TextureUtils.ts
  ```

### ResourceManager Implementation
- [ ] Constructor with `gl`
- [ ] `getCapabilities()`:
    - [ ] Check for float textures
    - [ ] Check max texture size
    - [ ] Return CapabilityReport
- [ ] `createTexture(spec)`:
    - [ ] Create WebGL texture
    - [ ] Set parameters
    - [ ] Return Texture object
- [ ] `createFramebuffer(attachments)`:
    - [ ] Create framebuffer
    - [ ] Attach textures
    - [ ] Check completeness
- [ ] `setupFilmBuffers(film)`:
    - [ ] Extract manifest
    - [ ] Create texture
    - [ ] Create framebuffer
    - [ ] Return FilmResources

### Update RenderExecutor
- [ ] Add `resources: ResourceManager` parameter
- [ ] Add `setRenderTarget(target)` method
- [ ] Add `readPixelsSync()` method
- [ ] Update `renderFrame()`:
    - [ ] Check render target
    - [ ] Bind framebuffer if needed

### Film Accumulation
- [ ] Update test Film module:
    - [ ] Add accumulation logic
    - [ ] Read from previous frame
- [ ] Add texture uniforms to shader

### Update Engine
- [ ] Add `resources: ResourceManager`
- [ ] Create ResourceManager before RenderExecutor
- [ ] When selecting recipe:
    - [ ] Call `resources.setupFilmBuffers(film)`

### Validation
- [ ] Capabilities report correct
- [ ] Can create float textures
- [ ] Framebuffer complete
- [ ] Accumulation increases brightness
- [ ] Can read pixels back

---

## Phase 5: Full Compilation Pipeline
**Goal**: All 8 stages working with prefixing  
**Success Metric**: Cross-module calls work with no conflicts

### New Files
- [ ] Create each stage file:
  ```
  src/engine/compiler/stages/
    CollectModulesStage.ts
    ValidateDependenciesStage.ts
    SortModulesStage.ts
    ApplyPrefixesStage.ts
    ResolveCallsStage.ts
    GenerateMainStage.ts
    ExtractUniformsStage.ts
    CompileGLSLStage.ts
  ```

### Stage Development Order

#### Week 1: Foundation Stages
- [ ] CollectModulesStage:
    - [ ] Transform recipe to module array
    - [ ] Validate all 8 present
- [ ] CompileGLSLStage:
    - [ ] Compile vertex shader
    - [ ] Compile fragment shader
    - [ ] Link program
    - [ ] Build UniformMap

#### Week 2: Prefixing System
- [ ] ApplyPrefixesStage:
    - [ ] Apply prefix to functions
    - [ ] Apply prefix to uniforms
    - [ ] Build functionMap
- [ ] Test with real modules
- [ ] Verify no conflicts

#### Week 3: Dependencies
- [ ] ValidateDependenciesStage:
    - [ ] Check all requires satisfied
    - [ ] Detect duplicates
    - [ ] Find cycles
- [ ] SortModulesStage:
    - [ ] Geometry first
    - [ ] Topological sort
- [ ] ResolveCallsStage:
    - [ ] Map calls to prefixed names

#### Week 4: Polish
- [ ] GenerateMainStage:
    - [ ] Template selection
    - [ ] Function replacement
- [ ] ExtractUniformsStage:
    - [ ] Build uniform list
    - [ ] Create line mappings

### StandardCompilationPipeline
- [ ] Array of all 8 stages
- [ ] `execute()` method:
    - [ ] Run each stage
    - [ ] Validate output
    - [ ] Store in context
    - [ ] Handle errors

### Validation
- [ ] Each stage validates correctly
- [ ] Pipeline completes successfully
- [ ] Prefixed functions callable
- [ ] No naming conflicts
- [ ] Line mapping accurate

---

## Phase 6: Production Features
**Goal**: Complete contract compliance  
**Success Metric**: All contract requirements met

### Eager Compilation
- [ ] Compile all recipes at startup
- [ ] Store in Map
- [ ] Measure compilation time
- [ ] Log results

### Context Loss Handling
- [ ] Add event listeners
- [ ] Implement `handleContextLoss()`
- [ ] Implement `handleContextRestore()`
- [ ] Test with extension

### Performance Monitoring
- [ ] Add FrameStats to RenderExecutor
- [ ] Add UpdateStats to UniformBinder
- [ ] Add MemoryStats to ResourceManager
- [ ] Implement `getPerformanceReport()`

### State Machine
- [ ] Implement proper state transitions
- [ ] Validate transitions
- [ ] Add state guards to methods

### Error Handling
- [ ] Custom error classes
- [ ] Error propagation
- [ ] Recovery strategies
- [ ] User-friendly messages

### Validation
- [ ] Instant recipe switching
- [ ] Context loss recovery works
- [ ] Performance stats accurate
- [ ] State transitions validated
- [ ] Errors have context

---

## Phase 7: Optimization & Polish
**Goal**: Production-ready performance  
**Success Metric**: 60fps sustained, great DX

### Performance
- [ ] Profile with Chrome DevTools
- [ ] Optimize uniform updates
- [ ] Minimize string operations
- [ ] Add dirty flags

### Developer Experience
- [ ] Better error messages
- [ ] Source map support
- [ ] Debug visualization mode
- [ ] Pipeline stage timing

### Testing
- [ ] Unit tests for each subsystem
- [ ] Integration tests
- [ ] Performance benchmarks
- [ ] Cross-browser testing

### Documentation
- [ ] API documentation
- [ ] Example recipes
- [ ] Common patterns
- [ ] Troubleshooting guide

---
