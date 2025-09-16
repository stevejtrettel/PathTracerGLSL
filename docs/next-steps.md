
# NEXT\_STEPS.md — Bring-Up Plan to First Image

## Goal

Get the engine rendering a simple scene on a real `<canvas>` using the deterministic recipe pipeline you’ve built (no mocks). Then iterate to path tracing.

Deliverables:

1. **Hello Engine**: solid color + gradients via shader modules (no textures).
2. **Uniforms & Parameters**: tweak `albedo`, watch accumulation reset.
3. **Texture Sampling**: bind a 2D texture via `ResourceDirectory`.
4. **Film Accumulation v1**: ping-pong average (frame counter, sample count).
5. **Minimal Path Tracer Skeleton**: primary rays + environment probe.

---

## What Already Exists (assumptions)

* Deterministic **shader compiler** (linker + namespacing) with `UniformManifest`.
* **ProgramKey** + **cache interface**.
* **ParameterStore** with kinds + **resetPolicy** (`none | accumulation | program`).
* **UniformBinder** + **ResourceDirectory** + **TextureUnitPool** + **ResourceBinder**.
* **RenderEngine** wrapping the above (single-pass fullscreen).
* Strong **unit/integration tests** for each subsystem.

We’ll add the missing “real” runtime pieces and a minimal “hello world” scene.

---

## Milestone Plan (do in order)

### M0. Runtime Glue (real, not mocks)

**Create** `src/engine/runtime` pieces (simple, production-lite):

* `program-cache.ts`

    * `getOrCreate(key, vs, fs): WebGLProgramLike`
    * Compiles/links on cache miss, stores in a `Map`.
    * Acceptance: compiles the output of `compileRecipe`; second call reuses program.

* `framebuffer-pool.ts`

    * Keeps one RGBA16F (or RGBA8 as fallback) color target + FBO (realloc on size).
    * API:

        * `ensureSize(w,h)`
        * `pair(): { readTex, writeFbo }` → for now, return `{ null, null }` if you don’t use ping-pong yet.
        * `swap()` no-op initially.
        * `clear()` gl.clear on default FB for now (good enough).
    * Acceptance: resize safe, no GL errors.

* `render-pipeline.ts` (+ factory)

    * Owns a VAO for a fullscreen triangle.
    * Caches uniform locations for engine counters (`u_frameIndex`, `u_resolution`, `u_sampleCount` if used later).
    * Methods:

        * `setFrameIndex(i: number)`
        * `setSampleCount(n: number)`
        * `render(w: number, h: number)`
        * `dispose()`
    * Acceptance: draws a full-screen quad/triangle with the compiled fragment.

> Keep these minimal; they just need to run one pass reliably.

---

### M1. Hello Engine (solid color / gradient)

**Modules**

* `Material/Lambert@1.0.0`

    * `fragment.uniforms`: `uniform vec3 albedo;`
    * `fragment.functions`: `vec3 shadePixel(vec2 frag){ return albedo; }`
    * `fragment.provides`: `["shadePixel"]`
    * `fragment.entrypoints`: `{ fragmentMain: "shadePixel" }`
    * `parameters`: `[ { name:"albedo", kind:"vec3", default:[0.8,0.2,0.2], resetPolicy:"accumulation" } ]`

* `Tracer/Flat@1.0.0`

    * `fragment.functions`:

      ```glsl
      vec3 integrateSample(vec2 p){ return vec3(p, 0.5); }
      ```
    * `fragment.provides`: `["integrateSample"]`

* (Optional) mix inside `Lambert` main:

  ```glsl
  vec3 shadePixel(vec2 frag){
    vec2 uv = frag / u_resolution; 
    return albedo * vec3(uv, 1.0);
  }
  ```

**Recipe**

```ts
const rec = {
  modules: [lambert, flat],
  entry: { name: "shadePixel" },
};
```

**Wire Up (browser)**

```ts
const canvas = document.getElementById("c") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2")!;
const cache = new ProgramCache(gl);
const fboPool = new FramebufferPool(gl);
const pipelineFactory = (gl, program, pool, manifest) =>
  new RenderPipeline(gl, program, pool, manifest);

const engine = new RenderEngine(gl, cache, fboPool, pipelineFactory);

// Set parameter
engine.getParameterStore().set("Material/Lambert@1.0.0", "albedo", [0.9, 0.1, 0.1]);

// Draw
engine.render(canvas.width, canvas.height, rec);
```

**Acceptance**

* You see a red-tinted gradient. Changing `albedo` then calling `render` resets accumulation and changes color.

---

### M2. Parameters & Reset Policy

* Confirm `resetPolicy:"accumulation"` clears film:

    * Render → change `albedo` → render → verify counters reset (via onRenderStats hook or public getters if present).
* Add a parameter with `resetPolicy:"program"` (e.g., toggling a function signature):

    * Ensure engine disposes pipeline and recompiles (new ProgramKey).
* Add unit tests for these through the public engine API.

---

### M3. Texture Sampling

**Goal**: bind a 2D texture via the **ResourceDirectory** path.

* Extend `Lambert`:

  ```glsl
  uniform sampler2D albedoMap;
  vec3 shadePixel(vec2 frag) {
    vec2 uv = frag / u_resolution;
    vec3 tex = texture(albedoMap, uv).rgb;
    return tex;
  }
  ```
* App code:

  ```ts
  const dir = new ResourceDirectory();
  const tex = await loadTexture2D(gl, "checker.png");
  dir.set("albedoMap", { texture: tex, target: gl.TEXTURE_2D, pin: true });
  engine.setResourceDirectory(dir);
  engine.render(w, h, rec);
  ```
* Acceptance:

    * Texture visible.
    * Diagnostics show `boundSamplers: 1`, `skippedSamplers: []`, `errors: []`.

**Notes**

* Ensure your `RenderEngine` calls `ResourceBinder` each frame when `resourceDir` is present (you already have this).
* `TextureUnitPool` size 8 is fine; `pin` ensures stability.

---

### M4. Film Accumulation v1 (ping-pong average)

* Add engine counters uniform support in the fragment prelude:

    * You already set `u_frameIndex`; add `u_sampleCount` if needed.
* Implement simple exponential moving average in fragment main:

    * **v1**: Just show the per-frame color; **v1.5** (soon): average with last frame.

**Quick path (engine-side)**

* For now, keep single target draw; simulate accumulation by using `frameIndex` to darken bias (visual cue). This keeps scope small for first image.

**Next step (real ping-pong)**

* Upgrade `FramebufferPool` to allocate two RGBA16F textures and an FBO:

    * `pair()` returns `{ readTex, writeFbo }`.
    * Pipeline binds `readTex` as `u_historyColor` (if present in manifest) and renders to `writeFbo`.
    * Shader blends `history` and `current`.
    * `swap()` flips.
* Acceptance:

    * Noise converges over frames (when tracer adds randomness).
    * Reset policy clears history (pool.clear()).

---

### M5. Minimal Path Tracer Skeleton

Add modules:

* `Camera/Pinhole@1.0.0`

    * `uniforms`: `uniform float u_fov;`
    * `provides`: `["generateRay"]`
    * `functions`: `Ray generateRay(vec2 frag){ /* map pixel to ray */ }`
    * `parameters`: `[ { name:"u_fov", kind:"float", default:60, min:1, max:179, resetPolicy:"accumulation" } ]`

* `Scene/EnvMap@1.0.0`

    * `uniforms`: `uniform sampler2D u_env;`
    * `provides`: `["sampleEnvironment"]`
    * `functions`: `vec3 sampleEnvironment(vec3 dir){ /* sample equirect */ }`

* `Tracer/Primary@0.1.0`

    * `requires`: `["generateRay","sampleEnvironment"]`
    * `provides`: `["shadePixel"]`
    * `functions`:

      ```glsl
      vec3 shadePixel(vec2 frag) {
        Ray r = generateRay(frag);
        return sampleEnvironment(r.dir);
      }
      ```
    * `entrypoints`: `{ fragmentMain: "shadePixel" }`

Wire env texture through `ResourceDirectory` (e.g., `"u_env"`), render. This gives a “path tracing feel” without intersections yet.

**Acceptance**

* Rotating FOV changes projection; environment shows up.
* Accumulation works across frames.

---

## Tasks & Checklists

### T1. Implement `ProgramCache`

* [ ] Create program on cache miss (compile, link).
* [ ] Return stable wrapper to satisfy `ProgramLike`.
* [ ] Unit test: reusing same key returns same program instance.

### T2. Minimal `FramebufferPool`

* [ ] Create FBO + color texture on `ensureSize(w,h)`.
* [ ] Clear on `clear()`.
* [ ] No-op `pair()`/`swap()` for M1–M3.
* [ ] Unit test: reallocate on size change; `clear()` calls gl.clear.

### T3. Minimal `RenderPipeline`

* [ ] Create VAO for fullscreen triangle.
* [ ] Cache engine uniform locations (`u_resolution`, `u_frameIndex`).
* [ ] Set counters and draw.
* [ ] Unit test: render() called with correct size; no GL errors (if you have a GL harness).

### T4. Hello Modules & Recipe

* [ ] Author `Lambert` + `Flat` modules per M1.
* [ ] Render to canvas; change parameters.
* [ ] Unit test: parameter change triggers accumulation reset (via engine stats or counters).

### T5. Sampler Binding

* [ ] Author `albedoMap` sampler in module.
* [ ] Load texture, set in `ResourceDirectory`, call `engine.setResourceDirectory(dir)`.
* [ ] Integration test: diagnostics `boundSamplers: 1`.

### T6. Film Accumulation v1.5

* [ ] Upgrade `FramebufferPool` to ping-pong.
* [ ] Add optional `u_historyColor` in shader prelude (or as a module).
* [ ] Blend `history` and `current`.
* [ ] Reset clears both and zeros counters.
* [ ] Integration test: frame N ≠ frame 0; reset after param change.

### T7. Minimal Path Tracer Skeleton

* [ ] Add `Camera/Pinhole`, `Scene/EnvMap`, `Tracer/Primary`.
* [ ] Load env texture via `ResourceDirectory`.
* [ ] Render; verify FOV param works, env visible.

---

## Reference Snippets

### Fullscreen Triangle (pipeline)

```ts
const vs = `#version 300 es
const vec2 POS[3] = vec2[](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);
out vec2 v_uv;
void main(){
  vec2 p = POS[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
```

### Fragment Prelude (engine)

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_resolution;
uniform int  u_frameIndex;
```

### Main Wrapper (engine)

```glsl
void main(){
  vec3 color = shadePixel(gl_FragCoord.xy);
  outColor = vec4(color, 1.0);
}
```

---

## Risk Notes & Pragmatic Defaults

* **Texture formats**: Start with `RGBA8` if float attachments hiccup; it’s fine for bring-up.
* **Timer queries**: Skip until we have images; add later for perf.
* **Sampler types**: If manifest lacks explicit sampler type, assume `sampler2D` (your binder path already tolerates this).
* **Resize**: Recreate FBO on demand; avoid clever policies initially.
* **Accum reset**: Prefer correctness (clear film) over preserving samples if anything nontrivial changes.

---

## Definition of “Done” for This Bring-Up

1. **Hello Engine** renders gradient tinted by `albedo` parameter.
2. **Parameter change** with `resetPolicy:"accumulation"` visibly resets film counters.
3. **Texture** appears via `albedoMap` bound through `ResourceDirectory` (diagnostics show 1 bound).
4. **(Optional) Ping-pong** averaging works; reset clears history.
5. **Primary tracer** renders an environment map through a pinhole camera.

---

## Stretch (nice to have)

* Quick **UI slider** bound to ParameterStore (`albedo`, `u_fov`).
* A tiny **diagnostics overlay**: program key, frame/sample count, bound/Skipped samplers.
* A **screenshot/export** button pulling from the default framebuffer.

---

If you want, I can follow this by generating the exact file stubs (headers + minimal bodies) for `program-cache.ts`, `framebuffer-pool.ts`, and `render-pipeline.ts`, plus the M1 modules and a tiny `examples/hello-engine.ts` bootstrap so you can run this in the browser immediately.
