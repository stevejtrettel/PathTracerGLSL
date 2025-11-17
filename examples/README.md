# Examples

This folder contains example scenes and configurations for the path tracer.

## Structure

Each example is a self-contained folder with:
- `main.ts` - Entry point with app setup and recipes
- `sceneDescription.ts` - Scene geometry and materials description
- `index.html` - HTML entry point

## Running Examples

### Development

**Main example (root):**
```bash
npm run dev
# Visit http://localhost:3000
```

**Simple Scene example:**
```bash
npm run dev
# Visit http://localhost:3000/examples/simple-scene/
```

### Building

```bash
npm run build
```

This builds all examples into `dist/`.

## Available Examples

### simple-scene

A minimal scene demonstrating the SceneCompiler:
- Gray floor plane
- Red diffuse sphere at origin
- Glass sphere offset to the right
- Basic path tracing with direct lighting

**What it demonstrates:**
- TypeScript scene descriptions compiled to GLSL
- Basic SDF objects (planes, spheres)
- Multiple materials (diffuse, glass)
- Two rendering modes (path tracer, albedo view)

**Keyboard controls:**
- `1` - Path tracer mode (full GI)
- `2` - Albedo view (material colors only)
- `R` - Reset accumulator

## Creating New Examples

1. Create a new folder: `examples/my-example/`
2. Add files:
   - `main.ts` - Copy from simple-scene and modify
   - `sceneDescription.ts` - Define your scene
   - `index.html` - Copy from simple-scene
3. Update `vite.config.ts` to add the new entry point:
   ```typescript
   input: {
     main: resolve(__dirname, 'index.html'),
     'simple-scene': resolve(__dirname, 'examples/simple-scene/index.html'),
     'my-example': resolve(__dirname, 'examples/my-example/index.html'),
   }
   ```
