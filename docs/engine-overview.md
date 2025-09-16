It tracks:
- Value + type (`float`, `int`, `bool`, `vec2/3/4`, `mat3/4`)
- **Reset policy** (`none` | `accumulation` | `program`)
- Dirty flags + validation

The render loop collects dirty params, applies reset policy, binds via the **UniformBinder**, and marks them clean.

### 5) Resources (Samplers)
The app populates a **ResourceDirectory** with logical sampler bindings each frame (or once). A **TextureUnitPool** deterministically assigns GL units (with LRU + pinning). A **ResourceBinder**:
- Chooses a unit for each logical sampler
- Calls `gl.activeTexture`, `gl.bindTexture`
- Sets the integer sampler uniform via the **UniformBinder**

### 6) Film (GPU)
The Film lives on the GPU (ping-pong). Engine counters (`frameIndex`, `sampleCount`) are driven by the **RenderEngine** and are bound by the **RenderPipeline** iff the manifest includes them. Export to CPU (for image save) is a separate path (“develop”) via `readPixels`.

### 7) Render Pipeline (single pass, for now)
A minimal pipeline that:
- Owns fullscreen VAO/VBO
- Manages the film’s ping-pong (via FramebufferPool)
- Binds engine-level uniforms (`u_resolution`, counters)
- Issues the draw

Future: multi-pass DAG with explicit attachments.

---

## Integration with **Photography** & **World**

### Photography (Camera, Film, Exposure, Post)
- **Camera** feeds uniforms like projection, sensor size, jitter, etc.
- **Film** provides accumulation behavior; its uniforms (e.g., history color, sample count) appear in the manifest and are bound by the pipeline when present.
- **Develop/Export**: an off-line step that reads the GPU film to CPU for saving or further processing. Could later become its own module/recipe.
- **Exposure/Color** can be separate modules (in the same recipe) or later multi-pass.

### World (Scene, Materials, Geometry, Lights)
- World selects the **Material** and **Tracer** modules (and geometry representation modules), assembling a recipe for the current view.
- Textures/IBLs are pushed into the **ResourceDirectory** each frame (or on change) with stable logical names that match module uniforms (e.g., `albedo`, `normalMap`, `env`).
- Geometry modules contribute types/ops; the Material/Tracer use those public symbols.

**Flow of control**:
1. World/Photography decide which modules are active → build a Recipe.
2. Engine compiles & caches program keyed by the link report.
3. App pushes parameter updates into ParameterStore and resource handles into ResourceDirectory.
4. Engine render loop:
    - gather dirty → apply reset policy → bind uniforms → bind samplers → draw
    - update counters, swap film
5. Optional: develop/export path reads the film to CPU.

---
