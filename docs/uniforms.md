
# UniformManager

## Overview

UniformManager provides a clean abstraction for setting WebGL uniforms with automatic namespace prefixing. It caches uniform locations and provides type-safe setters.

## Design Philosophy

- **Prefix scoping**: Each plugin's uniforms are prefixed to avoid collisions
- **Location caching**: Uniform locations are looked up once and cached
- **Graceful failure**: Missing uniforms log warnings but don't crash
- **Convenience methods**: Type-specific setters for common uniform types

## Constructor

```typescript
new UniformManager(
    gl: WebGL2RenderingContext,
    program: ShaderProgram,
    prefix: string = "",
    logMissing: boolean = false
)
```

- **gl**: WebGL context
- **program**: Compiled shader program
- **prefix**: Namespace prefix (e.g., "u_cam_pinhole_")
- **logMissing**: Whether to log warnings for missing uniforms (useful for development)

## Methods

### `withPrefix(prefix: string): UniformManager`
Creates a new UniformManager with a different prefix, sharing the same program.

```typescript
const global = new UniformManager(gl, program, "");
const camera = global.withPrefix("u_cam_pinhole_");
```

### Uniform Setters

All setters use local names that get prefixed automatically:

```typescript
// Scalars
set1f(name: string, x: number): void
set1i(name: string, x: number): void

// Vectors
set2f(name: string, x: number, y: number): void
set3f(name: string, x: number, y: number, z: number): void
set2fv(name: string, v: Float32List): void
set3fv(name: string, v: Float32List): void

// Matrices
setMatrix4fv(name: string, m: Float32Array | number[]): void
```

## Prefix System

The prefix system prevents uniform name collisions between plugins:

```typescript
// In plugin (local name)
view.set1f("cam_fovY", 1.0);

// Actual GPU uniform name (with prefix)
// "u_cam_pinhole_cam_fovY"
```

## Usage in Plugins

Plugins receive a pre-scoped UniformManager in `applyUniforms`:

```typescript
class PinholeCameraPlugin implements Plugin {
    applyUniforms(view: UniformManager, ctx?: PipelineContext) {
        // 'view' is already scoped to this plugin's prefix
        view.set1f("cam_fovY", this.fovYRad);  // Local name
        view.set3f("cam_pos", p.x, p.y, p.z);
    }
}
```

## Usage in Tracer

The Tracer creates scoped views for each plugin:

```typescript
// After shader assembly, we know each plugin's prefix
const { fragment, uniforms } = assembler.buildFragment(plugins);

// Create scoped views
for (const [namespace, info] of Object.entries(uniforms)) {
    this.nsViews.set(
        namespace, 
        new UniformManager(gl, program, info.prefix)
    );
}

// During frame rendering
for (const plugin of plugins) {
    const view = this.nsViews.get(plugin.namespace);
    plugin.applyUniforms?.(view, context);
}
```

## Location Caching

Uniform locations are cached after first lookup:

```typescript
private cache = new Map<string, WebGLUniformLocation | null>();

private loc(localName: string): WebGLUniformLocation | null {
    const gpuName = this.prefix + localName;
    
    if (this.cache.has(gpuName)) {
        return this.cache.get(gpuName)!;
    }
    
    const loc = this.program.getUniformLocation(gpuName);
    this.cache.set(gpuName, loc);
    return loc;
}
```

## Error Handling

UniformManager handles missing uniforms gracefully:

- Returns `null` if uniform doesn't exist (may be optimized out)
- Optionally logs warning if `logMissing` is true
- Setter methods silently skip if location is null

This is important because:
1. GLSL compilers optimize out unused uniforms
2. Different shader configurations may have different uniforms
3. Plugins shouldn't crash due to shader optimization

## Global vs Prefixed Uniforms

```typescript
// Global uniforms (no prefix)
const global = new UniformManager(gl, program, "");
global.set2f("u_resolution", width, height);

// Plugin uniforms (prefixed)
const camera = new UniformManager(gl, program, "u_cam_pinhole_");
camera.set1f("cam_fovY", fov);  // → u_cam_pinhole_cam_fovY
```

## Integration Example

Here's how Engine and UniformManager work together in the pipeline:

```typescript
// 1. Engine manages plugins
engine.use(cameraPlugin);
engine.use(integratorPlugin);

// 2. Get plugins for assembly
const plugins = engine.list();

// 3. Assemble shaders (with prefixes)
const { fragment, uniforms } = assembler.buildFragment(plugins);

// 4. Create UniformManagers with correct prefixes
const views = new Map();
for (const [ns, info] of Object.entries(uniforms)) {
    views.set(ns, new UniformManager(gl, program, info.prefix));
}

// 5. Apply uniforms using scoped views
for (const plugin of plugins) {
    const view = views.get(plugin.namespace);
    plugin.applyUniforms?.(view, context);
}
```

## Design Benefits

### UniformManager
- **Namespace isolation**: Plugins can't interfere with each other
- **Performance**: Location caching avoids repeated lookups
- **Developer friendly**: Local names in plugins, automatic prefixing
- **Robustness**: Graceful handling of optimized-out uniforms
