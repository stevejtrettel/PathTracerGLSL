# Phase 1.4: Minimal App - Detailed Plan

## Purpose & Scope

Phase 1.4 creates the minimal application that orchestrates all components into a working renderer. This is the entry point that creates the WebGL context, loads modules, compiles shaders, and runs the render loop. By the end, we'll see a normal-colored sphere on screen.

**Core Goal**: Wire together Engine, modules, and a render loop in the simplest possible way that produces visible output.

## File Structure & Responsibilities

### `src/app/main.ts` - Application Entry Point

**Purpose**: Bootstrap the entire system and start rendering.

**Core Structure**:
```typescript
class MinimalApp {
  private canvas: HTMLCanvasElement
  private engine: Engine
  private animationId: number | null = null
  private frameCount: number = 0
  private startTime: number
  
  constructor(canvasId: string)
  private async initialize(): Promise<void>
  private loadModules(): void
  private compileShaders(): void
  private startRenderLoop(): void
  private renderFrame(): void
  stop(): void
  
  // Debug utilities
  private reportPerformance(): void
  private checkWebGLErrors(): void
}
```

**Initialization Sequence**:
```typescript
async initialize() {
  // 1. Get canvas and validate
  this.canvas = document.getElementById(canvasId) as HTMLCanvasElement
  if (!this.canvas) throw new Error('Canvas not found')
  
  // 2. Set canvas size (fixed for Phase 1)
  this.canvas.width = 800
  this.canvas.height = 600
  
  // 3. Create Engine (which creates WebGL context)
  try {
    this.engine = new Engine(this.canvas)
  } catch (e) {
    this.handleWebGLError(e)
  }
  
  // 4. Load all modules
  this.loadModules()
  
  // 5. Compile shader program
  this.compileShaders()
  
  // 6. Start render loop
  this.startTime = performance.now()
  this.startRenderLoop()
}
```

### Module Loading Strategy

**Purpose**: Get GLSL source code into the engine. For Phase 1, we'll embed them as strings.

**Approach 1: Inline Strings** (Simplest for Phase 1)
```typescript
private loadModules(): void {
  // Embed GLSL as template strings
  const EUCLIDEAN_GLSL = `
    vec3 geometry_geodesic(vec3 p, vec3 v, float t) {
      return p + t * v;
    }
    // ... rest of module
  `
  
  const PINHOLE_GLSL = `
    Ray camera_generateRay(vec2 pixel, vec2 resolution) {
      // ... implementation
    }
  `
  
  // Register with engine
  this.engine.registerModule({
    kind: 'geometry',
    name: 'euclidean',
    source: EUCLIDEAN_GLSL
  })
  
  this.engine.registerModule({
    kind: 'camera', 
    name: 'pinhole',
    source: PINHOLE_GLSL
  })
  
  // ... register all modules
}
```

**Approach 2: Import as Raw Strings** (Better for development)
```typescript
// Using a bundler that supports ?raw imports (Vite, Webpack with raw-loader)
import euclideanGLSL from '../world/geometry/euclidean.glsl?raw'
import pinholeGLSL from '../photography/camera/pinhole.glsl?raw'

private loadModules(): void {
  const modules = [
    { kind: 'geometry', name: 'euclidean', source: euclideanGLSL },
    { kind: 'camera', name: 'pinhole', source: pinholeGLSL },
    // ... all modules
  ]
  
  for (const module of modules) {
    this.engine.registerModule(module)
  }
}
```

**Module Load Order**:
1. Geometry (euclidean) - Defines math functions
2. Scene (hardcoded_sphere) - Defines scene
3. Lighting (white_ambient) - Defines lights
4. Camera (pinhole) - Generates rays
5. Transport (simple) - Traces rays
6. Interaction (debug_normal) - Shades hits
7. Film (simple) - Stores pixels
8. Developer (linear) - Tone maps

Order matters only for dependency clarity, not for loading (compiler handles ordering).

### Shader Compilation

**Purpose**: Define the single recipe and compile it.

```typescript
private compileShaders(): void {
  // Define our single hardcoded recipe
  const recipe: Recipe = {
    geometry: 'euclidean',
    scene: 'hardcoded_sphere',
    lighting: 'white_ambient',
    camera: 'pinhole',
    transport: 'simple',
    interaction: 'debug_normal',
    film: 'simple',
    developer: 'linear'
  }
  
  try {
    this.engine.compile(recipe)
    console.log('Shader compilation successful')
  } catch (error) {
    console.error('Shader compilation failed:', error)
    this.displayCompilationError(error)
    throw error  // Stop execution
  }
}

private displayCompilationError(error: Error): void {
  // Show error in DOM for better debugging
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    right: 10px;
    background: #ff0000;
    color: white;
    padding: 10px;
    font-family: monospace;
    white-space: pre-wrap;
    z-index: 1000;
  `
  errorDiv.textContent = error.message
  document.body.appendChild(errorDiv)
}
```

### Render Loop

**Purpose**: Continuously render frames and measure performance.

```typescript
private startRenderLoop(): void {
  const render = () => {
    this.renderFrame()
    this.animationId = requestAnimationFrame(render)
  }
  this.animationId = requestAnimationFrame(render)
}

private renderFrame(): void {
  // Render the frame
  this.engine.renderFrame()
  
  // Update stats
  this.frameCount++
  
  // Report performance every 60 frames
  if (this.frameCount % 60 === 0) {
    this.reportPerformance()
  }
  
  // Check for WebGL errors in debug mode
  if (this.frameCount % 10 === 0) {
    this.checkWebGLErrors()
  }
}

private reportPerformance(): void {
  const elapsed = performance.now() - this.startTime
  const fps = (this.frameCount / elapsed) * 1000
  console.log(`FPS: ${fps.toFixed(1)}, Frames: ${this.frameCount}`)
  
  // Update DOM display if element exists
  const fpsElement = document.getElementById('fps')
  if (fpsElement) {
    fpsElement.textContent = `FPS: ${fps.toFixed(1)}`
  }
}
```

### WebGL Error Handling

**Purpose**: Robust error handling for WebGL context issues.

```typescript
private handleWebGLError(error: Error): void {
  const message = this.diagnoseWebGLError()
  
  const errorHTML = `
    <div style="padding: 20px; background: #f00; color: white;">
      <h2>WebGL Initialization Failed</h2>
      <p>${message}</p>
      <pre>${error.message}</pre>
    </div>
  `
  
  document.body.innerHTML = errorHTML
}

private diagnoseWebGLError(): string {
  const gl = this.canvas.getContext('webgl2')
  
  if (!gl) {
    const gl1 = this.canvas.getContext('webgl')
    if (gl1) {
      return 'WebGL 2 not supported. This application requires WebGL 2.0.'
    }
    return 'WebGL not supported in this browser.'
  }
  
  if (gl.isContextLost()) {
    return 'WebGL context was lost. This often happens with too many contexts.'
  }
  
  return 'Unknown WebGL error occurred.'
}

private checkWebGLErrors(): void {
  const gl = this.engine.getGLContext()  // Add getter to Engine
  const error = gl.getError()
  
  if (error !== gl.NO_ERROR) {
    const errorNames: Record<number, string> = {
      [gl.INVALID_ENUM]: 'INVALID_ENUM',
      [gl.INVALID_VALUE]: 'INVALID_VALUE',
      [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
      [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
      [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION'
    }
    console.error('WebGL Error:', errorNames[error] || `Unknown (${error})`)
  }
}
```

### HTML Entry Point

**Purpose**: Minimal HTML to host the canvas.

`index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Phase 1: Normal-Colored Sphere</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #222;
      color: #fff;
      font-family: monospace;
    }
    
    #canvas {
      border: 1px solid #555;
      display: block;
      margin: 20px auto;
    }
    
    #stats {
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #0f0;
      padding: 10px;
      font-size: 14px;
    }
    
    #info {
      text-align: center;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div id="stats">
    <div id="fps">FPS: 0</div>
    <div>Phase 1: Normal Visualization</div>
  </div>
  
  <canvas id="canvas"></canvas>
  
  <div id="info">
    <p>You should see a sphere colored by its surface normals:</p>
    <p>Red = X axis, Green = Y axis, Blue = Z axis</p>
  </div>
  
  <script type="module" src="./src/app/main.ts"></script>
</body>
</html>
```

### Main Entry Point

`src/app/main.ts`:
```typescript
// Application entry
async function main() {
  try {
    const app = new MinimalApp('canvas')
    await app.initialize()
    
    // For debugging - expose to global scope
    (window as any).app = app
    
    console.log('Renderer initialized successfully')
  } catch (error) {
    console.error('Failed to initialize:', error)
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  main()
}
```

## Development Setup

### Build Configuration (Vite)

`vite.config.ts`:
```typescript
export default {
  assetsInclude: ['**/*.glsl'],
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'es2020',
    sourcemap: true
  }
}
```

### TypeScript Configuration

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "types": ["vite/client"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Package Setup

`package.json`:
```json
{
  "name": "webgl-pathtracer-phase1",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

## Testing Strategy

### Visual Validation
```typescript
test('sphere is visible', async () => {
  const app = new MinimalApp('test-canvas')
  await app.initialize()
  
  // Render one frame
  app.renderFrame()
  
  // Read center pixel
  const pixels = app.engine.readPixels(400, 300, 1, 1)
  
  // Should not be black or sky color
  expect(pixels[0]).toBeGreaterThan(0)  // Red
  expect(pixels[1]).toBeGreaterThan(0)  // Green
  expect(pixels[2]).toBeGreaterThan(0)  // Blue
})
```

### Performance Baseline
```typescript
test('achieves minimum framerate', async () => {
  const app = new MinimalApp('test-canvas')
  await app.initialize()
  
  // Render 100 frames
  const start = performance.now()
  for (let i = 0; i < 100; i++) {
    app.renderFrame()
  }
  const elapsed = performance.now() - start
  
  // Should achieve at least 30 FPS
  const fps = 100 / (elapsed / 1000)
  expect(fps).toBeGreaterThan(30)
})
```

## Success Criteria

Phase 1.4 is complete when:
1. Canvas shows rendered output
2. Sphere visible with normal coloring
3. Sky gradient visible in background
4. FPS counter working
5. No WebGL errors in console
6. Clean shutdown on stop()

## What We're NOT Doing in Phase 1.4

- No parameter controls or UI
- No file loading (all embedded)
- No hot reload or development server
- No production optimizations
- No texture or resource loading
- No multiple recipes
- No session saving
- No screenshots or exports
- No camera controls

## Connection to Phase 2

This minimal app proves our architecture works:
- Modules can be registered and compiled
- Shaders execute correctly
- Pipeline produces expected output
- Performance is acceptable

Phase 2 will add:
- Real path tracing with bounces
- Accumulation for convergence
- Parameter system for tweaking
- Camera controls for navigation

The normal-colored sphere is our "Hello World" - simple but exercises the entire system.

## Debugging Tips

1. **Black screen**: Check console for WebGL errors
2. **No sphere**: Verify camera points at origin
3. **Wrong colors**: Check normal transformation math
4. **Poor performance**: Profile with Chrome DevTools
5. **Compilation errors**: Check module registration order

## Key Architecture Validation

This minimal app validates:
- KIND prefixing works (camera_generateRay, etc.)
- Module concatenation order is correct
- WebGL2 context initialization works
- Full-screen triangle covers viewport
- Ray-sphere intersection is accurate
- Normal visualization helps debug geometry
