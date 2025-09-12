# ProgramBuilder

The **ProgramBuilder** encapsulates shader assembly and program compilation.
It takes a set of plugins, resolves dependencies, and returns a ready-to-use pipeline.

---

## Responsibilities
- Gather GLSL chunks from all plugins.
- Topologically order chunks by dependencies.
- Ensure required entry points exist (integrator, display, etc.).
- Prefix uniforms per plugin namespace.
- Generate a complete fragment shader with a stable `main()`.
- Compile and cache a `ShaderProgram`.
- Build and return a `CompiledPipeline` object.

---

## Input / Output

### Input
- **Plugins**: Active set for base or variant (excluding controls).
- **Vertex source**: Provided at Tracer construction.

### Output: `CompiledPipeline`
```ts
interface CompiledPipeline {
  program: ShaderProgram
  plugins: Plugin[]
  nsViews: Map<string, UniformManager> // one per plugin namespace
}
```

---

## Build Process

1. **Chunks**: Call `p.chunks()` once per plugin, cache results.
2. **Uniforms**: Collect `p.uniforms()`, generate prefixed names.
3. **Dependency resolution**: Sort chunks with `DependencyResolver`.
4. **Geometry priority**: Force `geometry.types` + `geometry.ops` first.
5. **Contracts**: Verify required chunks:
   - `camera.generateRay`
   - `integrator.integrate`
   - `display.display`
6. **Assemble**: Concatenate header, uniform declarations, chunk sources, and `main()`.
7. **Cache**: Create/reuse `ShaderProgram` via `ProgramCache`.
8. **Uniform managers**: For each plugin namespace, create a scoped `UniformManager`.

---

## API
```ts
new ProgramBuilder(gl, vertexSrc)

builder.build(plugins: Plugin[]): CompiledPipeline
builder.dispose() // release cached programs
```

---

## Example
```ts
const builder = new ProgramBuilder(gl, fullscreenVert);
const compiled = builder.build([camera, scene, integrator, display]);

compiled.program.use();
const camView = compiled.nsViews.get("cam.pinhole");
camView?.set3f("cam_pos", 0, 0, 0);
```

---

## Notes
- Program cache key = list of plugin namespaces + hash of fragment source.
- Each plugin’s uniforms are automatically prefixed:
  - `cam.pinhole` → `u_cam_pinhole_*`
- Chunks never declare uniforms directly.
- Geometry is always assembled first for consistent type availability.
- Error on duplicate namespaces or chunks.

---

## Next Steps
- Support multipass pipelines (build multiple programs).
- Add accumulation globals (`u_history`, `u_sampleCount`, etc.) when system is ready.
- Hot reload: rebuild program without losing parameter state.
