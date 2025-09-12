

# Integrator Architecture

## What we keep

* **One-shots stay trivial.** Each integrator is its own small class with explicit GLSL and minimal deps. No base class required.
* **Explicit helpers.** `getRNGChunk(...)`, `getAccumChunk(...)` are *requestable utilities*, not auto-injected.
* **BufferManager.** Generic, named textures + MRT binding + lifetime clears.
* **Default pipeline.** **Single pass → blit through display** covers 95% of cases. Multipass is an escape hatch.

---

## Clarified layering

### Level 0: System helpers (stateless, requestable)

* Purpose: small, well-tested GLSL snippets you can include explicitly.
* Examples: Sobol/Hash/PMJ RNG step; box/EMA accumulation; basic BRDFs; sky.
* API:

  ```ts
  getRNGChunk("sobol" | "hash" | "pmj" | "blueNoise"): GLSLChunk
  getAccumChunk("box" | "ema" | "varianceWeighted" | "custom"): GLSLChunk
  ```
* Use: include from integrator or from a submodule. Nothing gets injected automatically.

### Level 1: Submodules (integrator-local, optional)

* Purpose: compose swappable *units with state*, params, and a fingerprint.
* Examples:

    * `SobolSampler` (uses `getRNGChunk("sobol")`, adds scrambling uniforms)
    * `PathEstimator` (path tracing loop + MIS switches)
    * `BoxAccumulator` / `EMAAccumulator` (may expose alpha, etc.)
* Contract (lightweight):

  ```ts
  interface Submodule {
    namespace: string;
    chunks(): GLSLChunk[];
    uniforms?(): UniformDecl[];
    parameters?(): ParameterDescriptor[];
    applyUniforms?(u: UniformManager): void;
    applyParameters?(p: ParameterView): void;
    fingerprint(): string;
    needs?: {
      // reads last-frame or per-frame AOVs by name
      reads?: string[];
      // writes AOVs this frame (names + formats). Integrator collects/declares.
      writes?: TargetDesc[];
    };
  }
  ```
* **Relationship to helpers:** submodules can *use* helpers; helpers do not depend on submodules.

    * ✅ We adopt **Option A** from your note.

### Level 2: Integrator (the thing you author)

* One-shot: just write GLSL.
* Progressive: compose submodules **and** include any helpers you want directly.
* Progressive declares **caps** only for *resources*, not logic:

  ```ts
  interface IntegratorCaps {
    progressive?: boolean;
    extraTargets?: TargetDesc[];   // union of submodules’ needs.writes
    historyCompatHash?: string;    // hash of submodule fingerprints + critical flags
  }
  ```

---

## Display + blit: precise behavior

We support both, but **recommend blit** for progressive work.

### A) Blit path (preferred; future-proof)

* **Integrators return HDR** (no tonemap call).
* Engine renders to a named color target (e.g., `"hdr"` / `"historyColor"`).
* Present step draws a fullscreen quad that samples the source texture and calls the display plugin’s function.

**Display plugin contract (unchanged):**

```glsl
vec3 display(vec3 hdr); // tonemap + transfer (to sRGB-ish)
```

**Present shader (engine-built):**

```glsl
uniform sampler2D u_src;
in vec2 v_uv;
out vec4 outColor;

vec3 display(vec3 hdr); // from postprocess plugin

void main() {
  vec3 hdr = texture(u_src, v_uv).rgb;
  outColor = vec4(display(hdr), 1.0);
}
```

**Engine call:**

```ts
const src = progressive ? "historyColor" : "hdr";
bufferManager.bindAsTexture(src, 0);
presentProgram.use();
presentProgram.set1i("u_src", 0);
fullscreenQuad.draw();
```

### B) Inline display (supported for one-shots)

* Current working one-shots can continue to call `display(color)` inside the integrator shader.
* When you switch an integrator to progressive, flip it to HDR-return + blit. (No changes to the display plugin itself.)

---

## Submodule coordination (state sharing)

* **AOVs = names.** Submodules declare `needs.reads`/`needs.writes` with *logical* target names. The integrator unions these and sets `caps.extraTargets`.
* **BufferManager** creates/binds these names to textures. Across frames, the engine binds *history* textures with stable sampler names:

    * Example bindings in progressive frame:

        * `u_hist_color`, `u_hist_moments`, `u_hist_velocity`
        * `u_rt_albedo`, `u_rt_normal` (per-frame AOVs)
* **Who writes what?** Estimator typically writes *per-frame* AOVs (albedo/normal). Accumulator typically *reads* last frame’s histories (color/moments/velocity) and blends with current frame’s estimate. If an accumulator *also* writes histories (e.g., moments), list them in its `needs.writes`.

> Rule of thumb: **Estimator produces** this-frame evidence; **Accumulator fuses** evidence with history.

---

## Parameters & uniform forwarding

* Integrator merges and namespaces parameters/uniforms from its submodules:

  ```ts
  parameters()  { return [...s.parameters(), ...e.parameters(), ...a.parameters()]; }
  uniforms()    { return [...s.uniforms(),   ...e.uniforms(),   ...a.uniforms()  ]; }
  applyParameters(view) {
    s.applyParameters?.(view.forPrefix(s.namespace));
    e.applyParameters?.(view.forPrefix(e.namespace));
    a.applyParameters?.(view.forPrefix(a.namespace));
  }
  applyUniforms(view) {
    s.applyUniforms?.(view.forPrefix(s.namespace));
    e.applyUniforms?.(view.forPrefix(e.namespace));
    a.applyUniforms?.(view.forPrefix(a.namespace));
  }
  ```
* Your existing `UniformManager`/`ParameterManager` already prefixes by plugin namespace; just expose a `forPrefix(ns)` view helper (thin wrapper that preprends the submodule’s namespace).

---

## Validation & compatibility

* **Caps validation** (compile time):

    * Too many MRT targets for the platform → throw
    * Progressive without any history or accumulation? warn
* **Submodule compatibility checks** (integrator-side):

    * Exactly one sampler & one accumulator
    * If accumulator requires `reads: ["moments"]`, ensure either:

        * Estimator or accumulator writes `moments`, or
        * A previous frame provides it (history) and caps declare it as history.
    * If reprojection is enabled, require velocity/normal (and depth if applicable).
* **ProgramCache key** includes:

    * Fragment GLSL
    * Sorted `caps`
    * **Submodule fingerprints** (sampler/estimator/accumulator)
      → change any of them → new program; also triggers **history reset** via `historyCompatHash`.

---

## Concrete first steps from here

1. **Keep one-shots as-is.** (Inline display or blit—both fine for now.)
2. **Implement BufferManager** (you already have the spec).
3. **Add “progressive simple” integrator**:

    * Caps: `{ progressive: true, extraTargets: [{ name:"hdr", format:"rgba16f", lifetime:"history" }] }`
    * Include `getRNGChunk("hash" | "sobol")` and `getAccumChunk("box")`
    * One sample per frame → box accumulate → return HDR
    * Present via blit (Display plugin unchanged)
4. **Introduce submodules** when the simple PT is stable:

    * Start with `SobolSampler`, `PathEstimator`, `BoxAccumulator`
    * Wire parameter forwarding + fingerprints
5. (Later) **Variance/Moments**, then **Reprojection**, then **Reservoirs**

---

## API snapshot (so future helpers know the exact shapes)

```ts
// BufferManager
create(name: string, desc: BufferDesc): WebGLTexture;
bindAsDrawTarget(names: string[]): WebGLFramebuffer; // MRT
bindAsTexture(name: string, unit: number): void;
swap(a: string, b: string): void;
clearByLifetime("perFrame" | "history"): void;

// Integrator caps
interface TargetDesc { name: string; format: TargetFormat; lifetime: "perFrame" | "history"; filtering?: "nearest" | "linear"; }
interface IntegratorCaps {
  progressive?: boolean;
  extraTargets?: TargetDesc[];
  historyCompatHash?: string;
}

// Helpers (stateless)
getRNGChunk(kind: "hash" | "sobol" | "pmj" | "blueNoise"): GLSLChunk;
getAccumChunk(kind: "box" | "ema" | "varianceWeighted" | "custom"): GLSLChunk;

// Submodules (optional)
interface Submodule {
  namespace: string;
  chunks(): GLSLChunk[];
  uniforms?(): UniformDecl[];
  parameters?(): ParameterDescriptor[];
  applyUniforms?(u: UniformManager): void;
  applyParameters?(p: ParameterView): void;
  fingerprint(): string;
  needs?: { reads?: string[]; writes?: TargetDesc[]; };
}
```

---

## Why this works

* Keeps **one-shot** development frictionless.
* Makes **progressive** explicit, debuggable, and resource-safe.
* Submodules give you **swappability** without framework lock-in.
* BufferManager + blit isolates GPU resource policy from your math.
* The road from “hello normals” to “BDPT with reprojection and reservoirs” is a sequence of **small, safe, testable steps**—not a rewrite.

If you want, I can spin up the minimal progressive PT skeleton next (caps + history + box accumulate + blit), using your current file layout.






## Next Step


Awesome — let’s stand up a **minimal progressive path tracer skeleton** that fits your current engine and keeps the pipeline simple (single pass → blit). I’ll give you:

1. a short engine prep checklist (copy-paste stubs),
2. a tiny `PathTracerMinimal` integrator you can drop in today, and
3. exactly how to wire it.

No hidden injections, no multipass, no surprises.

---

# 0) Engine prep (tiny, surgical)

### 0.1 Reserved globals (add to your shader prelude)

Your assembler already injects `u_resolution`. Add these **unprefixed** globals too:

```glsl
// in your global prelude before concatenating chunks
uniform int u_frameIndex;      // starts at 0, increments each frame unless reset
uniform int u_sampleCount;     // number of samples already accumulated in history
uniform sampler2D u_historyColor; // previous frame’s accumulated HDR (read-only this frame)
```

### 0.2 Counters + history ping-pong (Tracer)

Minimal logic (pseudo-TS where you build/bind before the draw):

```ts
// Tracer.ts (state)
let frameIndex = 0;
let sampleCount = 0;
let historyA = "historyA"; // logical names in your BufferManager
let historyB = "historyB";
let readHistory = historyA;
let writeHistory = historyB;

// call this whenever you must reset accumulation
function resetAccumulation() {
  sampleCount = 0;
  frameIndex = 0;
  bufferManager.clearByLifetime("history");
}

// per-frame (before draw)
program.use(); // your compiled program for the active variant
program.set2f("u_resolution", width, height);
program.set1i("u_frameIndex", frameIndex);
program.set1i("u_sampleCount", sampleCount);

// Bind prev history as a texture for reading
bufferManager.bindAsTexture(readHistory, 0);
// set uniform location for u_historyColor to texture unit 0
program.set1i("u_historyColor", 0);

// Bind draw target (MRT not needed here; single color target)
bufferManager.bindAsDrawTarget([writeHistory]);

// draw the fullscreen quad to produce the NEW accumulated HDR into writeHistory
fullscreenQuad.draw();

// after draw: advance counters + swap ping-pong
frameIndex += 1;
sampleCount += 1;
bufferManager.swap(readHistory, writeHistory);

// Present: blit through your postprocess shader (see §2 below)
presentThroughDisplay(readHistory); // readHistory now holds the freshly written image
```

### 0.3 Buffer(s) creation (on resize / build)

Create two history textures (RGBA16F, lifetime `"history"`) at canvas size:

```ts
bufferManager.create("historyA", { format: "rgba16f", size:{w,h}, lifetime:"history", filtering:"nearest", clear:[0,0,0,0] });
bufferManager.create("historyB", { format: "rgba16f", size:{w,h}, lifetime:"history", filtering:"nearest", clear:[0,0,0,0] });
```

> That’s it. No other engine changes are required for the skeleton.

---

# 1) Minimal progressive integrator

**Key points:**

* single-sample per frame,
* **box accumulation** in-shader (unbiased),
* **hash RNG** (inline; replace with `getRNGChunk("sobol")` later),
* diffuse-only **cosine hemisphere** bounce,
* uses `Scene.Intersect`, `Scene.Normal`, `Scene.Material`, `Camera.generateRay`,
* returns **linear HDR** (display does tonemap during blit).

### `src/plugins/integrators/PathTracerMinimal.ts`

```ts
import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types";

export default class PathTracerMinimal implements Plugin {
  readonly role: Role = "integrator";
  readonly namespace = "integrator.path.minimal";

  // No plugin-declared uniforms. We use reserved globals:
  // u_resolution, u_frameIndex, u_sampleCount, u_historyColor
  uniforms(): UniformDecl[] { return []; }

  chunks(): GLSLChunk[] {
    const stage: Stage = "frag";
    const source = /* glsl */`
    // --- constants ----------------------------------------------------------
    #define PI 3.141592653589793
    const float TMIN = 1e-3;
    const float TMAX = 1e4;
    const int   MAX_BOUNCES = 4;

    // --- tiny helpers -------------------------------------------------------
    vec3 sky(vec3 dir){
      float t = 0.5 * (dir.y + 1.0);
      return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
    }

    // hash RNG (stateless, fine as a starter; replace with Sobol later)
    float hash13(vec3 p){
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    vec2 rng2(vec2 pixel, int sample, int bounce){
      float s = float(sample + 73 * bounce);
      return vec2(
        hash13(vec3(pixel, s)),
        hash13(vec3(pixel + 17.0, s + 43.0))
      );
    }

    // build orthonormal basis (n is Z)
    void basis(in vec3 n, out vec3 t, out vec3 b){
      if (abs(n.z) < 0.999) t = normalize(cross(n, vec3(0,0,1)));
      else                  t = normalize(cross(n, vec3(0,1,0)));
      b = cross(t, n);
    }

    // cosine-weighted hemisphere sample around n
    vec3 sampleCosineHemisphere(vec3 n, vec2 u){
      float r = sqrt(u.x);
      float phi = 2.0 * PI * u.y;
      float x = r * cos(phi);
      float y = r * sin(phi);
      float z = sqrt(max(0.0, 1.0 - u.x));
      vec3 t, b; basis(n, t, b);
      return normalize(x*t + y*b + z*n);
    }

    // Unbiased box accumulation: average of N previous + current
    vec3 accumulate_box(vec3 current, vec3 history, int prevCount){
      float n = float(prevCount);
      return (history * n + current) / (n + 1.0);
    }

    // --- main integrate() ---------------------------------------------------
    vec3 integrate(vec2 fragCoord){
      // Jitter within the pixel for anti-aliasing
      vec2 pixel = fragCoord;
      vec2 j = rng2(pixel, u_sampleCount, 0) - 0.5; // [-0.5,0.5)
      vec2 uv = (pixel + j) / u_resolution;

      // Primary ray
      Ray ray = generateRay(uv);

      vec3 L = vec3(0.0);
      vec3 T = vec3(1.0); // throughput

      for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce){
        Hit h = scene_intersect(ray, TMIN, TMAX);
        if (!h.hit){
          // Environment
          L += T * sky(ray.d);
          break;
        }

        Point    p = ray.o + ray.d * h.t;
        Dir      n = scene_normal(p, h);
        Material m = scene_material(h.mat);

        // Emission at hit (if any)
        L += T * m.emission;

        // Diffuse-only bounce (Lambert):
        // BRDF = albedo/pi, pdf = cos/pi -> weight = albedo
        vec2 u = rng2(pixel, u_sampleCount, bounce + 1);
        Dir wi = sampleCosineHemisphere(n, u);
        T *= m.baseColor;              // (BRDF/pdf) simplification for Lambert
        ray = makeRay(p + n * TMIN, wi);
      }

      // Read previous accumulation and box-accumulate
      ivec2 ip = ivec2(pixel);
      vec3 history = texelFetch(u_historyColor, ip, 0).rgb;
      vec3 accum = accumulate_box(L, history, u_sampleCount);

      return accum; // linear HDR; display plugin tonemaps during blit
    }`;

    return [{
      name:   ChunkNames.IntegratorIntegrate,
      stage,
      source,
      deps: [
        ChunkNames.GeometryTypes,
        ChunkNames.CameraGenerateRay,
        ChunkNames.SceneTypes,
        ChunkNames.SceneIntersect,
        ChunkNames.SceneNormal,
        ChunkNames.SceneMaterial,
      ],
    }];
  }
}
```

> Notes
>
> * RNG is intentionally simple (good enough for a skeleton). Swap to `getRNGChunk("sobol")` later.
> * No Russian roulette yet. Keep it to `MAX_BOUNCES=4` for stability.
> * The Lambertian weight simplification (`T *= baseColor`) is correct for cosine sampling.

---

# 2) Present (blit) through the display plugin

If you aren’t already, do the final present as a separate **blit** that calls your active display plugin (tonemap → sRGB). A minimal present shader looks like:

```glsl
// present.frag
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;   // bound to the (fresh) history texture

vec3 display(vec3 hdr);    // provided by your postprocess plugin

void main() {
  vec3 hdr = texture(u_src, v_uv).rgb;
  outColor = vec4(display(hdr), 1.0);
}
```

Engine call after the path tracer draw:

```ts
presentProgram.use();
bufferManager.bindAsTexture(readHistory, 0); // freshly written ping-pong
presentProgram.set1i("u_src", 0);
fullscreenQuad.draw();
```

---

# 3) Reset policy (don’t skip this)

Call `resetAccumulation()` (from §0.2) on:

* canvas resize,
* variant/integrator switch,
* any parameter change that affects radiance (camera pose/FOY, material, scene edits).
  Mark such params with your existing `resetAccumulation: true` metadata and let Tracer listen.

---

# 4) Wire it up

```ts
import PathTracerMinimal from "./plugins/integrators/PathTracerMinimal";
// ... your usual camera/scene/postprocess

tracer
  .use(geo.shader)
  .use(new PinholeCamera(/*...*/))
  .use(new MyScene(/* must provide Intersect/Normal/Material */))
  .use(new PathTracerMinimal())
  .use(new SRGBDisplayPlugin());

tracer.buildAll();

// Make sure Tracer implements §0.2 each frame and §2 for present.
```

---

# 5) What you’ll see & easy tweaks

* It should converge to a soft diffuse look with environment light + any `Material.emission`.
* Increase `MAX_BOUNCES` for more GI (cost ↑).
* Add **Russian roulette** (after 3 bounces) to reduce bias from clamping depth.
* Replace inlined RNG with `getRNGChunk("sobol")` once that helper exists.
* Introduce an **albedo/normal AOV** (per-frame) if you want to experiment with denoising later.

---
