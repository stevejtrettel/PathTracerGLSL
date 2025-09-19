You're absolutely right - I should be writing implementation guides, not just code dumps. Let me restart with a proper human-readable implementation guide.

# Engine Implementation Guide - Uniform Binder

## Overview

The UniformBinder is the bridge between your parameter system and GPU uniforms. It needs to handle three critical responsibilities:
1. Build explicit mappings from parameter paths to GPU uniform locations
2. Batch parameter updates during the frame (don't apply immediately)
3. Flush all updates at once before rendering

## Core Data Structures

### The UniformMap - Your Debugging Lifeline

The UniformMap is the heart of the system. It's an explicit, queryable record of every parameter-to-uniform mapping. When debugging "why isn't my parameter updating?", this is where you look.

```typescript
class UniformMap {
  // Store mappings by parameter path for O(1) lookup
  private mappings = new Map<string, UniformMapping>();
  
  // Each mapping contains everything you need to debug
  // - paramPath: what the user sets ("camera.position")
  // - glslName: what it becomes in the shader ("u_camera_pinhole_position")
  // - location: WebGL uniform location (null if optimized out)
  // - type: so you know which gl.uniform* function to call
  // - moduleSource: which module defined this (for debugging)
  // - used/updateCount: performance tracking
}
```

### The UniformBinder Class

```typescript
class UniformBinder {
  private gl: WebGL2RenderingContext;
  private uniformMap: UniformMap;
  private pendingChanges = new Map<string, any>();  // Batched updates
  private stats: UpdateStats;  // Performance monitoring
  
  // The binder needs to track texture units for samplers
  private textureBindings = new Map<string, number>();
  
  // Remember: film textures get units 0-7, materials get 8-15
  private readonly FILM_TEXTURE_START = 0;
  private readonly MATERIAL_TEXTURE_START = 8;
}
```

## Building the Bindings

When a program is compiled, you need to build the UniformMap. This happens once per program switch, not every frame.

```typescript
buildBindings(program: CompiledProgram, modules: ModuleDescriptor[]): void {
  // Step 1: Create a fresh UniformMap
  const mappings = new Map<string, UniformMapping>();
  
  // Step 2: Process each module's parameters
  // Remember the prefixing pattern:
  // - Module kind determines prefix (camera → c_)
  // - Full pattern: u_[prefix][module_name]_[param_name]
  
  for (const module of modules) {
    const prefix = this.getModulePrefix(module.id.kind);
    
    for (const param of module.parameters || []) {
      // Build the parameter path that users will use
      const paramPath = `${module.id.kind}.${param.name}`;
      // Example: "camera.position"
      
      // Build the GLSL uniform name
      const glslName = `u_${prefix}${module.id.name.toLowerCase()}_${param.name}`;
      // Example: "u_camera_pinhole_position"
      
      // Get the WebGL location
      // IMPORTANT: This can be null if the uniform was optimized out!
      const location = this.gl.getUniformLocation(program.program, glslName);
      
      // Store the mapping
      mappings.set(paramPath, {
        paramPath,
        glslName,
        location,  // Might be null!
        type: param.type as UniformType,
        moduleSource: module.id.name,
        used: false,
        updateCount: 0
      });
    }
  }
  
  // Step 3: Add engine uniforms (always present)
  this.addEngineUniforms(mappings, program.program);
  
  // Step 4: Add film texture samplers
  this.addFilmTextureSamplers(mappings, program.program);
  
  // Step 5: Store the complete map
  this.uniformMap = new UniformMap(mappings);
}
```

### Handling Engine Uniforms

Engine uniforms are special - they're always present and always updated:

```typescript
private addEngineUniforms(mappings: Map<string, UniformMapping>, program: WebGLProgram): void {
  // These five uniforms are ALWAYS available in every shader
  const engineUniforms = [
    { path: 'engine.resolution', glsl: 'u_resolution', type: 'vec2' },
    { path: 'engine.frame_index', glsl: 'u_frame_index', type: 'int' },
    { path: 'engine.sample_count', glsl: 'u_sample_count', type: 'int' },
    { path: 'engine.film_reset', glsl: 'u_film_reset', type: 'bool' },
    { path: 'engine.time', glsl: 'u_time', type: 'float' }
  ];
  
  // Add each one to the map
  // Note: These should ALWAYS have valid locations unless something is very wrong
}
```

## The Update Queue System

The key insight: DON'T update uniforms immediately when parameters change. Queue them up and flush once per frame.

```typescript
queueUpdate(paramPath: string, value: any): void {
  // Step 1: Check if we even have a binding for this parameter
  const binding = this.uniformMap.getMapping(paramPath);
  
  if (!binding) {
    // This might be OK! Some parameters only exist in certain variants
    this.handleMissingBinding(paramPath);
    return;
  }
  
  if (!binding.location) {
    // The uniform exists but was optimized out by the GPU driver
    // This is fine - just track it for statistics
    this.stats.skippedUpdates++;
    return;
  }
  
  // Step 2: Check for redundant updates
  if (binding.lastValue === value) {
    this.stats.redundantUpdates++;
    return;  // Don't queue the same value again
  }
  
  // Step 3: Queue the update (overwrites any previous queued value)
  this.pendingChanges.set(paramPath, value);
}
```

## Frame Update - The Big Flush

This is called once per frame, right before rendering. It applies ALL queued updates in one batch.

```typescript
frameUpdate(engineState: EngineStateInfo): void {
  const startTime = performance.now();
  
  // Step 1: ALWAYS update engine uniforms (even if nothing else changed)
  this.updateEngineUniforms(engineState);
  
  // Step 2: Process the queue
  for (const [paramPath, value] of this.pendingChanges) {
    const binding = this.uniformMap.getMapping(paramPath);
    
    if (!binding || !binding.location) {
      continue;  // Already validated in queueUpdate
    }
    
    // Step 3: Apply the uniform based on type
    this.applyUniform(binding, value);
    
    // Step 4: Track statistics
    binding.used = true;
    binding.updateCount++;
    binding.lastValue = value;
    this.stats.frameUpdates++;
  }
  
  // Step 5: Clear the queue for next frame
  this.pendingChanges.clear();
  
  // Step 6: Update performance stats
  const elapsed = performance.now() - startTime;
  this.updateStats(elapsed);
}
```

### Applying Uniforms by Type

Each uniform type needs a different WebGL call:

```typescript
private applyUniform(binding: UniformMapping, value: any): void {
  // The location is guaranteed to be non-null here
  const location = binding.location!;
  
  switch (binding.type) {
    case 'float':
      this.gl.uniform1f(location, value);
      break;
      
    case 'vec2':
      // Value should be [x, y]
      this.gl.uniform2fv(location, value);
      break;
      
    case 'vec3':
      // Value should be [x, y, z]
      this.gl.uniform3fv(location, value);
      break;
      
    case 'vec4':
      // Value should be [x, y, z, w]
      this.gl.uniform4fv(location, value);
      break;
      
    case 'int':
      this.gl.uniform1i(location, value);
      break;
      
    case 'bool':
      // Booleans are integers in GLSL (0 or 1)
      this.gl.uniform1i(location, value ? 1 : 0);
      break;
      
    case 'mat3':
      // Value should be 9-element array in column-major order
      this.gl.uniformMatrix3fv(location, false, value);
      break;
      
    case 'mat4':
      // Value should be 16-element array in column-major order
      this.gl.uniformMatrix4fv(location, false, value);
      break;
      
    case 'sampler2D':
      // Value is a texture unit number
      this.gl.uniform1i(location, value);
      break;
      
    default:
      console.warn(`Unknown uniform type: ${binding.type}`);
  }
}
```

## Texture Binding Management

Samplers need special handling - they bind to texture units, not values:

```typescript
bindTexture(samplerPath: string, textureUnit: number): void {
  // Remember which unit each sampler uses
  this.textureBindings.set(samplerPath, textureUnit);
  
  // Queue the update like any other uniform
  // The value for a sampler is its texture unit number
  this.queueUpdate(samplerPath, textureUnit);
}

private setupFilmTextures(): void {
  // Film textures ALWAYS use units 0-7
  // This is a convention we enforce everywhere
  
  // Example bindings:
  // u_film_radiance → unit 0
  // u_film_variance → unit 1
  // u_film_auxiliary → unit 2
  
  for (let i = 0; i < filmTextures.length; i++) {
    const unit = this.FILM_TEXTURE_START + i;
    this.bindTexture(`film.${textureName}`, unit);
  }
}
```

## Debugging Features

### Missing Binding Helper

When a parameter has no binding, help the developer figure out why:

```typescript
private handleMissingBinding(paramPath: string): void {
  // Step 1: Check if it's an optional parameter
  const optionalParams = [
    'material.emission',      // Only for emissive materials
    'film.variance_threshold', // Only for variance-tracking films
    'developer.debug_mode',    // Only for debug developer
  ];
  
  if (optionalParams.some(p => paramPath.includes(p))) {
    // This is expected - just skip silently
    return;
  }
  
  // Step 2: Log a helpful warning
  console.warn(`No uniform binding for parameter: ${paramPath}`);
  
  // Step 3: Suggest similar parameters
  const suggestions = this.findSimilarBindings(paramPath);
  if (suggestions.length > 0) {
    console.warn(`Did you mean: ${suggestions.join(', ')}?`);
  }
  
  // Step 4: Show what IS available in this category
  const category = paramPath.split('.')[0];
  const available = this.uniformMap.getAllMappings()
    .filter(m => m.paramPath.startsWith(category))
    .map(m => m.paramPath);
  
  if (available.length > 0) {
    console.log(`Available ${category} parameters:`, available);
  }
  
  // Step 5: Track for statistics
  this.stats.missingBindings++;
}
```

### Debug Print Function

Make the mappings visible for debugging:

```typescript
debugPrint(): void {
  console.log('=== Uniform Bindings ===');
  console.log(`Total mappings: ${this.uniformMap.size}`);
  
  // Group by module for readability
  const byModule = new Map<string, UniformMapping[]>();
  
  for (const mapping of this.uniformMap.getAllMappings()) {
    const module = mapping.moduleSource;
    if (!byModule.has(module)) {
      byModule.set(module, []);
    }
    byModule.get(module)!.push(mapping);
  }
  
  // Print each module's mappings
  for (const [module, mappings] of byModule) {
    console.log(`\n${module}:`);
    for (const m of mappings) {
      const status = m.location ? '✓' : '✗ (optimized out)';
      const used = m.used ? `(used ${m.updateCount}x)` : '(never used)';
      console.log(`  ${status} ${m.paramPath} → ${m.glslName} ${used}`);
    }
  }
  
  // Print statistics
  console.log('\n=== Statistics ===');
  console.log(`Updates this frame: ${this.stats.frameUpdates}`);
  console.log(`Skipped (optimized): ${this.stats.skippedUpdates}`);
  console.log(`Redundant (same value): ${this.stats.redundantUpdates}`);
  console.log(`Missing bindings: ${this.stats.missingBindings}`);
}
```

## Performance Tracking

Track performance to identify bottlenecks:

```typescript
private updateStats(frameTime: number): void {
  // Exponential moving average for smooth stats
  const alpha = 0.1;
  this.stats.averageUpdateTime = 
    this.stats.averageUpdateTime * (1 - alpha) + frameTime * alpha;
  
  // Track worst case
  this.stats.maxUpdateTime = Math.max(this.stats.maxUpdateTime, frameTime);
  
  // Track queue size
  const queueSize = this.pendingChanges.size;
  this.stats.maxQueueSize = Math.max(this.stats.maxQueueSize, queueSize);
  this.stats.averageQueueSize = 
    this.stats.averageQueueSize * (1 - alpha) + queueSize * alpha;
  
  // Warn if taking too long
  if (frameTime > 1.0) {
    console.warn(`Uniform updates took ${frameTime.toFixed(2)}ms`);
  }
}
```

## Key Implementation Points

1. **Build bindings once per program switch**, not every frame
2. **Queue updates during the frame**, flush once before render
3. **Engine uniforms are special** - always update them
4. **Texture units are reserved**: 0-7 for film, 8-15 for materials
5. **Handle null locations gracefully** - uniforms can be optimized out
6. **Track statistics** for performance monitoring
7. **Provide debugging tools** - missing bindings are common errors

## Common Pitfalls to Avoid

- Don't update uniforms immediately when parameters change
- Don't forget to clear the queue after flushing
- Don't assume uniform locations are always valid
- Don't mix up texture unit reservations
- Don't apply redundant updates (check last value)
- Don't silently fail on missing bindings (help debug)

Now let me write the RenderExecutor implementation guide...

# Engine Implementation Guide - Render Executor

## Overview

The RenderExecutor is responsible for the actual WebGL draw calls. It manages:
1. The full-screen triangle geometry (3 vertices, not a quad!)
2. Viewport and render target configuration
3. The single draw call per frame
4. Pixel readback (async and sync)
5. WebGL state management

## Core Architecture

### The Full-Screen Triangle Trick

Instead of rendering a quad (6 vertices, 2 triangles), we use a single triangle that extends beyond the viewport. This is more efficient and avoids a diagonal seam.

```typescript
class RenderExecutor {
  private gl: WebGL2RenderingContext;
  private triangleVAO: WebGLVertexArrayObject;
  
  // The triangle vertices:
  // v0: (-1, -1)  bottom-left of viewport
  // v1: ( 3, -1)  extends way past right edge
  // v2: (-1,  3)  extends way past top edge
  // This covers the entire viewport with one triangle!
  
  private viewport: Viewport = { x: 0, y: 0, width: 1920, height: 1080 };
  private frameStats: FrameStats;
}
```

## Geometry Setup

This happens once at initialization:

```typescript
setupGeometry(): void {
  // Step 1: Create the VAO (Vertex Array Object)
  // This bundles all the vertex state together
  this.triangleVAO = this.gl.createVertexArray();
  if (!this.triangleVAO) {
    throw new Error('Failed to create VAO');
  }
  
  this.gl.bindVertexArray(this.triangleVAO);
  
  // Step 2: Create the vertex buffer
  const vertices = new Float32Array([
    -1, -1,  // Bottom-left corner
     3, -1,  // Way off to the right
    -1,  3   // Way off to the top
  ]);
  
  const vbo = this.gl.createBuffer();
  this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
  this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
  
  // Step 3: Set up the position attribute
  // We assume position is always at location 0
  const positionLoc = 0;
  this.gl.enableVertexAttribArray(positionLoc);
  this.gl.vertexAttribPointer(
    positionLoc,
    2,              // 2 components (x, y)
    this.gl.FLOAT,  // 32-bit floats
    false,          // Don't normalize
    0,              // Stride (tightly packed)
    0               // Offset
  );
  
  // Step 4: Unbind the VAO (important!)
  // We only bind it when drawing
  this.gl.bindVertexArray(null);
}
```

## Initialization

Set up WebGL state for path tracing:

```typescript
initialize(): void {
  // Path tracing doesn't need most WebGL features
  // Turn them OFF for clarity and performance
  
  // We don't need depth testing (single full-screen triangle)
  this.gl.disable(this.gl.DEPTH_TEST);
  
  // We don't cull faces (single triangle)
  this.gl.disable(this.gl.CULL_FACE);
  
  // We don't blend (accumulation happens in shader)
  this.gl.disable(this.gl.BLEND);
  
  // We don't use the stencil buffer
  this.gl.disable(this.gl.STENCIL_TEST);
  
  // Set pixel packing alignment for readback
  this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
  this.gl.pixelStorei(this.gl.PACK_ALIGNMENT, 1);
  
  // Check for required extensions
  const colorBufferFloat = this.gl.getExtension('EXT_color_buffer_float');
  if (!colorBufferFloat) {
    console.warn('Float color buffers not available - HDR rendering disabled');
    // The ResourceManager should have caught this earlier
  }
  
  // Optional: Get texture float linear filtering
  this.gl.getExtension('OES_texture_float_linear');
  
  // Set up context loss handlers
  this.setupContextLossHandlers();
}
```

## The Render Frame Function

This is the core function - it draws one frame:

```typescript
renderFrame(config?: FrameConfig): void {
  // Default config
  config = config || {
    clear: false,
    swapBuffers: true,
    viewport: this.viewport
  };
  
  // Step 1: Save state if we're changing things temporarily
  let savedState: RenderState | null = null;
  if (config.viewport || config.target) {
    savedState = this.saveState();
  }
  
  try {
    // Step 2: Set render target
    if (config.target) {
      this.setRenderTarget(config.target);
    }
    
    // Step 3: Set viewport
    if (config.viewport) {
      this.setViewport(
        config.viewport.x,
        config.viewport.y,
        config.viewport.width,
        config.viewport.height
      );
    }
    
    // Step 4: Clear if requested (usually only first frame)
    if (config.clear) {
      const color = config.clearColor || [0, 0, 0, 0];
      this.gl.clearColor(color[0], color[1], color[2], color[3]);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    
    // Step 5: Bind our triangle VAO
    this.gl.bindVertexArray(this.triangleVAO);
    
    // Step 6: THE ACTUAL DRAW CALL
    // Just 3 vertices for our full-screen triangle!
    this.gl.drawArrays(
      this.gl.TRIANGLES,  // Primitive type
      0,                  // Start index
      3                   // Count (just 3 vertices!)
    );
    
    // Step 7: Unbind VAO
    this.gl.bindVertexArray(null);
    
    // Step 8: Tell ResourceManager to swap buffers if using ping-pong
    if (config.swapBuffers) {
      // This is handled by ResourceManager.finalizeFrame()
      // We just set a flag here
    }
    
    // Step 9: Update frame statistics
    this.updateFrameStats();
    
  } finally {
    // Step 10: Restore state if we saved it
    if (savedState) {
      this.restoreState(savedState);
    }
  }
  
  // Check for errors in development
  if (DEBUG) {
    this.checkGLError('renderFrame');
  }
}
```

## Viewport Management

Simple viewport control:

```typescript
setViewport(x: number, y: number, width: number, height: number): void {
  // Validate dimensions
  width = Math.max(1, width);
  height = Math.max(1, height);
  
  // Store for queries
  this.viewport = { x, y, width, height };
  
  // Apply to WebGL
  this.gl.viewport(x, y, width, height);
}

getViewport(): Viewport {
  return { ...this.viewport };  // Return copy
}

resetViewport(): void {
  // Reset to full canvas
  const canvas = this.gl.canvas as HTMLCanvasElement;
  this.setViewport(0, 0, canvas.width, canvas.height);
}
```

## Render Target Management

Control where we're rendering:

```typescript
setRenderTarget(target: RenderTarget): void {
  switch (target.type) {
    case 'screen':
      // Render to screen (default framebuffer)
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      break;
      
    case 'framebuffer':
      // Render to a specific framebuffer
      // The ResourceManager owns the actual framebuffer objects
      // We just bind by ID
      this.bindFramebufferById(target.id);
      break;
      
    case 'mrt':
      // Multiple render targets
      // Bind framebuffer and set up draw buffers
      this.bindFramebufferById(target.framebufferId);
      
      // Tell WebGL which color attachments to draw to
      const drawBuffers = target.attachments.map(i => 
        this.gl.COLOR_ATTACHMENT0 + i
      );
      this.gl.drawBuffers(drawBuffers);
      break;
  }
}
```

## Pixel Readback

### Asynchronous Readback (Non-Blocking)

This is the preferred method - it doesn't stall the GPU:

```typescript
async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
  // Step 1: Default to full viewport
  const r = rect || this.getFullViewport();
  
  // Step 2: Validate rectangle
  this.validateRectangle(r);
  
  // Step 3: Allocate buffer for pixels
  const pixelCount = r.width * r.height * 4;  // RGBA
  const pixels = new Float32Array(pixelCount);
  
  // Step 4: Start the readback
  this.gl.readPixels(
    r.x, r.y,
    r.width, r.height,
    this.gl.RGBA,       // Format
    this.gl.FLOAT,      // Type (HDR!)
    pixels              // Destination
  );
  
  // Step 5: Insert a fence sync object
  // This lets us know when the GPU is done
  const sync = this.gl.fenceSync(
    this.gl.SYNC_GPU_COMMANDS_COMPLETE, 
    0
  );
  
  // Step 6: Flush to ensure commands are submitted
  this.gl.flush();
  
  // Step 7: Return a promise that polls the fence
  return new Promise<Float32Array>((resolve, reject) => {
    const checkSync = () => {
      // Check if GPU is done (non-blocking)
      const status = this.gl.clientWaitSync(
        sync,
        0,      // No flags
        0       // Don't wait at all
      );
      
      if (status === this.gl.ALREADY_SIGNALED || 
          status === this.gl.CONDITION_SATISFIED) {
        // GPU is done!
        this.gl.deleteSync(sync);
        resolve(pixels);
      } else if (status === this.gl.WAIT_FAILED) {
        // Something went wrong
        this.gl.deleteSync(sync);
        reject(new Error('Sync wait failed'));
      } else {
        // Still waiting - check again next frame
        requestAnimationFrame(checkSync);
      }
    };
    
    // Start checking
    checkSync();
  });
}
```

### Synchronous Readback (Blocking)

Sometimes you need pixels immediately:

```typescript
readPixelsSync(rect?: Rectangle): Float32Array {
  // WARNING: This blocks the GPU pipeline!
  // Only use when absolutely necessary
  
  const r = rect || this.getFullViewport();
  this.validateRectangle(r);
  
  const pixels = new Float32Array(r.width * r.height * 4);
  
  // This call blocks until pixels are ready
  this.gl.readPixels(
    r.x, r.y,
    r.width, r.height,
    this.gl.RGBA,
    this.gl.FLOAT,
    pixels
  );
  
  return pixels;
}
```

## State Management

Save and restore WebGL state:

```typescript
saveState(): RenderState {
  // Capture current WebGL state
  return {
    viewport: { ...this.viewport },
    framebuffer: this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING),
    program: this.gl.getParameter(this.gl.CURRENT_PROGRAM),
    vao: this.gl.getParameter(this.gl.VERTEX_ARRAY_BINDING),
    
    clearColor: this.gl.getParameter(this.gl.COLOR_CLEAR_VALUE),
    clearDepth: this.gl.getParameter(this.gl.DEPTH_CLEAR_VALUE),
    clearStencil: this.gl.getParameter(this.gl.STENCIL_CLEAR_VALUE),
    
    features: {
      blend: this.gl.isEnabled(this.gl.BLEND),
      cullFace: this.gl.isEnabled(this.gl.CULL_FACE),
      depthTest: this.gl.isEnabled(this.gl.DEPTH_TEST),
      scissorTest: this.gl.isEnabled(this.gl.SCISSOR_TEST),
      stencilTest: this.gl.isEnabled(this.gl.STENCIL_TEST)
    }
  };
}

restoreState(state: RenderState): void {
  // Restore everything we saved
  
  // Viewport
  this.setViewport(
    state.viewport.x,
    state.viewport.y,
    state.viewport.width,
    state.viewport.height
  );
  
  // Bindings
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, state.framebuffer);
  this.gl.useProgram(state.program);
  this.gl.bindVertexArray(state.vao);
  
  // Clear values
  this.gl.clearColor(...state.clearColor);
  this.gl.clearDepth(state.clearDepth);
  this.gl.clearStencil(state.clearStencil);
  
  // Features
  this.setFeatureEnabled(this.gl.BLEND, state.features.blend);
  this.setFeatureEnabled(this.gl.CULL_FACE, state.features.cullFace);
  this.setFeatureEnabled(this.gl.DEPTH_TEST, state.features.depthTest);
  this.setFeatureEnabled(this.gl.SCISSOR_TEST, state.features.scissorTest);
  this.setFeatureEnabled(this.gl.STENCIL_TEST, state.features.stencilTest);
}
```

## Performance Monitoring

Track frame timing and statistics:

```typescript
private updateFrameStats(): void {
  const now = performance.now();
  
  // Calculate frame time
  if (this.frameStats.lastFrameTimestamp > 0) {
    const frameTime = now - this.frameStats.lastFrameTimestamp;
    
    // Update stats
    this.frameStats.frameTime = frameTime;
    this.frameStats.frameNumber++;
    
    // Update moving average (last 60 frames)
    this.frameHistory.push(frameTime);
    if (this.frameHistory.length > 60) {
      this.frameHistory.shift();
    }
    
    const sum = this.frameHistory.reduce((a, b) => a + b, 0);
    this.frameStats.averageFrameTime = sum / this.frameHistory.length;
    this.frameStats.fps = 1000 / this.frameStats.averageFrameTime;
    
    // Track min/max
    this.frameStats.minFrameTime = Math.min(
      this.frameStats.minFrameTime, 
      frameTime
    );
    this.frameStats.maxFrameTime = Math.max(
      this.frameStats.maxFrameTime,
      frameTime
    );
  }
  
  this.frameStats.lastFrameTimestamp = now;
  
  // We always have exactly 1 draw call and 1 triangle
  this.frameStats.drawCalls = 1;
  this.frameStats.triangles = 1;
}

getFrameStats(): FrameStats {
  return { ...this.frameStats };
}
```

## Context Loss Handling

WebGL contexts can be lost (GPU reset, too many contexts, etc.):

```typescript
private setupContextLossHandlers(): void {
  const canvas = this.gl.canvas as HTMLCanvasElement;
  
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();  // Allow restoration
    this.handleContextLost();
  });
  
  canvas.addEventListener('webglcontextrestored', () => {
    this.handleContextRestored();
  });
}

handleContextLost(): void {
  console.error('WebGL context lost!');
  
  // Stop all rendering
  this.contextLost = true;
  
  // Clear all WebGL resources (they're invalid now)
  this.triangleVAO = null;
  
  // Notify Engine
  // The Engine should transition to error state
}

handleContextRestored(): void {
  console.log('WebGL context restored');
  
  // Recreate all resources
  this.setupGeometry();
  this.initialize();
  
  // Reset state
  this.contextLost = false;
  
  // Notify Engine
  // The Engine needs to recompile shaders, recreate resources, etc.
}

checkContextLost(): boolean {
  return this.gl.isContextLost();
}
```

## Error Checking

Check for WebGL errors (only in development!):

```typescript
private checkGLError(operation: string): void {
  // Don't check in production - it's slow
  if (!DEBUG) return;
  
  // Get the last error
  const error = this.gl.getError();
  
  if (error !== this.gl.NO_ERROR) {
    const errorString = this.getErrorString(error);
    console.error(`WebGL error in ${operation}: ${errorString}`);
    
    // Could throw here if you want to catch errors early
    // throw new Error(`WebGL error: ${errorString}`);
  }
}

private getErrorString(error: GLenum): string {
  switch (error) {
    case this.gl.INVALID_ENUM: 
      return 'INVALID_ENUM - Invalid constant';
    case this.gl.INVALID_VALUE:
      return 'INVALID_VALUE - Numeric argument out of range';
    case this.gl.INVALID_OPERATION:
      return 'INVALID_OPERATION - Operation illegal in current state';
    case this.gl.OUT_OF_MEMORY:
      return 'OUT_OF_MEMORY - Not enough memory';
    case this.gl.INVALID_FRAMEBUFFER_OPERATION:
      return 'INVALID_FRAMEBUFFER_OPERATION - Framebuffer is incomplete';
    default:
      return `Unknown error: 0x${error.toString(16)}`;
  }
}
```

## Key Implementation Points

1. **Use a single triangle** for full-screen coverage (3 vertices, not 6)
2. **VAO is only bound during drawing** - unbind it afterwards
3. **Most WebGL features are OFF** - we don't need them for path tracing
4. **Async readback is preferred** - use fence sync to avoid stalling
5. **Save/restore state** when temporarily changing settings
6. **Track performance** - frame time is critical
7. **Handle context loss** - it can happen, especially on mobile

## Common Pitfalls to Avoid

- Don't use a quad (6 vertices) - use the triangle trick
- Don't leave the VAO bound after drawing
- Don't forget to clear on the first frame
- Don't use sync readback unless necessary
- Don't ignore context loss events
- Don't check for errors in production (it's slow)
- Don't assume viewport matches canvas size
