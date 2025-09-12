# Tracer System Documentation

## Overview

The Tracer is the main orchestrator for the path tracing/ray marching system. It manages the complete rendering pipeline from plugin registration through shader compilation to frame rendering.

## Architecture

### Core Components

- **Engine**: Manages plugins by role (one active plugin per role except "lib")
- **ShaderAssembler**: Builds fragment shaders from plugin chunks, handles uniform prefixing
- **ProgramCache**: Caches compiled WebGL programs to avoid recompilation
- **ParameterManager**: Manages user-facing parameters with metadata for UI generation
- **UniformManager**: Sets GPU uniforms with namespace prefixing
- **FullscreenQuad**: Renders a fullscreen quad for fragment shader execution

### Data Flow

```
Plugin Registration → Shader Assembly → Program Compilation → Frame Rendering
                           ↓
                    Parameter System
                           ↓
                    Uniform Binding
```

## API Reference

### Constructor

```typescript
new Tracer({ canvas: HTMLCanvasElement, vertexSrc: string })
```

### Plugin Management

```typescript
tracer.use(plugin: Plugin): Tracer
```
Registers a plugin. Special handling for:
- **Controls plugins**: Don't participate in shader generation
- **Library plugins**: Multiple can be active simultaneously
- **Other roles**: One active plugin per role

```typescript
tracer.clear(role: Role): Tracer
```
Removes the active plugin for a role.

### Context Management

```typescript
tracer.setContext(ctx: Partial<PipelineContext>): Tracer
```
Sets pipeline context (e.g., geometry frame) that plugins can access during uniform binding.

### Parameter System

```typescript
tracer.setParameter(namespace: string, name: string, value: any): Tracer
```
Programmatically sets a parameter value.

```typescript
tracer.getParameterManager(): ParameterManager
```
Returns the parameter manager for UI generation or direct manipulation.

```typescript
tracer.saveParameters(): Record<string, Record<string, any>>
tracer.loadParameters(data: Record<string, Record<string, any>>): Tracer
```
Save/restore parameter state for persistence.

### Building and Rendering

```typescript
tracer.build(): Tracer
```
Assembles shaders from registered plugins and compiles the WebGL program. Must be called after all plugins are registered and before rendering.

```typescript
tracer.setSize(width: number, height: number): Tracer
```
Sets the viewport size in device pixels. Should be called when canvas resizes.

```typescript
tracer.frame(): void
```
Renders one frame. Execution order:
1. Update controls (if present) - modifies context
2. Apply parameters to plugin state
3. Apply uniforms from plugin state
4. Draw fullscreen quad

### Cleanup

```typescript
tracer.dispose(): void
```
Releases all WebGL resources.

## Frame Rendering Pipeline

During each `frame()` call:

1. **Controls Update** (if controls plugin present)
    - Calculates delta time
    - Calls `update(ctx, dt)` on controls plugin
    - Modifies context (e.g., camera position)

2. **Parameter Application**
    - For each plugin with `applyParameters()`
    - Updates plugin internal state from parameter values
    - Parameters may read from context

3. **Shader Activation**
    - Activates the compiled WebGL program

4. **Uniform Binding**
    - Sets global uniforms (`u_resolution`)
    - For each plugin with `applyUniforms()`
    - Applies uniforms using prefixed namespace views

5. **Draw**
    - Renders the fullscreen quad

## Plugin Roles

- **geometry**: Provides geometry types and operations (required)
- **camera**: Provides `generateRay()` function (required)
- **integrator**: Provides `integrate()` function (required)
- **display**: Provides `display()` function for tone mapping (required)
- **scene**: Provides scene description (optional)
- **lib**: Helper libraries (multiple allowed)
- **controls**: Input handling (optional, CPU-only)

## Uniform Namespacing

Each plugin's uniforms are automatically prefixed:
- Plugin namespace: `cam.pinhole`
- Uniform name: `cam_fovY`
- GPU name: `u_cam_pinhole_cam_fovY`

This prevents naming collisions between plugins.

## Future Improvements

### Accumulation System
- Add `u_history` texture uniform for previous frame
- Add `u_sampleCount` for progressive rendering
- Add `u_frame` counter
- Reset accumulation when parameters change (already has hooks via `resetAccumulation` flag)

### Global Uniforms
- `u_time`: Animation time
- `u_frame`: Frame counter
- `u_mouse`: Mouse position for interaction

### Multi-pass Rendering
- Support for render-to-texture
- Multiple render targets
- Post-processing pipeline

### Performance
- Shader hot-reload without losing parameter state
- Async shader compilation
- WebGL2 compute shaders when available

### Developer Experience
- Better error messages with line numbers
- Shader validation before compilation
- Performance profiling hooks
- Debug visualization modes

## Usage Example

```typescript
// Create tracer
const tracer = new Tracer({ canvas, vertexSrc });

// Set up geometry
const { module: geo, frame } = createEuclideanModule();
tracer.use(geo.shader);
tracer.setContext({ geometry: { runtime: geo.runtime, frame } });

// Add plugins
tracer
  .use(new PinholeCameraPlugin({ 
    fovYDeg: 60,
    parameters: ['fov']  // Expose FOV as parameter
  }))
  .use(new SceneSDFDemoPlugin())
  .use(new LambertIntegrator())
  .use(new SRGBDisplayPlugin())
  .build();

// Handle resizing
function resize() {
  const dpr = window.devicePixelRatio;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  tracer.setSize(canvas.width, canvas.height);
}

// Render loop
function animate() {
  tracer.frame();
  requestAnimationFrame(animate);
}
```
