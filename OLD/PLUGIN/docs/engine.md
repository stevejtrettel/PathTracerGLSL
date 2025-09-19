# Engine 

## Overview

The Engine is a minimal plugin registry that manages the active plugins by role. It enforces the single-plugin-per-role constraint (except for "lib" plugins) and provides a clean API for plugin management.

## Design Philosophy

- **Simple and focused**: Just manages plugin registry, nothing else
- **Role-based**: Each role can have exactly one active plugin (except "lib")
- **Type-safe**: Generic methods allow typed plugin retrieval

## API

```typescript
class Engine {
    use(plugin: Plugin): this
    clear(role: Role): void
    get<T extends Plugin>(role: Role): T | undefined
    list(): Plugin[]
    collectChunks(): GLSLChunk[]
    collectUniforms(): UniformDecl[]
}
```

## Methods

### `use(plugin: Plugin): this`
Registers a plugin for its role, replacing any existing plugin with the same role.

```typescript
engine.use(new PinholeCameraPlugin());  // Sets camera
engine.use(new ThinLensCamera());       // Replaces camera
```

### `clear(role: Role): void`
Removes the active plugin for a role.

```typescript
engine.clear("camera");  // Remove current camera
```

### `get<T extends Plugin>(role: Role): T | undefined`
Retrieves the active plugin for a role, with optional typing.

```typescript
const camera = engine.get("camera");
const typed = engine.get<PinholeCameraPlugin>("camera");
```

### `list(): Plugin[]`
Returns all active plugins as an array.

```typescript
const plugins = engine.list();  // For shader assembly
```

### `collectChunks(): GLSLChunk[]`
Collects all GLSL chunks from all active plugins.

```typescript
const chunks = engine.collectChunks();  // Flattened array
```

### `collectUniforms(): UniformDecl[]`
Collects all uniform declarations from all active plugins.

```typescript
const uniforms = engine.collectUniforms();  // Flattened array
```

## Role System

Available roles:
- **geometry**: Geometry types and operations (one active)
- **camera**: Ray generation (one active)
- **integrator**: Color integration (one active)
- **display**: Tone mapping (one active)
- **scene**: Scene description (one active)
- **lib**: Helper libraries (multiple allowed - special case)
- **controls**: Input handling (one active)

## Usage in Tracer

The Tracer uses Engine internally to manage plugins:

```typescript
class Tracer {
    private engine = new Engine();
    
    use(plugin: Plugin): this {
        // Controls handled separately
        if (plugin.role === "controls") {
            this.controlsPlugin = plugin;
        } else {
            this.engine.use(plugin);  // Engine manages the rest
        }
        return this;
    }
    
    build(): void {
        const plugins = this.engine.list();
        // Pass to shader assembler...
    }
}
```


## Design Benefits

### Engine
- **Simplicity**: Just 40 lines of focused code
- **Type safety**: Generic get method preserves types
- **Predictability**: Clear single-plugin-per-role rule
