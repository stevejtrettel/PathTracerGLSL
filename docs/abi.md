Got it—here’s a **drop-in replacement** for your `ABI.md` that keeps your original structure and tone, preserves the `// v1` / `// v2` flags, and makes the smallest necessary edits to:

* Remove `current/accum` naming from the public ABI,
* Introduce a semantic **`radiance`** channel between Film → Developer,
* Keep engine internals (scratch, ping-pong) unmentioned in module ABIs.

Paste this over your existing file.

---

# ABI.md — Concise Contracts with `// v1` and `// v2` Flags

This file fixes the **names, signatures, and resource contracts** that let **Engine**, **World**, and **Photography** interoperate.
Research code supplies **GLSL + descriptors**; the Engine assembles a **single minimal program** (no runtime `#ifdef`s), allocates resources, binds parameters, and runs passes.

> ✅ Conventions apply across v1 (One-Shot/bring-up) and v2 (Path Tracing/NEE/RR).
> Comments marked `// v1:` or `// v2:` explain when/why an item is used.

---

## Common Conventions

* All shading is **linear, scene-referred HDR**.
* Geometry may be non-Euclidean; materials must use the **Geometry ABI** for frames & dot products.
* The assembler **prefixes** every exported symbol (`g_<mod>_<name>`); modules write natural names and never hardcode prefixes.
* Parameters are bound via an **immutable per-frame snapshot**; resources (textures/buffers) are declared by **logical name**, **format**, **access**, **lifetime**, and **size**.
* Sampling uses a deterministic **layout** indexed by `(pixel, frame, domain, dimension)`; strategy is swappable, domains are reserved.
* **Film ↔ Developer use semantic channels**. The **required** channel is **`radiance`** (scene-referred, linear). The Engine routes by **channel name**; engine-internal texture names are not part of the ABI. // v1: only `radiance`. // v2: optional AOVs (e.g., `variance`, `albedo`, `normal`, `depth`, `motion`).

---

## Minimal Shared Shader Types

```glsl
struct Ray { vec3 o; vec3 d; };                   // v1/v2: World-space origin & direction (not necessarily unit under metric).

struct Hit {                                      // v1/v2: Result of scene intersection; surface only in v1, can extend in v2.
  bool  valid;
  vec3  p;        // world position
  vec3  n_geom;   // geometry normal (world)
  float t;        // parameter along geodesic (see Geometry ABI)
  int   materialID;
};

struct ScatterEval   { vec3 weight; };            // v1/v2: Interaction evaluation packed as multiplicative weight for throughput.
struct ScatterSample { vec3 wi; vec3 weight; float pdf; int flags; }; // v2: Sampled incoming dir; flags encode lobe types for MIS.

struct LightPick   { int id; float pmf; };        // v2: Discrete light selection with probability mass (for NEE/MIS).
struct LightSample { vec3 L; vec3 wi; float dist; float pdf; }; // v2: Radiance & direction from light sample seen at x.

struct SampleStream { uint _a; uint _b; };        // v1/v2: Opaque RNG state; accessed only via next1D/next2D.
```

---

## Geometry ABI (World → Tracer/Materials)

```glsl
void localFrame(in vec3 p, in vec3 n_geom, out mat3 TBN, out float metricDet);
// v1: Euclidean implementation is fine; lets materials form a shading frame.
// v2: Uses the actual metric; materials compute cosines/dots via this frame (non-Euclidean correct).

vec3 toLocal(in vec3 w_world, in mat3 TBN);
vec3 toWorld(in vec3 w_local, in mat3 TBN);
// v1: Convenience transforms for shading math.
// v2: Required to keep interactions metric-aware and geometry-agnostic.

Ray geodesicStep(Ray r, float dt);
// v1: Trivial o+dt*d (Euclidean); parameterization can be affine.
// v2: Real geodesic transport per geometry; document whether t is affine or metric arc-length.

float geometryTerm(in vec3 xi, in vec3 wi, in vec3 xo, in vec3 wo);
// v1: Not used (no NEE), can stub to Euclidean G.
// v2: Used by NEE/MIS; returns generalized G(x↔y) under the metric.

bool connectPoints(in vec3 x, in vec3 y, out vec3 wi_x, out vec3 wo_y, out float G_xy);
// v1: Optional; return false and tracer will skip finite-light NEE.
// v2: Enables exact two-point geodesic connections where analytic/feasible (Euclidean/spherical/hyperbolic).

bool occludedSegment(in vec3 x, in vec3 y);
// v1: Optional; can fall back to standard visibility along straight ray.
// v2: Tests visibility along the actual geodesic segment between x and y when connectPoints succeeds.
```

---

## Scene Intersector ABI (World → Tracer)

```glsl
Hit sceneIntersect(Ray r);
// v1: May be implemented via SDF marching or simple analytic shapes.
// v2: Facade over BVH/hybrid intersectors; tracer code stays identical.
```

```glsl
float sceneSDF(vec3 p);
// v1: Optional if you choose marching; used by simple tracers.
// v2: Still optional; mesh paths typically skip this in favor of BVH traversal.
```

*CPU→Engine resource descriptors:* packed node/primitive arrays, material tables, etc.; engine uploads & binds.
// v1: Usually none or tiny.
// v2: BVH, instance transforms, and light tables become common.

---

## Surface & Medium Interactions (Materials/Media → Tracer)

```glsl
// Surface interaction via materialID
ScatterEval   scatter_eval  (int materialID, vec3 p, mat3 TBN, vec3 wi_world, vec3 wo_world);
// v1: Can be used for one-hit shading (direct camera view or simple direct light).
// v2: Core of PT throughput; must respect metric frame.

ScatterSample scatter_sample(int materialID, vec3 p, mat3 TBN, vec3 wo_world, vec2 u);
// v1: Not required (no bounces).
// v2: Samples next direction; flags mark delta/glossy/diffuse/transmission for MIS.

float         scatter_pdf   (int materialID, vec3 p, mat3 TBN, vec3 wi_world, vec3 wo_world);
// v1: Not required.
// v2: Needed for MIS and unbiased estimators.
```

```glsl
// Medium (optional)
ScatterEval   phase_eval   (int mediumID, vec3 p, vec3 wi_world, vec3 wo_world);
// v1: Omit; no participating media.
// v2: Adds volumetric support (Henyey-Greenstein, etc.).

ScatterSample phase_sample (int mediumID, vec3 p, vec3 wo_world, vec2 u);
float         phase_pdf    (int mediumID, vec3 p, vec3 wi_world, vec3 wo_world);
// v1: Omit.
// v2: Enables volumetric path tracing with MIS.
```

---

## Lights ABI (World.Lights → Tracer)

```glsl
LightPick   light_pick(vec3 x, vec2 u_pick);
// v1: Optional (no NEE).
// v2: Picks a finite or analytic light with PMF conditioned on shading point x.

struct LightPoint { vec3 y; vec3 ny; float pdf_area; vec3 Le; };
LightPoint  light_sample_point(int lightID, vec3 x, vec2 u_dir);
// v1: Optional.
// v2: Samples a point on a finite light’s surface; pdf w.r.t. area at the light.

vec3        light_eval_from_point(int lightID, vec3 y, vec3 ny, vec3 wo_y);
// v1: Optional.
// v2: Emitted radiance leaving y toward x (via wo_y from connectPoints).

vec3  environmentRadiance(vec3 dir);
float environmentPdf     (vec3 dir);
// v1: Useful for simple one-shot/environment captures.
// v2: Used for NEE with environment; no two-point solve required.
```

*Policy:* Finite lights should bind to scene geometry when possible (coherent visibility, sampling, appearance).
// v1: You can skip finite-light NEE; pure PT or direct env is fine.
// v2: Use `connectPoints` (when available) to form the two-point contribution; otherwise skip finite-light NEE in those geometries.

---

## Camera ABI (Photography.Camera → Tracer)

```glsl
Ray generateRay(ivec2 pixel, inout SampleStream s);
// v1: The only required camera function; may internally sample lens/time as you like.
// v2: Still used; thin-lens/temporal effects can remain inside here for eye-path spawning.
```

```glsl
struct CameraSample { Ray ray; vec2 raster; float We; float pdf; };
CameraSample cameraSample(ivec2 pixel, vec2 u_lens, float u_time);
// v1: Optional; omit unless you want explicit DOF/time control early.
// v2: Enables BDPT/VCM: returns emitted ray, importance We, and the correct sampling pdf from the camera.

struct CameraEval { float We; float pdf; vec2 raster; };
CameraEval cameraEval(vec3 x, vec3 wo);
// v1: Optional.
// v2: Evaluates camera importance of a world-space configuration (needed when connecting light subpaths to the camera).
```

---

## Sampler ABI (Photography.Sampler → Tracer/Camera)

```glsl
void  initStream(ivec2 pixel, int frame, out SampleStream s);
// v1: Seeds deterministic stream from (pixel, frame).
// v2: Same; stream layout expands to more domains.

float next1D(inout SampleStream s, int domain);
vec2  next2D(inout SampleStream s, int domain);
// v1: Domains: lens, time, misc (basic needs).
// v2: Adds: bsdf_select, bsdf_dir, nee_light_pick, nee_dir, rr (one-per-bounce allocations).
```

*Strategy is module-specific (RNG, Sobol/Halton+Owen, blue-noise); domain indices come from the Engine to prevent overlap.*
// v1: Keep it simple (RNG).
// v2: Swap strategies without touching tracers; determinism preserved.

---

## Tracer ABI (Photography.Tracer → Engine)

```glsl
vec3 tracePixel(ivec2 pixel, int frame, inout SampleStream s);
// v1: One-shot estimator (env capture, single hit, or debug normals/depth).
// v2: Unidirectional PT with bounce loop, NEE, and RR; calls World/Geometry/Scatter/Lights ABIs.
```

*Scratch resources via descriptors (TypeScript side).*
// v1: None required.
// v2: Optional per-pixel/persistent buffers (e.g., RNG offsets, reservoirs).

---

## Film ABI (Photography.Film → Engine)

```glsl
vec4 accumulate(
  vec2 uv,
  sampler2D u_prevRadiance,     // v1: Passthrough may ignore
  sampler2D u_traceRadiance,    // per-frame tracer radiance provided by Engine
  int frameCount);
// v1: Passthrough Film returns texture(u_traceRadiance, uv).
// v1: SimpleAverage Film returns (prev*frame + curr)/(frame+1).
// v2: Same entrypoint; Film may also manage additional AOVs via extra passes (see descriptors).
```

**Channel contract**: Film **publishes** a semantic channel named **`radiance`** (format typically `rgba16f`).
// v1: required (or synthesized by Engine if Film is disabled).
// v2: required; Film may produce additional channels like `variance`, `albedo`, `normal`, etc.

*Engine internals:* ping-pong textures and any “current/prev” names are **not** part of this ABI; the Engine handles them privately.

```glsl
float updateVariance(vec2 uv, sampler2D u_prevRadiance, sampler2D u_traceRadiance, int frameCount);
// v1: Optional; not needed.
// v2: Tracks variance AOV for convergence/adaptive sampling (if Film declares a 'variance' channel).
```

---

## Developer ABI (Photography.Developer → Engine)

```glsl
// Engine binds Film's 'radiance' channel here by name
uniform sampler2D g_dev_radiance;

vec4 toneMap(vec4 hdr);
// v1: Linear → sRGB (simple gamma) for on-screen display.
// v2: Swap module for Filmic/ACES/exposure controls; call site unchanged.
// v2: Developer may also request optional AOVs (e.g., g_dev_variance) if declared in its descriptor.
```

*Channel routing:* The Engine binds Developer samplers as `g_dev_<channel>` based on Film outputs (by channel name).
// v1: Developer requires `radiance` only.
// v2: Developer may list extra channels; build fails if Film doesn’t provide them.

---

## Engine–Module Descriptors (TypeScript side)

```ts
interface ResourceDecl {
  name: string; // logical
  kind: 'texture2D'|'texture2DArray'|'buffer';
  format: 'rgba16f'|'r32f'|'rg16f'|string;
  access: 'read'|'write'|'readwrite';
  lifetime: 'per_frame'|'persistent';
  size: { expr: 'resolution'|'custom', width?: number, height?: number, layers?: number };
}
// v1: Minimal; engine-managed tracer scratch + film radiance target.
// v2: Add tracer scratch (e.g., reservoirs) and packed scene/light tables.

interface UniformDecl {
  name: string; type: 'float'|'int'|'bool'|'vec2'|'vec3'|'vec4'|'mat3'|'mat4';
  cadence: 'static'|'on_resize'|'per_frame';
}
// v1: A handful (fov, env color).
// v2: More controls (maxBounces, useNEE, rrStart, exposure).

interface EntryPointDecl { name: string; stage: 'fragment'|'vertex'; }
// v1: tracePixel, accumulate, toneMap (fragment).
// v2: Same plus optional cameraSample/cameraEval; still fragment-side.

interface FilmChannelDecl {
  name: string;                   // e.g., 'radiance', 'variance'
  format: 'rgba16f'|'r32f'|string;
}

interface FilmDescriptor {
  id: string; version: string;
  provides: EntryPointDecl[];     // e.g., [{name:'accumulate',stage:'fragment'}] or [] for NoFilm
  outputs: FilmChannelDecl[];     // v1: at least { name:'radiance', format:'rgba16f' }
  uniforms?: UniformDecl[];
  resources?: ResourceDecl[];
  glsl: string;
}

interface DeveloperDescriptor {
  id: string; version: string;
  provides: EntryPointDecl[];     // e.g., [{name:'develop',stage:'fragment'}]
  requiresChannels: string[];     // v1: ['radiance']
  optionalChannels?: string[];    // v2: e.g., ['variance','albedo','normal']
  uniforms?: UniformDecl[];
  glsl: string;
}

interface ModuleDescriptor {
  id: string; version: string;
  provides: EntryPointDecl[];
  requires: string[];            // symbol names this module calls (e.g., sceneIntersect)
  uniforms?: UniformDecl[];
  resources?: ResourceDecl[];
  glsl: string;
}
// v1: Keeps wiring honest even when concatenating minimal fragments.
// v2: Prevents missing-provider bugs as modules multiply.
```

**Assembler/validation additions**

* Build fails if `Developer.requiresChannels` are not all present in `Film.outputs` (or synthesized by Engine when Film is disabled).
  // v1: Engine synthesizes `radiance` from tracer output when Film is NoFilm.
  // v2: No implicit aliases; missing channels are errors.

**Feature Hash (program cache key)**

* Hash of ordered `(module.id@version)`, declared `resources.format`, constants affecting code shape, and a coarse **resolution bin**.
  // v1: Optional; rebuilds are cheap at small scale.
  // v2: Important to avoid recompiling on mere uniform changes.

---

## Engine Pass ABI (execution order & bindings)

* **Trace Pass** → per-frame tracer output (engine-internal).
  // v1: Runs `tracePixel`; Engine exposes this as `u_traceRadiance` to Film.
  // v2: Same entrypoint; tracer may also write aux targets (declared separately).

* **Film Pass** → publishes semantic channels (at least `radiance`).
  // v1: Passthrough Film returns tracer output; SimpleAverage accumulates.
  // v1: If Film is disabled (NoFilm), Engine routes tracer output directly as `radiance` and skips this pass.
  // v2: Film may update additional AOVs (e.g., `variance`) via extra functions/passes.

* **Develop/Present Pass** → screen/export.
  // v1: Developer samples `g_dev_radiance` and tone-maps to default framebuffer.
  // v2: Same call site; different tone mapping or extra AOVs if requested.

Bindings are by **logical resource names** and **channel names**; Engine prefixes uniforms and binds by reflection.
// v1: Few bindings; easy to debug.
// v2: More bindings; still uniform thanks to descriptors.

---

## Reserved Engine Uniforms

```glsl
uniform vec2  g_sys_resolution;  // v1/v2: framebuffer size in pixels
uniform int   g_sys_frame;       // v1/v2: zero-based frame counter
uniform float g_sys_time;        // v1/v2: seconds since start (optional use)
```

---

## Reserved Sample Domains

* **v1 domains:** `lens`, `time`, `misc`
  // v1: Enough for thin-lens/time stubs and general noise.

* **v2 domains:** `bsdf_select`, `bsdf_dir`, `nee_light_pick`, `nee_dir`, `rr`
  // v2: One-per-bounce allocation; ensures non-overlap and deterministic sampling for MIS.

---

## Build-Time Validation (Assembler)

Build **fails** if:

* A module `requires` a symbol that no active module `provides`. // v1/v2: Early catch for missing world/geometry functions.
* Two modules `provide` the same entry point (e.g., two `tracePixel`). // v1/v2: Avoid ambiguous wiring.
* A declared resource requests an unsupported format for the device. // v1/v2: Capability gating.
* A parameter binds to a nonexistent uniform after prefixing/reflection. // v1/v2: Prevent silent no-ops.
* **Developer requires a channel not produced by Film (or synthesized by Engine for `radiance`).** // v1/v2: Channel routing is explicit.

---

## Upgrade Notes (v1 → v2)

* **You can ship v1** with just: `generateRay`, `tracePixel`, **Film publishing `radiance`** (or NoFilm), `toneMap`, basic `sceneIntersect`, and optional `environmentRadiance`.
* **Enable v2** by adding: scatter sample/pdf, lights pick/sample/eval/pdf, geometry `connectPoints`, extra sample domains, and (optionally) Film AOVs such as `variance`.
* Signatures above **do not change** between v1 and v2; you only implement more of them and declare the needed channels/resources.
