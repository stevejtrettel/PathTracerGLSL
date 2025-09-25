# Render Executor Contract

## Purpose

The RenderExecutor handles WebGL draw calls, viewport configuration, and pixel readback. It manages the full-screen quad geometry, coordinates render state, and provides both synchronous and asynchronous pixel reading capabilities.

## Required Interface

```typescript
interface RenderExecutor {
  // Initialization
  constructor(gl: WebGL2RenderingContext, resources: ResourceManager);
  setupGeometry(): void;
  isInitialized(): boolean;
  
  // Frame rendering
  renderFrame(config?: FrameConfig): void;
  clear(config?: ClearConfig): void;
  
  // Viewport management
  setViewport(x: number, y: number, width: number, height: number): void;
  getViewport(): Viewport;
  pushViewport(viewport: Viewport): void;
  popViewport(): void;
  
  // Render target control
  setRenderTarget(target: RenderTarget): void;
  getRenderTarget(): RenderTarget;
  
  // Pixel readback
  readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;
  readPixelsSync(rect?: Rectangle): Float32Array;
  canReadPixels(): boolean;
  
  // State management
  saveState(): RenderState;
  restoreState(state: RenderState): void;
  resetState(): void;
  
  // WebGL state control
  setFeature(feature: GLenum, enabled: boolean): void;
  isFeatureEnabled(feature: GLenum): boolean;
  
  // Performance
  getFrameStats(): FrameStats;
  resetFrameStats(): void;
  getLastFrameTime(): number;
  
  // Context loss handling
  handleContextLoss(): void;
  
  // Cleanup
  dispose(): void;
}
```

## Architecture

```typescript
class RenderExecutor {
  private gl: WebGL2RenderingContext;
  private resources: ResourceManager;
  
  // Geometry
  private quadVAO: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private initialized: boolean = false;
  
  // State
  private viewport: Viewport;
  private viewportStack: Viewport[] = [];
  private currentTarget: RenderTarget = { type: "screen" };
  
  // Performance
  private frameStats: FrameStats;
  private frameHistory: number[] = [];
  private startTime: number;
  
  // Constants
  private readonly QUAD_VERTICES = new Float32Array([
    -1, -1,  // Bottom-left
     1, -1,  // Bottom-right  
    -1,  1,  // Top-left
     1, -1,  // Bottom-right (repeated)
     1,  1,  // Top-right
    -1,  1   // Top-left (repeated)
  ]);
}
```

## Geometry Setup Contract

The executor uses a full-screen quad (two triangles, 6 vertices):

```typescript
setupGeometry(): void {
  if (this.initialized) {
    console.warn('Geometry already initialized');
    return;
  }
  
  // Create VAO
  this.quadVAO = this.gl.createVertexArray();
  if (!this.quadVAO) {
    throw new Error('Failed to create vertex array');
  }
  
  this.gl.bindVertexArray(this.quadVAO);
  
  // Create vertex buffer  
  this.vertexBuffer = this.gl.createBuffer();
  if (!this.vertexBuffer) {
    throw new Error('Failed to create vertex buffer');
  }
  
  this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
  this.gl.bufferData(
    this.gl.ARRAY_BUFFER,
    this.QUAD_VERTICES,
    this.gl.STATIC_DRAW
  );
  
  // Setup position attribute (location 0)
  const positionLoc = 0;
  this.gl.enableVertexAttribArray(positionLoc);
  this.gl.vertexAttribPointer(
    positionLoc,
    2,              // 2 components (x, y)
    this.gl.FLOAT,  // Type
    false,          // Normalized
    0,              // Stride
    0               // Offset
  );
  
  // Unbind
  this.gl.bindVertexArray(null);
  this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
  
  this.initialized = true;
  
  // Initialize WebGL state
  this.initializeState();
}

private initializeState(): void {
  // Disable unused features for performance
  this.gl.disable(this.gl.DEPTH_TEST);
  this.gl.disable(this.gl.CULL_FACE);
  this.gl.disable(this.gl.BLEND);
  this.gl.disable(this.gl.SCISSOR_TEST);
  this.gl.disable(this.gl.STENCIL_TEST);
  
  // Set pixel pack/unpack alignment
  this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
  this.gl.pixelStorei(this.gl.PACK_ALIGNMENT, 1);
  
  // Set default clear values
  this.gl.clearColor(0, 0, 0, 0);
  this.gl.clearDepth(1.0);
  this.gl.clearStencil(0);
  
  // Initialize viewport
  const canvas = this.gl.canvas as HTMLCanvasElement;
  this.viewport = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height
  };
  this.gl.viewport(0, 0, canvas.width, canvas.height);
}
```

## Frame Rendering Contract

```typescript
renderFrame(config?: FrameConfig): void {
  if (!this.initialized) {
    throw new Error('Executor not initialized - call setupGeometry() first');
  }
  
  const startTime = performance.now();
  
  // Apply configuration
  const frameConfig: FrameConfig = {
    clear: false,
    swapBuffers: true,
    ...config
  };
  
  // 1. Set render target
  if (frameConfig.target) {
    this.setRenderTarget(frameConfig.target);
  }
  
  // 2. Set viewport
  if (frameConfig.viewport) {
    this.pushViewport(this.viewport);
    this.setViewport(
      frameConfig.viewport.x,
      frameConfig.viewport.y,
      frameConfig.viewport.width,
      frameConfig.viewport.height
    );
  }
  
  // 3. Clear if requested
  if (frameConfig.clear) {
    this.clear({
      color: frameConfig.clearColor,
      buffers: { color: true }
    });
  }
  
  // 4. Bind geometry
  this.gl.bindVertexArray(this.quadVAO);
  
  // 5. Draw the quad (6 vertices, 2 triangles)
  this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  
  // 6. Unbind
  this.gl.bindVertexArray(null);
  
  // 7. Handle buffer swapping
  if (frameConfig.swapBuffers) {
    this.resources.swapFilmBuffers();
  }
  
  // 8. Restore viewport if pushed
  if (frameConfig.viewport) {
    this.popViewport();
  }
  
  // 9. Check for errors in development
  if (process.env.NODE_ENV === 'development') {
    this.checkGLError('renderFrame');
  }
  
  // Update statistics
  const elapsed = performance.now() - startTime;
  this.updateFrameStats(elapsed);
}

clear(config?: ClearConfig): void {
  const clearConfig: ClearConfig = {
    color: [0, 0, 0, 0],
    depth: 1.0,
    stencil: 0,
    buffers: { color: true },
    ...config
  };
  
  // Set clear values
  if (clearConfig.color) {
    this.gl.clearColor(...clearConfig.color);
  }
  if (clearConfig.depth !== undefined) {
    this.gl.clearDepth(clearConfig.depth);
  }
  if (clearConfig.stencil !== undefined) {
    this.gl.clearStencil(clearConfig.stencil);
  }
  
  // Build clear mask
  let mask = 0;
  if (clearConfig.buffers?.color) mask |= this.gl.COLOR_BUFFER_BIT;
  if (clearConfig.buffers?.depth) mask |= this.gl.DEPTH_BUFFER_BIT;
  if (clearConfig.buffers?.stencil) mask |= this.gl.STENCIL_BUFFER_BIT;
  
  // Execute clear
  if (mask !== 0) {
    this.gl.clear(mask);
  }
}
```

## Viewport Management Contract

```typescript
setViewport(x: number, y: number, width: number, height: number): void {
  // Validate
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid viewport dimensions: ${width}x${height}`);
  }
  
  // Update internal state
  this.viewport = { x, y, width, height };
  
  // Apply to WebGL
  this.gl.viewport(x, y, width, height);
}

getViewport(): Viewport {
  return { ...this.viewport };
}

pushViewport(viewport: Viewport): void {
  this.viewportStack.push({ ...viewport });
}

popViewport(): void {
  const viewport = this.viewportStack.pop();
  if (!viewport) {
    console.warn('No viewport to pop');
    return;
  }
  
  this.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
}
```

## Render Target Contract

```typescript
setRenderTarget(target: RenderTarget): void {
  switch (target.type) {
    case 'screen':
      // Render to default framebuffer (screen)
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      break;
      
    case 'framebuffer':
      // Render to specific framebuffer
      if ('buffer' in target) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.buffer);
      } else if ('id' in target) {
        const fb = this.resources.getFramebuffer(target.id);
        if (!fb) {
          throw new Error(`Framebuffer not found: ${target.id}`);
        }
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb.glFramebuffer);
      }
      
      // Check framebuffer completeness
      const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
      if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${this.getFramebufferStatusString(status)}`);
      }
      break;
  }
  
  this.currentTarget = target;
}

getRenderTarget(): RenderTarget {
  return this.currentTarget;
}

private getFramebufferStatusString(status: GLenum): string {
  switch (status) {
    case this.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
      return 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT';
    case this.gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
      return 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT';
    case this.gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
      return 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS';
    case this.gl.FRAMEBUFFER_UNSUPPORTED:
      return 'FRAMEBUFFER_UNSUPPORTED';
    case this.gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
      return 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE';
    default:
      return `Unknown status: 0x${status.toString(16)}`;
  }
}
```

## Pixel Readback Contract

```typescript
async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
  const r = rect || this.getFullViewport();
  
  // Validate rectangle
  if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) {
    throw new Error(`Invalid readback rectangle: ${JSON.stringify(r)}`);
  }
  
  // Check if we can read float pixels
  if (!this.resources.getCapabilities().floatRenderTargets) {
    console.warn('Float render targets not available - readback may be degraded');
  }
  
  // Allocate buffer
  const pixels = new Float32Array(r.width * r.height * 4);
  
  // Start readback
  this.gl.readPixels(
    r.x, r.y,
    r.width, r.height,
    this.gl.RGBA,
    this.gl.FLOAT,
    pixels
  );
  
  // Insert fence for async completion
  const sync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) {
    throw new Error('Failed to create fence sync');
  }
  
  // Flush to ensure commands are submitted
  this.gl.flush();
  
  // Wait for completion (non-blocking)
  return new Promise<Float32Array>((resolve, reject) => {
    const checkComplete = () => {
      const status = this.gl.clientWaitSync(sync, 0, 0);
      
      switch (status) {
        case this.gl.ALREADY_SIGNALED:
        case this.gl.CONDITION_SATISFIED:
          // Complete - clean up and resolve
          this.gl.deleteSync(sync);
          resolve(pixels);
          break;
          
        case this.gl.TIMEOUT_EXPIRED:
          // Still waiting - check again next frame
          requestAnimationFrame(checkComplete);
          break;
          
        case this.gl.WAIT_FAILED:
          // Error
          this.gl.deleteSync(sync);
          reject(new Error('Sync wait failed'));
          break;
      }
    };
    
    // Start checking
    checkComplete();
  });
}

readPixelsSync(rect?: Rectangle): Float32Array {
  const r = rect || this.getFullViewport();
  
  // Validate
  if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) {
    throw new Error(`Invalid readback rectangle: ${JSON.stringify(r)}`);
  }
  
  // Allocate and read (blocking)
  const pixels = new Float32Array(r.width * r.height * 4);
  
  this.gl.readPixels(
    r.x, r.y,
    r.width, r.height,
    this.gl.RGBA,
    this.gl.FLOAT,
    pixels
  );
  
  return pixels;
}

private getFullViewport(): Rectangle {
  return {
    x: this.viewport.x,
    y: this.viewport.y,
    width: this.viewport.width,
    height: this.viewport.height
  };
}

canReadPixels(): boolean {
  // Check if we're in a state where pixels can be read
  return this.initialized && !this.gl.isContextLost();
}
```

## State Management Contract

```typescript
saveState(): RenderState {
  return {
    viewport: { ...this.viewport },
    framebuffer: this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING),
    program: this.gl.getParameter(this.gl.CURRENT_PROGRAM),
    vao: this.quadVAO,
    
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
  // Restore viewport
  this.setViewport(
    state.viewport.x,
    state.viewport.y,
    state.viewport.width,
    state.viewport.height
  );
  
  // Restore bindings
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, state.framebuffer);
  this.gl.useProgram(state.program);
  
  // Restore clear values
  this.gl.clearColor(...state.clearColor);
  this.gl.clearDepth(state.clearDepth);
  this.gl.clearStencil(state.clearStencil);
  
  // Restore features
  this.setFeature(this.gl.BLEND, state.features.blend);
  this.setFeature(this.gl.CULL_FACE, state.features.cullFace);
  this.setFeature(this.gl.DEPTH_TEST, state.features.depthTest);
  this.setFeature(this.gl.SCISSOR_TEST, state.features.scissorTest);
  this.setFeature(this.gl.STENCIL_TEST, state.features.stencilTest);
}

setFeature(feature: GLenum, enabled: boolean): void {
  if (enabled) {
    this.gl.enable(feature);
  } else {
    this.gl.disable(feature);
  }
}

isFeatureEnabled(feature: GLenum): boolean {
  return this.gl.isEnabled(feature);
}

resetState(): void {
  // Reset to initial state
  this.initializeState();
}
```

## Performance Tracking Contract

```typescript
private updateFrameStats(frameTime: number): void {
  // Update immediate stats
  this.frameStats.frameTime = frameTime;
  this.frameStats.frameNumber++;
  this.frameStats.drawCalls = 1;  // Always 1 for us
  this.frameStats.triangles = 2;   // Two triangles forming quad
  
  const now = performance.now();
  this.frameStats.timestamp = now;
  
  // Update history
  this.frameHistory.push(frameTime);
  if (this.frameHistory.length > 60) {
    this.frameHistory.shift();
  }
  
  // Calculate moving averages
  if (this.frameHistory.length > 0) {
    const sum = this.frameHistory.reduce((a, b) => a + b, 0);
    this.frameStats.averageFrameTime = sum / this.frameHistory.length;
    this.frameStats.fps = 1000 / this.frameStats.averageFrameTime;
    this.frameStats.averageFps = this.frameStats.fps;
    
    // Track min/max
    this.frameStats.minFrameTime = Math.min(...this.frameHistory);
    this.frameStats.maxFrameTime = Math.max(...this.frameHistory);
  }
}

getFrameStats(): FrameStats {
  return { ...this.frameStats };
}

resetFrameStats(): void {
  this.frameStats = {
    frameTime: 0,
    averageFrameTime: 0,
    minFrameTime: Infinity,
    maxFrameTime: 0,
    frameNumber: 0,
    drawCalls: 0,
    triangles: 0,
    timestamp: performance.now(),
    fps: 0,
    averageFps: 0,
    startTimestamp: performance.now()
  };
  this.frameHistory = [];
}

getLastFrameTime(): number {
  return this.frameStats.frameTime;
}
```

## Error Handling Contract

```typescript
private checkGLError(phase: string): void {
  const error = this.gl.getError();
  if (error !== this.gl.NO_ERROR) {
    const errorString = this.getGLErrorString(error);
    console.error(`WebGL error in ${phase}: ${errorString}`);
  }
}

private getGLErrorString(error: GLenum): string {
  switch (error) {
    case this.gl.INVALID_ENUM:
      return 'INVALID_ENUM';
    case this.gl.INVALID_VALUE:
      return 'INVALID_VALUE';
    case this.gl.INVALID_OPERATION:
      return 'INVALID_OPERATION';
    case this.gl.OUT_OF_MEMORY:
      return 'OUT_OF_MEMORY';
    case this.gl.INVALID_FRAMEBUFFER_OPERATION:
      return 'INVALID_FRAMEBUFFER_OPERATION';
    case this.gl.CONTEXT_LOST_WEBGL:
      return 'CONTEXT_LOST_WEBGL';
    default:
      return `Unknown error: 0x${error.toString(16)}`;
  }
}

handleContextLoss(): void {
  console.warn('WebGL context lost in RenderExecutor');
  
  // Clear internal state
  this.initialized = false;
  this.quadVAO = null;
  this.vertexBuffer = null;
  
  // Don't try to delete WebGL resources - they're already gone
  // Resources will be recreated when context is restored
}
```

## Cleanup Contract

```typescript
dispose(): void {
  // Delete geometry (only if context is still valid)
  if (!this.gl.isContextLost()) {
    if (this.quadVAO) {
      this.gl.deleteVertexArray(this.quadVAO);
    }
    
    if (this.vertexBuffer) {
      this.gl.deleteBuffer(this.vertexBuffer);
    }
  }
  
  // Clear references
  this.quadVAO = null;
  this.vertexBuffer = null;
  
  // Reset state
  this.initialized = false;
  this.viewportStack = [];
  this.currentTarget = { type: "screen" };
  
  // Reset stats
  this.resetFrameStats();
}
```

## Minimal Working Example

```typescript
// Create executor
const gl = canvas.getContext('webgl2')!;
const resources = new ResourceManager(gl);
const executor = new RenderExecutor(gl, resources);

// Initialize geometry (once)
executor.setupGeometry();

// Set viewport
executor.setViewport(0, 0, 1920, 1080);

// Each frame
function renderFrame() {
  // Render with configuration
  executor.renderFrame({
    clear: frameNumber === 0,
    clearColor: [0, 0, 0, 0],
    swapBuffers: true,
    target: { type: "screen" }
  });
  
  // Check performance
  const stats = executor.getFrameStats();
  if (frameNumber % 60 === 0) {
    console.log(`FPS: ${stats.fps.toFixed(1)}`);
  }
}

// Read pixels asynchronously
document.getElementById('save-btn').onclick = async () => {
  const pixels = await executor.readPixelsAsync();
  console.log('Captured pixels:', pixels.length / 4, 'pixels');
  saveToFile(pixels);
};

// Read specific rectangle synchronously
const thumbnail = executor.readPixelsSync({
  x: 0, y: 0,
  width: 256, height: 256
});

// Save/restore state for multiple passes
const savedState = executor.saveState();

executor.setViewport(0, 0, 512, 512);
executor.setRenderTarget({ type: "framebuffer", id: "shadow_map" });
executor.renderFrame();

executor.restoreState(savedState);

// Handle context loss
gl.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  executor.handleContextLoss();
});

// Cleanup
executor.dispose();
```

## Invariants

1. **Geometry initialized** before any rendering
2. **VAO bound** only during draw call
3. **Full-screen quad** covers viewport (6 vertices, 2 triangles)
4. **Viewport validated** for positive dimensions
5. **Framebuffer complete** before rendering
6. **Fence sync deleted** after readback
7. **State stack balanced** (push/pop pairs)
8. **Context loss handled** without trying to delete resources

## Error Handling

| Error | Response |
|-------|----------|
| Not initialized | Throw on render operations |
| Invalid viewport | Throw with dimensions |
| Framebuffer incomplete | Throw with status |
| Context lost | Clean up internal state |
| Sync creation failed | Throw in async readback |
| Invalid readback rect | Throw with rectangle |
| WebGL errors | Log in development mode |

## Performance Requirements

- Geometry setup: Once at initialization
- Draw call: Single `drawArrays` per frame (6 vertices)
- State save/restore: < 1ms
- Async readback: Non-blocking with fence
- Sync readback: Blocks until complete
- Frame stats: O(1) update per frame
- Error checking: Only in development mode
