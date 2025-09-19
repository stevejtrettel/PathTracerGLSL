# Render Executor Contract

## Purpose

The RenderExecutor manages WebGL draw calls, viewport configuration, render target management, and pixel readback. It executes the actual GPU rendering using a full-screen triangle and manages all WebGL state required for rendering.

## Required Interface

```typescript
interface RenderExecutor {
  // Initialization
  setupGeometry(): void;
  initialize(): void;
  isInitialized(): boolean;
  
  // Frame rendering
  renderFrame(config?: FrameConfig): void;
  clearFrame(config?: ClearConfig): void;
  
  // Viewport management
  setViewport(x: number, y: number, width: number, height: number): void;
  getViewport(): Viewport;
  resetViewport(): void;
  
  // Render target control
  setRenderTarget(target: RenderTarget): void;
  getRenderTarget(): RenderTarget;
  bindFramebuffer(framebufferId: string | null): void;
  
  // Pixel readback
  readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;
  readPixelsSync(rect?: Rectangle): Float32Array;
  canReadPixels(): boolean;
  
  // WebGL state management
  saveState(): RenderState;
  restoreState(state: RenderState): void;
  getCurrentState(): RenderState;
  resetState(): void;
  
  // Performance monitoring
  getFrameStats(): FrameStats;
  resetFrameStats(): void;
  getAverageFrameTime(): number;
  getFrameCount(): number;
  
  // WebGL context
  checkContextLost(): boolean;
  handleContextLost(): void;
  handleContextRestored(): void;
  getGLError(): string | null;
}
```

## Frame Configuration

### Frame Config Structure

```typescript
interface FrameConfig {
  // Clearing
  clear?: boolean;                    // Clear before drawing
  clearColor?: [number, number, number, number];
  clearDepth?: number;
  clearStencil?: number;
  
  // Viewport
  viewport?: Viewport;                // Override current viewport
  scissorTest?: boolean;              // Enable scissor test
  scissorRect?: Rectangle;            // Scissor rectangle
  
  // Target
  target?: RenderTarget;              // Where to render
  drawBuffers?: number[];             // MRT color attachments
  
  // Buffer management
  swapBuffers?: boolean;              // Swap film buffers after
  preserveDrawingBuffer?: boolean;    // Keep for readback
}

interface ClearConfig {
  color?: boolean;                    // Clear color buffer
  depth?: boolean;                    // Clear depth buffer
  stencil?: boolean;                  // Clear stencil buffer
  clearColor?: [number, number, number, number];
  clearDepth?: number;
  clearStencil?: number;
}
```

### Render Targets

```typescript
type RenderTarget = 
  | { type: "screen" }                           // Default framebuffer
  | { type: "framebuffer"; id: string }          // Single framebuffer
  | { type: "mrt"; framebufferId: string;        // Multiple render targets
      attachments: number[] };

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

### Full-Screen Triangle

The executor MUST use a full-screen triangle (3 vertices) for efficiency:

```
Vertex positions:
  v0: (-1, -1)  // Bottom-left
  v1: ( 3, -1)  // Bottom-right (extends beyond viewport)
  v2: (-1,  3)  // Top-left (extends beyond viewport)
```

### Vertex Array Requirements

The executor MUST:
- Create a VAO for the triangle
- Bind vertex positions to attribute location 0
- Use STATIC_DRAW for vertex buffer
- Keep VAO bound only during draw calls

## Rendering Process

### Frame Execution Steps

`renderFrame(config)` MUST execute in this order:

1. **Save state** (if config specifies viewport/target changes)
2. **Set render target** (framebuffer or screen)
3. **Configure viewport** (and scissor if enabled)
4. **Clear buffers** (if requested)
5. **Bind VAO** (full-screen triangle)
6. **Draw triangle** (3 vertices, TRIANGLES mode)
7. **Unbind VAO**
8. **Swap buffers** (if film uses ping-pong)
9. **Update statistics**
10. **Restore state** (if saved)

### Draw Call

The single draw call MUST:
- Use `gl.drawArrays(gl.TRIANGLES, 0, 3)`
- Draw exactly 3 vertices
- Use TRIANGLES primitive mode
- Not use index buffer

## Pixel Readback

### Asynchronous Readback

`readPixelsAsync()` MUST:

1. Start pixel read with `gl.readPixels()`
2. Insert fence sync with `gl.fenceSync()`
3. Flush with `gl.flush()`
4. Poll fence status without blocking
5. Return Promise that resolves when complete
6. Delete sync object after completion

### Synchronous Readback

`readPixelsSync()` MUST:
1. Call `gl.readPixels()` directly
2. Block until transfer complete
3. Return pixel data immediately
4. Handle format conversion if needed

### Readback Formats

The executor MUST support reading:

| Format | Type | Use Case |
|--------|------|----------|
| RGBA | FLOAT | HDR rendering output |
| RGBA | UNSIGNED_BYTE | LDR/screenshot |
| RGB | FLOAT | HDR without alpha |
| RGB | UNSIGNED_BYTE | Standard screenshots |

### Readback Validation

The executor MUST:
- Clamp rectangle to viewport bounds
- Use full viewport if no rectangle specified
- Check framebuffer is complete before reading
- Handle coordinate system (flip Y if needed)

## WebGL State Management

### Render State Structure

```typescript
interface RenderState {
  // Bindings
  viewport: Viewport;
  framebuffer: WebGLFramebuffer | null;
  program: WebGLProgram | null;
  vao: WebGLVertexArrayObject | null;
  
  // Clear values
  clearColor: [number, number, number, number];
  clearDepth: number;
  clearStencil: number;
  
  // Feature flags
  features: {
    blend: boolean;
    cullFace: boolean;
    depthTest: boolean;
    scissorTest: boolean;
    stencilTest: boolean;
  };
  
  // Blend state
  blendFunc?: {
    srcRGB: number;
    dstRGB: number;
    srcAlpha: number;
    dstAlpha: number;
  };
}
```

### State Operations

The executor MUST:
- Save complete WebGL state on request
- Restore state exactly as saved
- Track current state for queries
- Reset to default state when needed

### Default State

The default/reset state MUST be:
- Viewport: full canvas
- Framebuffer: null (screen)
- Features: all disabled except COLOR_BUFFER_BIT
- Clear color: (0, 0, 0, 0)
- Clear depth: 1.0
- Clear stencil: 0

## Performance Monitoring

### Frame Statistics

```typescript
interface FrameStats {
  // Timing
  frameTime: number;                  // Last frame milliseconds
  averageFrameTime: number;           // Moving average
  minFrameTime: number;               // Best frame
  maxFrameTime: number;               // Worst frame
  
  // Counts
  frameNumber: number;                // Total frames rendered
  drawCalls: number;                  // Always 1 for us
  triangles: number;                  // Always 1 for us
  
  // Performance
  fps: number;                        // Current FPS
  averageFps: number;                 // Average FPS
  
  // Timestamps
  lastFrameTimestamp: number;         // When last frame completed
  startTimestamp: number;             // When rendering started
}
```

### Statistics Tracking

The executor MUST:
- Update stats after each frame
- Maintain moving average over last 60 frames
- Track min/max for performance bounds
- Calculate FPS from frame times
- Reset statistics on request

## Context Loss Handling

### Detection

The executor MUST:
- Check context before each frame
- Detect `webglcontextlost` event
- Set internal flag when lost

### Response to Context Loss

When context is lost, the executor MUST:
- Stop all rendering operations
- Clear all WebGL resources
- Notify Engine of context loss
- Wait for restoration

### Context Restoration

When context is restored, the executor MUST:
- Re-create VAO and geometry
- Signal Engine to recompile shaders
- Reset all statistics
- Resume rendering

## WebGL Configuration

### Initial Setup

`initialize()` MUST:

1. **Disable unused features**:
    - Depth test (not needed for full-screen)
    - Face culling (single triangle)
    - Blending (handled in shader)
    - Stencil test (not used)

2. **Configure pixel storage**:
    - UNPACK_ALIGNMENT: 1
    - PACK_ALIGNMENT: 1
    - UNPACK_FLIP_Y_WEBGL: false
    - UNPACK_PREMULTIPLY_ALPHA_WEBGL: false

3. **Check extensions**:
    - EXT_color_buffer_float (required for HDR)
    - OES_texture_float_linear (optional)
    - WEBGL_lose_context (for testing)

### Error Checking

The executor MUST:
- Check `gl.getError()` after major operations in development
- Clear error state before checking
- Map error codes to readable strings
- Not check errors in production (performance)

## Integration Requirements

### With ResourceManager

The executor MUST:
- Get framebuffer IDs for render targets
- Trigger buffer swaps after rendering
- Respect viewport constraints from capabilities

### With UniformBinder

The executor MUST:
- Ensure uniforms are bound before drawing
- Not interfere with uniform state

### With Engine

The executor MUST:
- Provide frame statistics
- Handle render configuration
- Report context loss
- Execute pixel readback

## Error Handling

### Rendering Errors

The executor MUST handle:
- Invalid viewport dimensions → Clamp to canvas
- Incomplete framebuffer → Fall back to screen
- Context lost → Stop rendering
- WebGL errors → Log and continue

### Readback Errors

The executor MUST handle:
- Out of bounds rectangle → Clamp to viewport
- Invalid format → Use RGBA/UNSIGNED_BYTE
- Incomplete framebuffer → Return black
- Out of memory → Return null

## Performance Requirements

- Frame rendering: < 0.5ms overhead (beyond shader execution)
- State save/restore: < 0.1ms
- Async readback: Non-blocking with < 1ms setup
- Sync readback: Proportional to pixel count
- Statistics update: < 0.05ms

## Usage Example

```typescript
const executor = new RenderExecutor(gl, resourceManager, uniformBinder);

// One-time setup
executor.setupGeometry();
executor.initialize();

// Each frame
executor.renderFrame({
  clear: frameNumber === 0,
  swapBuffers: true,
  viewport: { x: 0, y: 0, width: 1920, height: 1080 }
});

// Read pixels asynchronously
const pixels = await executor.readPixelsAsync({
  x: 100, y: 100, width: 200, height: 200
});

// Check performance
const stats = executor.getFrameStats();
console.log(`FPS: ${stats.fps.toFixed(1)}`);

// Handle context loss
if (executor.checkContextLost()) {
  console.error('WebGL context lost');
  executor.handleContextLost();
}
```

## Invariants

1. Exactly one draw call per frame (3 vertices)
2. VAO is only bound during drawing
3. Viewport is always valid (positive dimensions)
4. Statistics are updated every frame
5. Context state is checked before rendering
6. Pixel readback rectangles are clamped to viewport
7. Frame config overrides are temporary (restored after)
8. Clear operations happen before drawing
