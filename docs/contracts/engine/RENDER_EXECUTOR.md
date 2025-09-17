# Render Executor Contract

The RenderExecutor manages WebGL draw calls, viewport configuration, and pixel readback.

## Core Interface

```typescript
interface RenderExecutor {
  // Frame rendering
  renderFrame(): void;
  clearFrame(): void;
  
  // Viewport management
  setViewport(x: number, y: number, width: number, height: number): void;
  getViewport(): Viewport;
  
  // Render target control
  setRenderTarget(target: RenderTarget): void;
  getRenderTarget(): RenderTarget;
  
  // Pixel readback
  readPixels(rect?: Rectangle): Promise<Float32Array>;
  readPixelsSync(rect?: Rectangle): Float32Array;
  
  // State management
  saveState(): RenderState;
  restoreState(state: RenderState): void;
  
  // Performance
  getFrameStats(): FrameStats;
}
```

## Render Targets

```typescript
type RenderTarget = 
  | { type: "screen" }
  | { type: "texture"; framebuffer: WebGLFramebuffer }
  | { type: "multi"; framebuffers: WebGLFramebuffer[] };

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## Geometry Setup

The executor uses a simple full-screen quad:

```typescript
class RenderExecutor {
  private quadVAO: WebGLVertexArrayObject;
  
  setupGeometry() {
    // Create vertex array object
    this.quadVAO = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.quadVAO);
    
    // Full-screen triangle strip
    const vertices = new Float32Array([
      -1, -1,  // Bottom-left
       1, -1,  // Bottom-right
      -1,  1,  // Top-left
       1,  1   // Top-right
    ]);
    
    // Create and bind buffer
    const vbo = this.gl.createBuffer();
    this.gl.bindBuffer(GL.ARRAY_BUFFER, vbo);
    this.gl.bufferData(GL.ARRAY_BUFFER, vertices, GL.STATIC_DRAW);
    
    // Set up attribute
    const positionLoc = 0;  // Assume location 0
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(
      positionLoc,
      2,           // 2 components
      GL.FLOAT,
      false,       // No normalization
      0,           // Stride
      0            // Offset
    );
    
    this.gl.bindVertexArray(null);
  }
}
```

## Frame Execution

```typescript
interface FrameConfig {
  clear?: boolean;                    // Clear before drawing
  swapBuffers?: boolean;              // Swap film buffers after
  viewport?: Viewport;                // Custom viewport
  target?: RenderTarget;              // Where to render
}

class RenderExecutor {
  renderFrame(config: FrameConfig = {}) {
    // Save current state if needed
    const previousState = config.viewport ? this.saveState() : null;
    
    try {
      // 1. Set render target
      if (config.target) {
        this.setRenderTarget(config.target);
      }
      
      // 2. Set viewport
      if (config.viewport) {
        this.setViewport(
          config.viewport.x,
          config.viewport.y,
          config.viewport.width,
          config.viewport.height
        );
      }
      
      // 3. Clear if requested
      if (config.clear) {
        this.clearFrame();
      }
      
      // 4. Bind geometry
      this.gl.bindVertexArray(this.quadVAO);
      
      // 5. Draw
      this.gl.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
      
      // 6. Unbind
      this.gl.bindVertexArray(null);
      
      // 7. Swap buffers if accumulating
      if (config.swapBuffers) {
        this.resourceManager.swapFilmBuffers();
      }
      
      // Update stats
      this.updateFrameStats();
      
    } finally {
      // Restore state if saved
      if (previousState) {
        this.restoreState(previousState);
      }
    }
  }
}
```

## Clear Operations

```typescript
interface ClearConfig {
  color?: [number, number, number, number];
  depth?: number;
  stencil?: number;
  buffers?: {
    color?: boolean;
    depth?: boolean;
    stencil?: boolean;
  };
}

class RenderExecutor {
  clearFrame(config: ClearConfig = {}) {
    // Set clear values
    if (config.color) {
      this.gl.clearColor(...config.color);
    } else {
      this.gl.clearColor(0, 0, 0, 0);
    }
    
    if (config.depth !== undefined) {
      this.gl.clearDepth(config.depth);
    }
    
    if (config.stencil !== undefined) {
      this.gl.clearStencil(config.stencil);
    }
    
    // Determine what to clear
    let clearMask = 0;
    const buffers = config.buffers || { color: true };
    
    if (buffers.color) clearMask |= GL.COLOR_BUFFER_BIT;
    if (buffers.depth) clearMask |= GL.DEPTH_BUFFER_BIT;
    if (buffers.stencil) clearMask |= GL.STENCIL_BUFFER_BIT;
    
    // Clear
    if (clearMask) {
      this.gl.clear(clearMask);
    }
  }
}
```

## Pixel Readback

```typescript
interface ReadbackConfig {
  format?: GLenum;                    // Default: RGBA
  type?: GLenum;                      // Default: FLOAT
  buffer?: ArrayBufferView;           // Reuse buffer
}

class RenderExecutor {
  // Asynchronous readback (non-blocking)
  async readPixels(rect?: Rectangle, config: ReadbackConfig = {}): Promise<Float32Array> {
    const r = rect || this.getFullViewport();
    
    // Use pixel buffer object for async
    const pbo = this.gl.createBuffer();
    this.gl.bindBuffer(GL.PIXEL_PACK_BUFFER, pbo);
    
    const size = r.width * r.height * 4 * 4; // 4 channels, 4 bytes per float
    this.gl.bufferData(GL.PIXEL_PACK_BUFFER, size, GL.STREAM_READ);
    
    // Start async read
    this.gl.readPixels(
      r.x, r.y, r.width, r.height,
      config.format || GL.RGBA,
      config.type || GL.FLOAT,
      0  // Offset into PBO
    );
    
    // Wait for completion
    await this.waitForSync();
    
    // Map buffer and copy
    const data = new Float32Array(r.width * r.height * 4);
    this.gl.getBufferSubData(GL.PIXEL_PACK_BUFFER, 0, data);
    
    // Cleanup
    this.gl.bindBuffer(GL.PIXEL_PACK_BUFFER, null);
    this.gl.deleteBuffer(pbo);
    
    return data;
  }
  
  // Synchronous readback (blocks GPU)
  readPixelsSync(rect?: Rectangle, config: ReadbackConfig = {}): Float32Array {
    const r = rect || this.getFullViewport();
    
    const data = config.buffer || 
      new Float32Array(r.width * r.height * 4);
    
    this.gl.readPixels(
      r.x, r.y, r.width, r.height,
      config.format || GL.RGBA,
      config.type || GL.FLOAT,
      data
    );
    
    return data;
  }
  
  private async waitForSync() {
    const sync = this.gl.fenceSync(GL.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.gl.flush();
    
    return new Promise<void>((resolve) => {
      const check = () => {
        const status = this.gl.clientWaitSync(sync, 0, 0);
        
        if (status === GL.ALREADY_SIGNALED || 
            status === GL.CONDITION_SATISFIED) {
          this.gl.deleteSync(sync);
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }
}
```

## Tiled Rendering

For high-resolution renders:

```typescript
interface TileConfig {
  fullResolution: [number, number];
  tileSize: number;
  overlap?: number;                   // For filtering
  order?: "linear" | "spiral" | "random";
}

class TiledRenderExecutor {
  *generateTiles(config: TileConfig): Generator<Tile> {
    const [width, height] = config.fullResolution;
    const size = config.tileSize;
    const overlap = config.overlap || 0;
    
    const tilesX = Math.ceil(width / size);
    const tilesY = Math.ceil(height / size);
    
    const tiles: Tile[] = [];
    
    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        tiles.push({
          id: y * tilesX + x,
          x: x * size - overlap,
          y: y * size - overlap,
          width: Math.min(size + 2 * overlap, width - x * size),
          height: Math.min(size + 2 * overlap, height - y * size)
        });
      }
    }
    
    // Apply ordering
    const ordered = this.orderTiles(tiles, config.order);
    
    for (const tile of ordered) {
      yield tile;
    }
  }
  
  async renderTile(tile: Tile, samplesPerTile: number) {
    // Set viewport to tile
    this.setViewport(tile.x, tile.y, tile.width, tile.height);
    
    // Clear for first sample
    this.clearFrame();
    
    // Render samples
    for (let s = 0; s < samplesPerTile; s++) {
      this.uniformBinder.updateUniform('u_frame_index', s);
      this.renderFrame({ swapBuffers: true });
    }
    
    // Read tile pixels
    return this.readPixels(tile);
  }
}
```

## State Management

```typescript
interface RenderState {
  viewport: Viewport;
  framebuffer: WebGLFramebuffer | null;
  program: WebGLProgram | null;
  clearColor: [number, number, number, number];
  features: {
    blend: boolean;
    depthTest: boolean;
    cullFace: boolean;
  };
}

class RenderExecutor {
  saveState(): RenderState {
    return {
      viewport: this.getViewport(),
      framebuffer: this.gl.getParameter(GL.FRAMEBUFFER_BINDING),
      program: this.gl.getParameter(GL.CURRENT_PROGRAM),
      clearColor: this.gl.getParameter(GL.COLOR_CLEAR_VALUE),
      features: {
        blend: this.gl.isEnabled(GL.BLEND),
        depthTest: this.gl.isEnabled(GL.DEPTH_TEST),
        cullFace: this.gl.isEnabled(GL.CULL_FACE)
      }
    };
  }
  
  restoreState(state: RenderState) {
    this.setViewport(
      state.viewport.x,
      state.viewport.y,
      state.viewport.width,
      state.viewport.height
    );
    
    this.gl.bindFramebuffer(GL.FRAMEBUFFER, state.framebuffer);
    this.gl.useProgram(state.program);
    this.gl.clearColor(...state.clearColor);
    
    // Restore features
    this.setFeature(GL.BLEND, state.features.blend);
    this.setFeature(GL.DEPTH_TEST, state.features.depthTest);
    this.setFeature(GL.CULL_FACE, state.features.cullFace);
  }
  
  private setFeature(feature: GLenum, enabled: boolean) {
    if (enabled) {
      this.gl.enable(feature);
    } else {
      this.gl.disable(feature);
    }
  }
}
```

## Performance Monitoring

```typescript
interface FrameStats {
  frameTime: number;                  // Milliseconds
  drawCalls: number;                  // Always 1 for us
  triangles: number;                  // Always 2 for quad
  frameNumber: number;
  timestamp: number;
  
  // Moving averages
  averageFrameTime: number;
  fps: number;
  
  // GPU timing (if available)
  gpuTime?: number;
}

class RenderExecutor {
  private stats: FrameStats = {
    frameTime: 0,
    drawCalls: 0,
    triangles: 2,
    frameNumber: 0,
    timestamp: 0,
    averageFrameTime: 0,
    fps: 0
  };
  
  private frameHistory: number[] = [];
  private readonly HISTORY_SIZE = 60;
  
  updateFrameStats() {
    const now = performance.now();
    const delta = now - this.stats.timestamp;
    
    this.stats.frameTime = delta;
    this.stats.timestamp = now;
    this.stats.frameNumber++;
    this.stats.drawCalls = 1;
    
    // Update moving average
    this.frameHistory.push(delta);
    if (this.frameHistory.length > this.HISTORY_SIZE) {
      this.frameHistory.shift();
    }
    
    const avg = this.frameHistory.reduce((a, b) => a + b, 0) / 
                this.frameHistory.length;
    this.stats.averageFrameTime = avg;
    this.stats.fps = 1000 / avg;
    
    // GPU timing if available
    if (this.timerQuery) {
      this.updateGPUTime();
    }
  }
}
```

## WebGL State Setup

```typescript
class RenderExecutor {
  initialize() {
    // Disable unused features
    this.gl.disable(GL.DEPTH_TEST);
    this.gl.disable(GL.CULL_FACE);
    this.gl.disable(GL.BLEND);
    
    // Set pixel storage
    this.gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
    this.gl.pixelStorei(GL.PACK_ALIGNMENT, 1);
    
    // Extensions for float textures
    this.gl.getExtension('EXT_color_buffer_float');
    this.gl.getExtension('OES_texture_float_linear');
    
    // Timer queries for profiling
    this.timerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
}
```

## Error Handling

```typescript
class RenderError extends Error {
  constructor(
    public phase: "setup" | "render" | "readback",
    public glError: GLenum,
    message: string
  ) {
    super(message);
  }
}

class RenderExecutor {
  checkGLError(phase: string) {
    const error = this.gl.getError();
    if (error !== GL.NO_ERROR) {
      throw new RenderError(
        phase as any,
        error,
        `WebGL error in ${phase}: ${this.getErrorString(error)}`
      );
    }
  }
  
  getErrorString(error: GLenum): string {
    switch (error) {
      case GL.INVALID_ENUM: return "INVALID_ENUM";
      case GL.INVALID_VALUE: return "INVALID_VALUE";
      case GL.INVALID_OPERATION: return "INVALID_OPERATION";
      case GL.OUT_OF_MEMORY: return "OUT_OF_MEMORY";
      case GL.INVALID_FRAMEBUFFER_OPERATION: return "INVALID_FRAMEBUFFER_OPERATION";
      default: return `Unknown error: ${error}`;
    }
  }
}
```

## Integration with Engine

```typescript
class RenderExecutor {
  constructor(
    private gl: WebGL2RenderingContext,
    private resourceManager: ResourceManager,
    private uniformBinder: UniformBinder
  ) {
    this.setupGeometry();
    this.initialize();
  }
  
  // Called by RenderCoordinator
  executeFrame(mode: RenderMode) {
    // Prepare resources
    this.resourceManager.prepareFrame();
    
    // Update uniforms
    this.uniformBinder.frameUpdate();
    
    // Render based on mode
    switch (mode) {
      case 'progressive':
        this.renderFrame({ swapBuffers: true });
        break;
        
      case 'interactive':
        this.renderFrame({ target: { type: "screen" } });
        break;
        
      case 'production':
        // Handled by tile executor
        break;
    }
    
    // Finalize
    this.resourceManager.finalizeFrame();
  }
}
```

## Validation

The RenderExecutor validates:
1. Viewport dimensions are positive
2. Framebuffer is complete before rendering
3. Program is bound before draw call
4. Readback rectangle is within viewport
5. WebGL context is not lost
