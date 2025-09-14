Here’s a draft you can drop in as `docs/photography-architecture.md`. It mirrors the two-tier pattern: lock the **top-level abstractions** now, ship with a **One-Shot Tracer (v1)**, and grow cleanly to **full path tracing (v2)** without rewriting the engine or world.

---

# Photography Architecture (Two-Tier Design: One-Shot v1 → Path Tracing v2)

## Executive summary

**Photography** is “how we observe the world.” It is a bundle of swappable research modules—**Camera**, **Sampler**, **Tracer**, **Film**, **Developer**—that only provide **GLSL + descriptors**. They never touch WebGL; the **engine** executes their passes. We start with a **One-Shot** tracer (v1) for fast bring-up, then upgrade to **unidirectional PT with NEE/RR** (v2) when comparisons and quality matter.

---

## Top-level abstractions (stable across v1/v2)

### Roles

* **Camera**: pixel → primary ray (and optional lens/time). Pure projection & camera model.
* **Sampler**: deterministic, named random streams (no RNG in engine; engine only allocates indices).
* **Tracer**: the estimator. v1: “one-shot” (single evaluation). v2: PT with bounces/NEE/RR.
* **Film**: GPU accumulation across frames (ping-pong). May track variance/aux buffers in v2.
* **Developer**: tonemap & color management from linear HDR → display/export.

### Module interface (no GL)

Each module exposes:

* **GLSL fragments** (functions, structs).
* **Descriptors**: parameters (uniforms), required textures/buffers (by logical name), and **entrypoints** the assembler wires.
* **No** WebGL calls, no framebuffers, no binds.

---

## Tier 1 — Minimal Photography (One-Shot Tracer)

### Purpose

Ship first pixels fast with a clean ABI and modules you’ll keep. Use the engine’s dumb executor + single assembled shader (no runtime `#ifdef`s). Support progressive refinement via **Film** (accumulate `current` into `accumulated`).

### Responsibilities by role

#### Camera (v1)

* **What it provides (fixed signatures)**:

```glsl
// Required
struct Ray { vec3 o; vec3 d; };
Ray  generateRay(ivec2 pixel, inout SampleStream s);

// Optional (if you need it later; can be no-ops in v1)
float shutterTime(inout SampleStream s);   // motion blur stub
vec2  lensSample(inout SampleStream s);    // thin-lens stub
```

* **Parameters**: `fov`, `sensorShift`, `cameraToWorld`, `aperture`, `focusDist` (last two can be dormant in v1).
* **Notes**: Keep transforms metric-agnostic; world handles geometry.

#### Sampler (v1)

* **Goal**: Deterministic streams without correlations.
* **Contract**:

```glsl
// Engine provides a SampleStream seeded by (pixel, frame)
void initStream(ivec2 pixel, int frame, out SampleStream s);
float next1D(inout SampleStream s, int domain);
vec2  next2D(inout SampleStream s, int domain);
```

* **Domains needed in v1**: `lens` (2D, optional), `time` (1D, optional), `misc` (2D) for tracer noise.
* **Strategies**: RNG, Halton/Sobol (Owen scramble), blue-noise. Strategy is module-selectable; layout is engine-fixed.

#### Tracer (One-Shot, v1)

* **Definition**: Exactly **one** evaluation per pixel per frame; no bounces. Great for debug/bring-up and simple results.
* **Entry point**:

```glsl
vec3 tracePixel(ivec2 pixel, int frame, inout SampleStream s);
```

* **Typical outputs** (choose one mode or compose):

    * **Direct capture**: radiance from environment at primary ray (useful sanity).
    * **Shaded one-hit**: one scene intersection, single evaluation (e.g., Lambertian with env, optional hard shadow).
    * **Debug modes**: normal/albedo/depth/ID visuals for pipeline checks.
* **No scratch resources** yet; writes to a single “current” radiance target.

#### Film (v1)

* **GPU accumulation** (no CPU readbacks). Ping-pong between `prev` and `accum`.
* **Entrypoint**:

```glsl
vec4 accumulate(vec2 uv,
                sampler2D u_prev,
                sampler2D u_curr,
                int frameCount); // returns rgba16f
```

* **Policy**: simple running average `(prev*frame + curr)/(frame+1)`.
* **Textures**: `{current: rgba16f}`, `{accum/prev: rgba16f}` managed by engine.

#### Developer (v1)

* **Entrypoint**:

```glsl
vec4 toneMap(vec4 hdr);  // linear → display (sRGB encode)
```

* **Policy**: Linear → clamp → sRGB (Reinhard/Filmic later).

### Minimal file tree (Photography only)

```
photography/
  camera/
    Camera.ts             # descriptors + getShaderCode()
    Pinhole.ts
  sampler/
    Sampler.ts            # domains + getShaderCode()
    RNG.ts
  tracer/
    Tracer.ts             # entrypoints + getShaderCode()
    OneShot.ts            # direct/env/normal/depth modes
  film/
    Film.ts               # accumulate()
    SimpleAverage.ts
  developer/
    Developer.ts          # toneMap()
    LinearSRGB.ts
  PhotographyDescriptor.ts# bundles chosen modules + parameters
```

### Frame sequence (v1)

1. **Trace pass**: `tracePixel` → `current`.
2. **Accumulate pass**: `accumulate(prev, current) → accum`.
3. **Present**: `toneMap(accum) → screen`.
4. **Swap**: `prev ← accum`.

### Strengths

* First pixels quickly; great for engine/world bring-up.
* Clean ABI that survives v2.

### Limitations

* No multi-bounce energy; no NEE; limited realism.
* No aux buffers (albedo/normal) for denoising (can be added as optional).

---

## Tier 2 — Expanded Photography (Path Tracing)

### Purpose

Enable **unidirectional PT** with **NEE** and **Russian roulette**, fair sampler comparisons, and optional aux buffers for denoising—without changing engine/world contracts.

### Added responsibilities

#### Tracer (v2: PT with NEE/RR)

* **Entry points** (superset of v1):

```glsl
// Required
vec3 tracePixel(ivec2 pixel, int frame, inout SampleStream s);

// Optional scratch/state (declared via descriptors; engine allocates)
layout(...) writeonly uniform image2D  u_pathState; // e.g., per-pixel RNG offset, etc.
```

* **Bounce loop** (in shader): calls **World** `sceneIntersect`, **Materials** `bsdf_eval/sample/pdf`, **Lights** pick/sample/eval, and **Geometry** helpers (local frames, metrics).
* **Domains added**:

    * `bsdf_select` (1D), `bsdf_dir` (2D) per bounce
    * `nee_light_pick` (1D), `nee_dir` (2D) per bounce
    * `rr` (1D) per bounce
* **Controls**: `maxBounces`, `useNEE`, `rrStart`, etc. (uniforms).

#### Film (v2)

* **Still GPU**. May add:

    * **Variance** (r32f) using Welford update.
    * **Aux**: albedo/normal (rgba16f) for denoising.
* **Entrypoints**:

```glsl
vec4 accumulate(vec2 uv, sampler2D prev, sampler2D curr, int frameCount);
float updateVariance(vec2 uv, sampler2D prev, sampler2D curr, int frameCount);
```

* **Stopping** (optional): film can expose “continue?” criteria via stats buffer (engine may read as a small async readback or a single texel).

#### Developer (v2)

* Tone mapping choices (Reinhard/Filmic/ACES), optional exposure/white balance.

#### Sampler (v2)

* Switch strategies (RNG ↔ Sobol ↔ blue-noise) under the **same domains**.
* Determinism preserved by **SampleLayout** (engine provided).

### Expanded file tree (Photography only)

```
photography/
  camera/
    Pinhole.ts
    ThinLens.ts
  sampler/
    RNG.ts
    HaltonOwen.ts
    BlueNoise.ts
  tracer/
    OneShot.ts
    PathTracerPT.ts      # uni-PT + NEE + RR
  film/
    SimpleAverage.ts
    VarianceFilm.ts      # adds r32f variance channel (+ optional aux)
  developer/
    LinearSRGB.ts
    Filmic.ts
```

### Strengths

* Realistic lighting, MIS-ready (when you implement MIS).
* Fair sampler comparisons (same domains, different strategies).
* Variance/aux buffers unlock denoisers and stopping criteria.

### Costs

* A few more descriptors & buffers; more complex `tracePixel`.

---

## ABI between Photography and Engine (stable)

**Engine wires entrypoints** (prefixed by module IDs to avoid collisions), builds a single minimal shader, and runs two or three fullscreen passes in order. Your modules declare:

* **Entry points** they **provide** (`generateRay`, `tracePixel`, `accumulate`, `toneMap`).
* **Symbols** they **require** from others (e.g., `sceneIntersect`, `bsdf_sample`, `light_sample`).
* **Uniforms** they need (with logical names).
* **Resources** they read/write (textures by logical name; engine allocates & binds).

No runtime `#ifdef`. If some symbol is missing, assembly fails with a clear error.

---

## Minimal vs Expanded — decision matrix

| Concern           | One-Shot v1                | Path Tracing v2  | Notes                                                      |
| ----------------- | -------------------------- | ---------------- | ---------------------------------------------------------- |
| Bring-up & debug  | **Best**                   | OK               | v1 has fewer moving parts.                                 |
| Realism           | Limited                    | **High**         | Multi-bounce + NEE/RR.                                     |
| Sampler studies   | Limited                    | **Strong**       | Deterministic domains shine here.                          |
| Denoising support | None                       | **Aux/variance** | Enables proper pipelines.                                  |
| Performance       | Fast compile, cheap shader | Heavier shader   | Cache & assembly mitigate.                                 |
| Complexity        | **Low**                    | Moderate         | Same module boundaries; just more code inside tracer/film. |

---

## When to upgrade to v2 (objective triggers)

* You need **soft/shadowed indirect light** or glossy reflections/refractions.
* You’re **comparing samplers** or algorithms and care about variance/convergence.
* You want **NEE** to reduce noise in direct lighting.
* You need **aux/variance** for denoising or adaptive sampling.
* You’re producing **publication-grade** renders.

If you’re proving out geometry/scene wiring or building UI, stay on v1.

---

## How to upgrade (incremental, low risk)

**Stage A — Keep v1, add aux outputs (optional)**
Add debug modes and `albedo/normal/depth` channels for inspection—still one-shot.

**Stage B — Introduce PT tracer (side-by-side)**
Implement `PathTracerPT.ts` with a bounce loop and **NEE**. Keep One-Shot available for A/B and UI testing. Domains: add `bsdf_*`, `nee_*`, `rr`.

**Stage C — Film variance/aux**
Swap `SimpleAverage` → `VarianceFilm`. Keep accumulation on GPU. Consider a tiny stats readback (single texel) for “continue?” logic.

**Stage D — MIS (optional)**
Add balance/power heuristic in your NEE/BSDF multiple sampling. No engine changes needed.

**Stage E — Thin-lens camera / motion blur (optional)**
Plumb `lensSample` and `shutterTime` domains; Camera implements them; Tracer uses them; Film unchanged.

At every stage, the **engine and world ABIs remain unchanged**; only photography modules evolve.

---

## Conventions to lock (short appendix)

* **Color space**: all intermediate values are linear scene-referred; Developer handles display encoding.
* **Radiance units**: be explicit in docs—e.g., unitless “scene radiance” scaled to \[0,∞).
* **Sample domains** (reserved IDs):
  `lens`, `time`, `misc` (v1); add `bsdf_select`, `bsdf_dir`, `nee_light_pick`, `nee_dir`, `rr` (v2).
* **Determinism**: seed = `(pixel, frame)`; domains must not overlap in dimensions.

---

## Testing (Photography)

* **One-shot**:

    * Ray direction sanity (gradient patterns).
    * Depth/normal visualization matches known geometry.
    * Env capture: rotate camera → expected color shifts.

* **Path tracing**:

    * **Furnace test** (closed diffuse box): converges to albedo.
    * **Direct lighting**: NEE vs no-NEE variance comparison.
    * **Sampler swap**: RNG vs Sobol, identical mean, different variance.
    * **Variance map**: decreases with frame count as expected.

---

### TL;DR

Define **Camera / Sampler / Tracer / Film / Developer** now with stable entrypoints. Ship **One-Shot** (v1) for speed and clarity. Upgrade to **PT with NEE/RR** (v2) when realism, variance, and comparisons matter—no engine or world rewrites required.




# Debug Outputs & Developer Pass — Design Notes

**Scope:** How we visualize internal fields (normals, depth, SDF distance, IDs, etc.) without creating a parallel rendering path. This keeps everything inside the same “photography” pipeline so it stays maintainable.

---

## Goals

* Single pipeline (trace → film → develop) for both final images and debug views.
* Zero special WebGL code paths for “debug”; just different modules/params.
* Deterministic, easy to toggle at runtime.
* v1: trivial to add tonight.
  v2: scales to multiple simultaneous inspection buffers.

---

## v1: Fastest Path (no ABI changes)

**Idea:** The tracer *returns the thing you want to see* as the pixel color. Film is *NoFilm* or *Passthrough* so there’s no accumulation. Developer can optionally bypass tone mapping.

**Tracer additions**

* Add a mode switch:

  * `u_debugMode` ∈ { `0=radiance`, `1=normal_rgb`, `2=depth_linear`, `3=sdf_distance`, … }.
* Encode outputs to linear RGB for display (examples below).

**Developer addition**

* `u_developerBypassTonemap: bool`. When `true`, output raw RGB (no tone map/gamma). Use this for depth/IDs; keep tone mapping for radiance.

**Why this is good**

* One pass graph, no engine edits.
* Instant flips between radiance and inspections.
* No risk of averaging normals/distances (we aren’t accumulating).

**GLSL snippets (illustrative)**

```glsl
// tracer: encode world-space normal to RGB
vec3 debug_normal_rgb(vec3 n_world) { return n_world * 0.5 + 0.5; }

// tracer: encode Euclidean depth (near/far remap)
vec3 debug_depth_linear(float t, float nearT, float farT) {
  float x = clamp((t - nearT) / (farT - nearT), 0.0, 1.0);
  return vec3(1.0 - x); // white near, black far
}

// tracer: encode signed SDF distance (blue/white/red ramp)
vec3 debug_sdf(float d, float scale) {
  float x = clamp(d * scale, -1.0, 1.0);
  return (x < 0.0) ? mix(vec3(1), vec3(0,0.5,1), -x)
                   : mix(vec3(1), vec3(1,0.2,0.2),  x);
}
```

Developer’s main:

```glsl
vec4 color = vec4(sampled_rgb, 1.0);
fragColor = u_developerBypassTonemap ? color : toneMap(color);
```

**Operational notes**

* Use **NoFilm** or **Passthrough** (don’t average debug outputs).
* Keep debug modes *pure functions* of the current frame. No history.

---

## v2: Inspection Channels (scalable & general)

**Idea:** The tracer can write extra **channels** (named images) alongside radiance. The Developer chooses which channel to visualize. The Engine routes by channel name; **no special debug path**.

**Channel names (proposed)**

* Required: `radiance` (linear, scene-referred).
* Optional inspection channels (produced by tracer or film; consumed by developer if present):

  * `normal` (rgb16f/rgba16f): world or shading frame (document which).
  * `depth_linear` (r32f): geodesic parameter or Euclidean distance (document metric).
  * `sdf_distance` (r32f): signed distance for SDF scenes.
  * `mat_id` / `geo_id` (encoded to r32f/rgba8 if integer textures aren’t available).
  * `albedo`, `roughness` (material parameters), etc.

**Developer: Visualizer**

* `requiresChannels: ['radiance']`, `optionalChannels: ['normal','depth_linear','sdf_distance',…]`
* `u_viewChannel: int` selects which channel to show.
* Channel-appropriate mappings:

  * `normal`: `n*0.5+0.5`, optionally allow world/shading toggle.
  * `depth_linear`: `1 - exp(-k * depth)` or near/far remap.
  * `sdf_distance`: signed colormap (see v1 ramp).
  * For scalar AOVs, false-color LUTs (viridis/turbo) if desired (can be added later).

**Engine routing (tiny)**

* ChannelRouter binds `g_dev_<channel>` samplers for requested channels.
* If Film is **NoFilm/Passthrough**, route tracer’s outputs directly to those channel names.
* Build-time validation: Developer can only request channels that exist (or synthesized `radiance`).

**Film**

* Does **not** touch inspection channels unless explicitly designed to.
* Still owns `radiance` (accumulation, if any).

---

## When to use which

* **You just want to see something now** → v1: tracer writes debug to `radiance`, Developer bypasses tone map.
* **You want a toolbox of views and overlays** → v2: add inspection channels + VisualizerDeveloper.

Both keep a single, consistent pipeline; v2 avoids multiplying “debug tracer variants.”

---

## Naming, units, and geometry caveats

* **Depth meaning**: In non-Euclidean geometries, document whether `depth_linear` is affine parameter `t`, metric length, or something else. Make it a per-geometry constant or a uniform so the Visualizer knows how to map.
* **Normals**: Prefer **shading frame** normals (via Geometry ABI) and add a toggle if you also want geometric/true normals.
* **IDs**: If you lack integer render targets, encode to floats or RGBA8 with a documented packing (provide pack/unpack helpers).

---

## Pitfalls to avoid

* **Don’t accumulate debug** fields unless the math is correct (e.g., variance should track moments, not averages of absolutes).
* **Don’t tone map non-radiance** data by default. Use `u_developerBypassTonemap` or a per-channel visualization.
* **Don’t invent a parallel GL path**. Keep the same pass graph; route via channels.

---

## Minimal toggles (UI/params)

* Tracer: `u_debugMode: int` (v1 fallback).
* Developer: `u_developerBypassTonemap: bool`, `u_viewChannel: int` (v2).
* Optional: per-channel visualization params, e.g., `u_depthNear`, `u_depthFar`, `u_depthK`, `u_sdfScale`.

---

## Quick test checklist

* Normals: edges crisp, orientation flips on mirrored transforms as expected.
* Depth: near/far mapping stable across FOV/resize; no NANs/INFs (tint them if present).
* SDF Distance: zero-crossing aligns with visible surfaces.
* Radiance vs debug: toggling modes doesn’t require pipeline rebuild (only uniforms change).
* NoFilm vs Passthrough: results identical for debug modes.

---

## One-page summary (for future us)

* **Keep one pipeline.** All debug goes through Film→Developer like everything else.
* **Tonight:** tracer writes debug to `radiance`; Developer can bypass tone map.
* **Later:** formalize **inspection channels**; Developer visualizes any channel by name.
* **Engine:** routes by channel name; never expose internal texture names in module ABIs.
