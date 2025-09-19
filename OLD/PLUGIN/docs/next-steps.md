awesome — here’s a **thinking map + pick-your-own-adventure roadmap** you can mull over tonight and start biting off tomorrow. I grouped items by theme, noted rough complexity (S/M/L), and gave crisp “what done looks like” so you can tell when to stop.

---

# 1) Image quality & stability

**A. Progressive accumulation (M)**

* Add `u_frame`, `u_sampleCount` and a history texture; blend new samples into an HDR buffer.
* Reset on resize/variant/parameter changes.
  **Done when:** a noisy integrator (e.g., cosine-hemisphere) visibly refines over time without ghosting.

**B. Jittered camera (M)**

* Add subpixel jitter (R2 or Halton) to `generateRay`.
* Works great with accumulation; helps resolve aliasing.
  **Done when:** diagonal edges look less stair-steppy after a few frames.

**C. Simple temporal clamp (S)**

* Before blending, clamp incoming color to history neighborhood (min/max).
  **Done when:** bright “sparks” don’t pollute your history.

---

# 2) Lighting & integrators

**A. Any-hit / shadow query (S)**

* Scene optional: `bool scene_occluded(Ray r, float tMin, float tMax)`
* Lambert uses this to cast a single shadow ray.
  **Done when:** directional light produces shadows.

**B. Lights as a first-class role (M)**

* Role `"lights"` with chunks: `lights.sample()`, `lights.eval()`, `lights.pdf()`.
* Start with 1 directional + 1 point light; add UI params.
  **Done when:** Lambert can choose between lights via a simple switch.

**C. Path-tracer skeleton (M→L)**

* Next-event estimation (sample light) + cosine BSDF; Russian roulette.
* MIS later.
  **Done when:** you can render soft shadows from an area light with visible noise that cleans up via accumulation.

---

# 3) Scene & geometry evolution

**A. Bounds (S)**

* Optional `Scene.Bounds`: `float scene_far();`
* Integrators default `tMax` to this.
  **Done when:** removing the magic 100.0 doesn’t hurt anything.

**B. Auto-marcher injection (M)**

* If `Scene.SignedDistance` present and `Scene.Intersect` absent, inject a library marcher at build time.
  **Done when:** an SDF-only scene compiles and runs without writing its own intersect.

**C. Any-hit fast path (M)**

* Specialized, cheaper marcher for occlusion (early exit, bigger eps).
  **Done when:** the shadow ray is 2–3x cheaper than the full intersect on SDF scenes.

**D. Analytic normals (M)**

* Optional `Scene.NormalAnalytic(Point p, Hit h)`; if present, prefer it.
* Keep numeric fallback.
  **Done when:** demo sphere uses analytic normal and “normal” debug view looks cleaner.

**E. Mesh/BVH scaffold (L)**

* Add `"geometry/tri"` module + CPU-built BVH; scene’s `Intersect` chooses SDF vs BVH.
  **Done when:** a simple triangle mesh renders and self-shadows.

---

# 4) Materials & textures

**A. Material system v1 (M)**

* Add fields: `albedoTexId`, `emissiveStrength`, `ior`.
* Optional **texture role**: lookup by `sampler2D` via uniform indirection.
  **Done when:** one sphere reads baseColor from a texture.

**B. IBL / environment map (M)**

* Add environment sampling: background color from lat-long HDR; optional rotation.
  **Done when:** miss rays return environment; glossy highlights reflect it.

---

# 5) Camera & controls

**A. Thin-lens camera (M)**

* Add focus distance, aperture; sample lens disk for DOF.
  **Done when:** you can rack focus between near/far spheres.

**B. Camera motion blur (M)**

* Per-sample shutter time; interpolate camera transform.
  **Done when:** moving camera + accumulation shows motion blur streaks.

---

# 6) Performance & robustness

**A. Marching diagnostics (S)**

* Count steps/pixel; track avg/max per frame; overlay tiny HUD.
  **Done when:** you can spot pathological scenes instantly.

**B. Epsilon policy (S)**

* Centralize hit/step eps in each scene; consider screen-space epsilon for hit test.
  **Done when:** fewer acne/terminator artifacts at grazing angles.

**C. NaN/Inf watchdog (S)**

* Guard in integrator: sanitize color; blink red if detected (dev only).
  **Done when:** experiments don’t nuke the frame with NaNs.

---

# 7) Tooling, tests, and DX

**A. Chunk order log (S)**

* Dev flag to print sorted chunk names once per build.
  **Done when:** a missing dep is obvious from logs.

**B. Golden thumbnails (S)**

* Script to capture 128×72 PNGs per (scene × integrator).
  **Done when:** you can eyeball regressions or add a quick pixel RMS check.

**C. Hot-reload nicety (M)**

* Rebuild only changed program on a file change; preserve accumulation reset logic.
  **Done when:** editing a scene or integrator re-links that program without a full reset.

---

# Suggested “tomorrow” picks (small bites)

1. **Any-hit / shadow query (S)** + wire into Lambert.
2. **Bounds hook (S)** to remove `100.0`.
3. **March diagnostics HUD (S)** to see steps/pixel.
4. **Progressive accumulation (M)** if you want a slightly bigger bite.

Each of these is self-contained and gives immediate feedback without ripping up today’s work.

If you tell me which thread you want to pull first, I’ll sketch the minimal API/contract additions and test plan for that item so you can implement swiftly.





# Next Steps

This system is in a solid place: we can load geometry, compile shaders, attach controls, and render in real-time. The next opportunities fall into two categories: **new features (controllers, input modes)** and **structural refinements (plugin architecture, ergonomics).**

---

## 1. New Control Systems

We currently have **KeyboardControl** and **FPSControls**. Expanding the family will make the system more versatile:

- **OrbitControls**  
  Orbit the camera around a focus point with mouse drag, zoom, and pan. Useful for object inspection.

- **ArcballControls**  
  Quaternion-based rotation that mimics a virtual trackball. Popular in CAD/math viewers for clean and intuitive orientation.

- **Gamepad / Joystick Controls**  
  Bind analog sticks to movement and rotation using the browser `Gamepad` API. Perfect for XR/VR demos or casual navigation.

- **Scripted / Cinematic Paths**  
  Drive the camera along splines or pre-recorded paths. Great for demos, flythroughs, or benchmark comparisons.

- **Autopilot / AI Wandering**  
  A “screensaver mode” where the camera drifts via noise-driven motion, keeping a target in view.

Each of these fits naturally as a `controls` plugin with its own parameters and update loop.

---

## 2. Controls Infrastructure

We could improve **how controls integrate**:

- **Unified Attach/Detach API**  
  Right now, controls manually add/remove event listeners. A higher-level helper could ensure consistent lifecycle management.

- **Multiple Active Controls**  
  Allow combining plugins (e.g., `KeyboardControl` + `OrbitControls`) and blending their outputs, instead of just one active control at a time.

- **Global Input Abstraction**  
  Insert a layer between raw events and controls. Controls could then consume high-level actions (“MoveForward”, “YawLeft”), making remapping and multi-device input trivial.

---

## 3. Plugin Architecture Refinements

Currently, all plugins share the same shape, even though **controls** are CPU-only and **geometry/camera/integrator** are CPU+shader. Possible refinements:

- **Split Plugin Interfaces**  
  Define `ShaderPlugin` (with `chunks`, `uniforms`, etc.) vs. `ControlPlugin` (with `update`, `attach`, `detach`). This makes contracts explicit.

- **Engine Awareness of CPU-only Plugins**  
  Instead of special-casing controls in `Tracer`, the engine could manage **two plugin collections**: one for shader roles, one for CPU-only roles. This keeps frame orchestration cleaner.

- **Parameter Tiering**  
  Differentiate *performance-critical* params (like accumulation reset) from *UI-only* params (like control smoothing). This could help with reset logic and auto-benchmarks.

---

## 4. Rendering System Improvements

While not strictly input-related, these tie into a smoother developer workflow:

- **Accumulation / History**  
  Implement `u_frame` counters and accumulation textures, with automatic reset when controls move the camera.

- **Multipass Rendering**  
  Add support for render-to-texture and post-process stages (denoisers, tone-mapping, bloom).

- **Diagnostics and Hot Reload**  
  Better error reporting, shader hot reload, and UI hooks to inspect active variants and controls.

---

## 5. Ergonomics and Future-Proofing

- **Variant Controls**  
  Variants currently only swap shader plugins; allowing them to swap in alternate controls could be useful for testing.

- **Profiles / Presets**  
  Group plugins + controls into saved configurations that can be loaded at runtime.

- **Testing and Determinism**  
  Add deterministic “replay logs” of controls input → makes debugging and performance benchmarking repeatable.

---

### Summary

The next steps branch in two directions:
1. **Expand the library of control plugins** (keyboard, mouse, orbit, gamepad, scripted paths, autopilot).
2. **Refine the plugin system** to clearly distinguish shader-based vs CPU-only roles, improving clarity and extensibility.

Both directions strengthen the core philosophy: **modular, geometry-first, readable, testable.**










# Output System Design — OutputGraph & Sinks

> A minimal, extensible output pipeline for a geometry‑first path tracer. Integrators emit **linear HDR AOVs**; the Output System turns those into **on‑screen pixels** and **files** (PNG/EXR/Video) via small, composable passes and sinks.

---

## Goals & Non‑Goals

**Goals**

* **Single responsibility**: Integrators only produce HDR buffers (and optional AOVs). Output handles presentation/export.
* **Composable post**: Support one‑pass tone map today; support multi‑pass bloom/denoise/LUT tomorrow.
* **Multi‑sink**: Present to screen and export to files in the same frame, without duplicate work.
* **Simple default**: Reads like a recipe (linear chain + fan‑out). DAG/branching only when needed.
* **Performance‑aware**: One fullscreen draw for screen; amortized/async readback for files.

**Non‑Goals**

* Full general framegraph with arbitrary resource lifetime tracking. We want a tiny, project‑fit layer.

---

## High‑Level Flow

```
Integrator (progressive) → BufferManager → OutputGraph
                               │
                         [Tonemap/OETF]  →  "ldrColor"
                               │                 ├── ScreenSink   (present)
                          [Dither?]                └── FileSink(s) (PNG/EXR/Video)
                          [Resize?]
```

* Integrators **never tonemap**. They output linear HDR (e.g., `rgba16f/rgba32f`).
* Exactly **one tone map** before any LDR sink. HDR sinks (EXR) tap the pre‑tonemap channel.
* Passes may be internally multipass (e.g., Bloom) while exposing a **single output** channel.

---

## Terminology

* **Channel / AOV**: A named stream (e.g., `hdrColor`, `albedo`, `normal`, `ldrColor`).
* **Pass**: A shader draw that consumes one channel and produces one channel (internally can have subpasses).
* **Sink**: A side‑effect consumer of a channel (screen blit, file write, recorder).
* **OutputGraph**: A tiny linear/DAG pipeline of passes ending in one or more sinks.

---

## Core Contracts (Type Sketches)

```ts
// Named texture produced by the tracer or by a pass.
export type Channel = "hdrColor" | "ldrColor" | "albedo" | "normal" | string;

export interface OutputSource {
  channel: Channel;
  tex: WebGLTexture;
  w: number; h: number;
  format: "rgba8" | "rgba16f" | "rgba32f"; // reflect actual GL texture format
}

// Shader pass: exactly one input → one output (internal multipass allowed)
export interface OutputPass {
  name: string;
  input: Channel;        // e.g., "hdrColor"
  output: Channel;       // e.g., "ldrColor"
  // Use BufferManager for target allocation; use ParameterView for tunables.
  draw(
    gl: WebGL2RenderingContext,
    inputs: Record<Channel, OutputSource>,
    bm: BufferManager,
    params: ParameterView
  ): OutputSource;
}

// Side-effect endpoint.
export interface Sink {
  name: string;
  input: Channel; // "ldrColor" for PNG/Video, "hdrColor" for EXR

  present?(
    gl: WebGL2RenderingContext,
    src: OutputSource
  ): void; // Screen

  write?(
    gl: WebGL2RenderingContext,
    src: OutputSource
  ): Promise<void>; // Files

  shouldRun?(ctx: OutputContext): boolean; // policy hook
}

export interface OutputContext {
  frameIndex: number;
  sampleCount: number; // progressive samples per pixel
  time: number;        // seconds
  events: { snapshot?: boolean; recording?: boolean };
}

export class OutputManager {
  setGraph(entry: Channel, nodes: (OutputPass | Sink)[]): void;
  registerSource(src: OutputSource): void;       // called each frame by Tracer
  run(ctx: OutputContext): Promise<void>;        // execute passes then sinks
  dispose(): void;                               // free cached programs/targets
}
```

**Notes**

* Passes own their internal complexity (e.g., downsample pyramid) but expose a single outward `output` channel.
* Sinks never mutate textures; they **consume**.
* Stable channel names become part of the cache keying and docs (`hdrColor`, `ldrColor`, …).

---

## Default Passes & Sinks

### Passes

1. **TonemapSRGBPass**

  * **Input:** `hdrColor`
  * **Output:** `ldrColor`
  * Wraps the active `role: "postprocess"` plugin, reading exposure/curve params via `ParameterManager`.

2. **DitherPass** (optional)

  * **Input/Output:** `ldrColor`
  * Ordered/blue‑noise dither to mitigate banding after tone map.

3. **ResizePass** (optional)

  * **Input:** `ldrColor` (or `hdrColor` for HDR export)
  * **Output:** named (e.g., `ldr4k`)
  * Uses a simple filter (box/bilinear) unless a higher quality resampler is desired.

4. **BloomPass** (optional, internally multipass)

  * **Input:** `hdrColor`
  * **Output:** `hdrBloomed` or directly `ldrColor` if it includes tone map.
  * Internal: threshold → downsample chain → blur → upsample/compose.

> Additional passes (Overlay/LUT/Letterbox/Watermark/FXAA/Denoise) follow the same contract.

### Sinks

1. **ScreenSink**

  * **Input:** `ldrColor`
  * **Action:** Single fullscreen blit to the default framebuffer (no tone map here).

2. **PNGWriter** (snapshots)

  * **Input:** `ldrColor`
  * **Action:** Readback `rgba8` or copy to an export canvas and `toBlob()`.

3. **EXRWriter** (HDR stills)

  * **Input:** `hdrColor`
  * **Action:** Readback float (half/float) → encode EXR.

4. **VideoWriter** (LDR)

  * **Input:** `ldrColor`
  * **Action:** Prefer recording a visible `<canvas>` via `MediaRecorder`. Fallback: readback → software WebM encoder.

---

## Policies (When Sinks Run)

A tiny per‑sink policy layer avoids custom logic in the manager.

```ts
type CapturePolicy =
  | { type: "off" }
  | { type: "snapshot"; hotkey?: string }
  | { type: "record"; fps?: number; maxFrames?: number }
  | { type: "onInterval"; everyNFrames: number }
  | { type: "whenStable"; minSamples: number }; // progressive‑only
```

Examples:

* `snapshot` — edge‑triggered by UI or hotkey (e.g., "P").
* `record` — continuous until stopped.
* `onInterval(60)` — export every 60 frames.
* `whenStable(128)` — only export when progressive sample count ≥ 128.

Each sink implements `shouldRun(ctx)` using its policy.

---

## Tracer Integration

**Progressive path**

1. Integrator draws to `history.write` (HDR).
2. Tracer ping‑pongs: `history.read ↔ history.write`.
3. Tracer registers the source with OutputManager:

   ```ts
   output.registerSource({ channel: "hdrColor", tex: history.read, w, h, format: "rgba16f" });
   ```
4. Tracer calls `await output.run({ frameIndex, sampleCount, time, events })`.

**One‑shot compatibility**

* Preferred: render into a provided HDR target, then reuse the same output path.
* Transitional: allow integrator‑direct‑to‑screen demos; OutputManager no‑ops.

---

## Execution Model

* **Graph setup**: OutputManager validates the chain, computes topo order (linear in default case).
* **Allocation**: Passes request targets by name via `BufferManager` (size/format inferred from input unless overridden).
* **Draw**: Each pass runs a fullscreen draw (or internal multipass). Programs are cached via `ProgramCache`.
* **Sinks**: After passes, eligible sinks run. Multiple sinks can consume the same output without recompute.
* **Resize**: On tracer resize, OutputManager drops cached allocations; passes reacquire at next `run()`.
* **Params**: Passes read values through `ParameterView` and can mark which params require history reset (handled by Tracer upstream).

---

## File/Directory Layout

```
src/
  output/
    OutputManager.ts          // topo compile, run(), simple cache of pass outputs
    types.ts                  // Channel, OutputSource, OutputPass, Sink, OutputContext
    passes/
      TonemapSRGBPass.ts
      DitherPass.ts
      ResizePass.ts
      BloomPass.ts            // internally multipass, outward single output
      OverlayPass.ts
    sinks/
      ScreenSink.ts           // wraps a tiny blit (former ScreenPresenter guts)
      PNGWriter.ts
      EXRWriter.ts
      VideoWriter.ts
    profiles/
      interactive.ts          // preset graphs
      export-4k.ts

  rendering/
    FullscreenQuad.ts
    ShaderProgram.ts
    ProgramCache.ts
    BufferManager.ts
    Readback.ts               // helper for double‑buffered readPixels + fences
```

---

## Example Graphs

**Interactive default**

```ts
output.setGraph("hdrColor", [
  new TonemapSRGBPass({ exposureParam: "post.exposure" }),
  new DitherPass({ enabledParam: "post.dither" }),
  new ScreenSink(),
]);
```

**Export HDR + LDR**

```ts
output.setGraph("hdrColor", [
  new BloomPass({ threshold: 1.0, strength: 0.6 }),
  new TonemapSRGBPass({ exposureParam: "post.exposure" }),  // → ldrColor
  new ScreenSink(),
  new EXRWriter({ filePattern: "export/hdr-####.exr",
                  policy: { type: "whenStable", minSamples: 64 } }), // taps hdrColor
  new PNGWriter({ filePattern: "export/ldr-####.png",
                  policy: { type: "snapshot", hotkey: "P" } }),      // taps ldrColor
]);
```

**Different look for export**

```ts
output.setGraph("hdrColor", [
  new TonemapSRGBPass({ exposureParam: "post.screenExposure" }),    // → ldrColor
  new ScreenSink(),
  new TonemapSRGBPass({ input: "hdrColor", output: "ldrExport",
                        exposureParam: "post.exportExposure", curve: "ACES" }),
  new ResizePass({ input: "ldrExport", output: "ldr4k", width: 3840, height: 2160 }),
  new PNGWriter({ input: "ldr4k", filePattern: "4k/frame-####.png",
                  policy: { type: "snapshot", hotkey: "Shift+P" } }),
]);
```

---

## Readback & Performance

* **Screen path**: exactly 1 fullscreen draw.
* **Readback**: Prefer a dedicated export target sized/typed for the sink; avoid reading back the history texture.
* **Latency hiding**: Double buffer readback and use fence sync (`EXT_disjoint_timer_query_webgl2` if available) to avoid stalls.
* **Reuse buffers**: Keep CPU‑side readback arrays persistent to avoid GC churn.
* **Canvas path for PNG/Video**: If using an export canvas mirroring the LDR texture, use `toBlob()` / `MediaRecorder` to avoid explicit `readPixels`.

---

## Error Handling & Diagnostics

* Graph validation catches missing inputs (e.g., no producer for `ldrColor`).
* Pass compile/link errors forwarded with source maps from ShaderAssembler.
* Sinks report I/O failures (e.g., EXR encode) with actionable messages.
* Optional per‑node timers and a mini HUD overlay (ms/frame per pass, readback time).

---

## Testing Checklist

* **Unit**: Pass parameter mapping; sink `shouldRun` policies; graph validation.
* **GL**: Correct texture formats; resize handling; ping‑pong correctness.
* **E2E**: Progressive stability gates; snapshot hotkey; record start/stop; multi‑sink fan‑out.
* **Visual**: Tone map curve parity (in‑shader vs export); dither toggles; bloom threshold sanity.

---

## Migration Plan

1. Introduce `OutputManager`, `TonemapSRGBPass`, `ScreenSink`. Route progressive presentation through it. (Move tonemap out of ScreenPresenter.)
2. Add `PNGWriter` with `snapshot` policy and hotkey. Keep integrators unchanged.
3. Add `EXRWriter` with `whenStable(minSamples)` policy.
4. Add `ResizePass` and `VideoWriter`.
5. Deprecate integrator‑inline postprocess in demos; optionally keep an adapter for legacy examples.

---

## Conventions

* Integrators output **linear HDR** only.
* One tone map per LDR path.
* Pass names = output channel names in logs.
* Channels are stable, lowercase, camel for suffixes (`hdrColor`, `ldrColor`, `ldr4k`).
* Sinks are idempotent per frame (guarded by policy).

---

## Open Questions

* **Denoise location**: Pre‑ or post‑tone map? (Typically pre‑tone map on HDR.)
* **Color management**: Add profiles beyond sRGB (Display‑P3, PQ/HLG) and HDR display paths.
* **WebGPU**: Future port—interfaces should map 1:1; add compute‑based passes.
* **Metadata**: Embed camera/exposure into EXR/PNG text chunks for reproducibility.

---

## Appendix: Minimal Presenter Shader (for ScreenSink)

```glsl
#version 300 es
precision highp float;

in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_src; // bound to the LDR texture

void main() {
  vec3 ldr = texture(u_src, v_uv).rgb;
  outColor = vec4(ldr, 1.0);
}
```

This document specifies the contracts and expected behavior of the Output System so implementation can proceed incrementally without surprises.
