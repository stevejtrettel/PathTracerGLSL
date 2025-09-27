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
  
  // Pixel readback (both async and sync)
  readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;
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

## Geometry Setup - Full-Screen Triangle

The executor uses a single full-screen triangle (more efficient than quad):

```typescript
class RenderExecutor {
  private triangleVAO: WebGLVertexArrayObject;
  
  setupGeometry() {
    // Create vertex array object
    this.triangleVAO = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.triangleVAO);
    
    // Full-screen triangle (3 vertices cover screen)
    const vertices = new Float32Array([
      -1, -1,  // Bottom-left
       3, -1,  // Bottom-right (extends beyond viewport)
      -1,  3   // Top-left (extends beyond viewport)
    ]);
    
    // Create and bind buffer
    const vbo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    
    // Set up attribute
    const positionLoc = 0;  // Assume location 0
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(
      positionLoc,
      2,           // 2 components
      this.gl.FLOAT,
      false,       // No normalization
      0,           // Stride
      0            // Offset
    );
    
    this.gl.bindVertexArray(null);
  }
  
  // Vertex shader handles the triangle
  getVertexShader(): string {
    return `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        // Convert from clip space to UV coordinates
        v_texCoord = a_position * 0.5 + 0.5;
      }
    `;
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
      this.gl.bindVertexArray(this.triangleVAO);
      
      // 5. Draw triangle (only 3 vertices!)
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
      
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
    
    if (buffers.color) clearMask |= this.gl.COLOR_BUFFER_BIT;
    if (buffers.depth) clearMask |= this.gl.DEPTH_BUFFER_BIT;
    if (buffers.stencil) clearMask |= this.gl.STENCIL_BUFFER_BIT;
    
    // Clear
    if (clearMask) {
      this.gl.clear(clearMask);
    }
  }
}
```

## Pixel Readback

```typescript
class RenderExecutor {
  // Asynchronous readback (non-blocking)
  async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
    const r = rect || this.getFullViewport();
    const pixels = new Float32Array(r.width * r.height * 4);
    
    // Start readback
    this.gl.readPixels(
      r.x, r.y, r.width, r.height,
      this.gl.RGBA, this.gl.FLOAT,
      pixels
    );
    
    // Insert fence and wait
    const sync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.gl.flush();
    
    // Poll for completion
    await new Promise<void>((resolve) => {
      const check = () => {
        const status = this.gl.clientWaitSync(sync, 0, 0);
        
        if (status === this.gl.ALREADY_SIGNALED || 
            status === this.gl.CONDITION_SATISFIED) {
          this.gl.deleteSync(sync);
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
    
    return pixels;
  }
  
  // Synchronous readback (blocks GPU)
  readPixelsSync(rect?: Rectangle): Float32Array {
    const r = rect || this.getFullViewport();
    
    const data = new Float32Array(r.width * r.height * 4);
    
    this.gl.readPixels(
      r.x, r.y, r.width, r.height,
      this.gl.RGBA, this.gl.FLOAT,
      data
    );
    
    return data;
  }
  
  private getFullViewport(): Rectangle {
    const viewport = this.gl.getParameter(this.gl.VIEWPORT);
    return {
      x: viewport[0],
      y: viewport[1],
      width: viewport[2],
      height: viewport[3]
    };
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
      framebuffer: this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING),
      program: this.gl.getParameter(this.gl.CURRENT_PROGRAM),
      clearColor: this.gl.getParameter(this.gl.COLOR_CLEAR_VALUE),
      features: {
        blend: this.gl.isEnabled(this.gl.BLEND),
        depthTest: this.gl.isEnabled(this.gl.DEPTH_TEST),
        cullFace: this.gl.isEnabled(this.gl.CULL_FACE)
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
    
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, state.framebuffer);
    this.gl.useProgram(state.program);
    this.gl.clearColor(...state.clearColor);
    
    // Restore features
    this.setFeature(this.gl.BLEND, state.features.blend);
    this.setFeature(this.gl.DEPTH_TEST, state.features.depthTest);
    this.setFeature(this.gl.CULL_FACE, state.features.cullFace);
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
  triangles: number;                  // 1 for triangle (was 2 for quad)
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
    triangles: 1,  // Just 1 triangle now
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
  }
}
```

## WebGL State Setup

```typescript
class RenderExecutor {
  initialize() {
    // Disable unused features
    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.disable(this.gl.BLEND);
    
    // Set pixel storage
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.pixelStorei(this.gl.PACK_ALIGNMENT, 1);
    
    // Check for required extensions
    const colorBufferFloat = this.gl.getExtension('EXT_color_buffer_float');
    if (!colorBufferFloat) {
      console.warn('Float color buffers not available - HDR rendering disabled');
    }
    
    // Optional extensions
    this.gl.getExtension('OES_texture_float_linear');
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
    if (error !== this.gl.NO_ERROR) {
      throw new RenderError(
        phase as any,
        error,
        `WebGL error in ${phase}: ${this.getErrorString(error)}`
      );
    }
  }
  
  getErrorString(error: GLenum): string {
    switch (error) {
      case this.gl.INVALID_ENUM: return "INVALID_ENUM";
      case this.gl.INVALID_VALUE: return "INVALID_VALUE";
      case this.gl.INVALID_OPERATION: return "INVALID_OPERATION";
      case this.gl.OUT_OF_MEMORY: return "OUT_OF_MEMORY";
      case this.gl.INVALID_FRAMEBUFFER_OPERATION: return "INVALID_FRAMEBUFFER_OPERATION";
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
  
  // Called by Engine each frame
  executeFrame(mode: RenderMode) {
    // Prepare resources
    this.resourceManager.prepareFrame();
    
    // Flush all uniform updates at once
    this.uniformBinder.frameUpdate(this.getEngineState());
    
    // Render based on mode
    switch (mode) {
      case 'progressive':
        this.renderFrame({ swapBuffers: true });
        break;
        
      case 'interactive':
        this.renderFrame({ target: { type: "screen" } });
        break;
        
      case 'production':
        // Handled separately if needed
        break;
    }
    
    // Finalize
    this.resourceManager.finalizeFrame();
  }
  
  private getEngineState(): EngineState {
    return {
      width: this.viewport.width,
      height: this.viewport.height,
      frameIndex: this.stats.frameNumber,
      sampleCount: this.accumulator?.count || 0,
      time: performance.now() / 1000
    };
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
6. Float render targets available for HDR
