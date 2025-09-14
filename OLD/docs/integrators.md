
# Integrators

This document explains the role of **integrators** in the tracer, both in terms of the **long-term architecture** we’re aiming for and the **current subset** of features that are already working.

---

## 1. Vision: What Are Integrators?

In physically based rendering, an **integrator** is the algorithm that solves (or approximates) the rendering equation. It is responsible for:

* generating primary rays (with the help of the camera),
* traversing the scene to find intersections,
* applying a shading or sampling strategy (e.g. Lambertian, path tracing, MIS, etc.),
* handling multiple samples per pixel,
* accumulating results over time to converge to the correct answer.

In our engine, the goal is that **integrators declare what they need**, and the **engine orchestrates resources** for them. That means:

* **Shader chunks**: integrators provide GLSL code implementing `integrate(vec2 fragCoord)`.
* **Uniforms**: integrators can ask for parameters to be bound each frame.
* **Submodules** (future): integrators can request swappable components like samplers, accumulators, or estimators.
* **Capabilities**: integrators advertise whether they are *one-shot* or *progressive*, how many buffers they require, whether they need RNG streams, etc.
* **History management**: the engine allocates history buffers (ping-pong, variance buffers, temporal reservoirs) and resets them as needed.
* **Validation**: the engine checks for compatibility (e.g. you can’t ask for progressive mode with no accumulator).

This allows a “mix and match” library: e.g. use a Sobol sampler with an exponential-moving-average accumulator inside a path tracer integrator, without each integrator having to re-implement those details.

---

## 2. Subset Implemented Today

Right now, we support **two classes of integrators**:

### One-Shot Integrators

* Compute a complete image in a single pass.
* Examples: **NormalsIntegrator**, **LambertIntegrator**.
* These inject their own GLSL code for `integrate()`.
* They directly apply postprocess (tonemapping) inside their shader.
* No accumulation or history buffers are involved.

### Progressive Integrators

* Produce a noisy but unbiased estimate that converges with accumulation.
* Example: **PathTracerMinimal** (progressive path tracer with cosine-weighted bounces).
* Declares `progressive = true`.
* The engine:

    * allocates a `history` buffer pair via `BufferManager`,
    * feeds in `u_frameIndex`, `u_sampleCount`, and `u_historyColor` uniforms,
    * writes each new sample into `history.write`,
    * swaps ping-pong buffers each frame,
    * presents the current HDR buffer through `ScreenPresenter` (postprocess plugin),
    * resets history when integrator/parameters/canvas size change.
* Accumulation currently uses a simple **box filter** (running average).
* Postprocess happens only in the presenter (to avoid double tonemapping).

---

## 3. What Exactly Happens Right Now

When you run with `PathTracerMinimal`:

1. **Build phase**:

    * `Tracer` detects `progressive = true`.
    * Allocates a `history` ping-pong buffer (`rgba16f`).
    * Hooks up `ScreenPresenter` to display the HDR result through tonemapping.

2. **Per frame**:

    * Engine increments `u_frameIndex` and `u_sampleCount`.
    * Binds `history.read` as texture unit 0 → `u_historyColor`.
    * Binds `history.write` as the draw target.
    * Draws a fullscreen quad, running the integrator’s `integrate()` in the fragment shader.
    * Inside `integrate()`: the path tracer samples one path per pixel, reads the previous history value, and combines via `accumulate_box()`.
    * Engine unbinds FBO, swaps history buffers.
    * ScreenPresenter takes `history.write`, tonemaps it, and blits to the default framebuffer.
    * `sampleCount++`.

3. **Reset events**:

    * On resize, parameter changes, or integrator swap:

        * History buffers are resized or cleared.
        * `sampleCount` and `frameIndex` reset to zero.

When you run with a **one-shot integrator**:

* No history or presenter is used.
* The shader does its own postprocess.
* Each frame is independent.

---

## 4. Changes Made in Support

To enable this, several other components were updated:

* **`Tracer.ts`**

    * Recognizes `progressive` integrators.
    * Manages `frameIndex` / `sampleCount`.
    * Allocates, binds, and swaps history buffers via `BufferManager`.
    * Routes HDR output through `ScreenPresenter` for progressive integrators.
    * Adds reset logic on resize/variant switch.

* **`BufferManager.ts`**

    * Manages named textures and ping-pong pairs.
    * Can bind textures for sampling or as draw targets.
    * Clears by lifetime (`perFrame`, `history`).
    * Provides swap and resize helpers.

* **`ScreenPresenter.ts`**

    * A small pass that takes a texture and applies the active postprocess plugin.
    * Replaces the old “display plugin” terminology.
    * Ensures postprocess is applied *once* for progressive cases.

* **`ShaderProgram.ts`**

    * Added uniform-location cache.
    * Added uniform setters (`set1f`, `set2f`, `set1i`).
    * Added `dispose()` alias.
    * Fixed integration with presenter code.

* **Integrators themselves**

    * **NormalsIntegrator** and **LambertIntegrator** are one-shot, self-contained.
    * **PathTracerMinimal** is progressive, declares `progressive = true`, and consumes `u_frameIndex`, `u_sampleCount`, and `u_historyColor`.

---

## 5. Roadmap

The current state is deliberately minimal: just enough to prove the architecture works.

Next steps (already discussed in design docs):

* **Pluggable submodules**: samplers, accumulators, estimators.
* **More advanced accumulators**: exponential moving average, variance tracking.
* **RNG helpers**: Sobol, CMJ, etc.
* **Validation layer**: warn when integrators declare incompatible caps.
* **Multiple AOVs**: variance, albedo, normal buffers for denoisers.
* **Temporal reuse**: reprojection, reservoirs (ReSTIR).
* **One-shot reuse**: allow one-shot integrators to also request helpers without being fully progressive.

---

## 6. Summary

* **Vision**: Integrators are modular algorithms for sampling + accumulation, with swappable submodules, validated by the engine, and powered by managed GPU buffers.
* **Now**: We have one-shot shading integrators and one minimal progressive path tracer with history accumulation + presenter.
* **Supporting files**: `Tracer`, `BufferManager`, `ScreenPresenter`, and `ShaderProgram` were all extended to support progressive workflows.

This establishes the **spine** for progressive path tracing while keeping one-shot integrators easy and simple.

---

Perfect. Here’s a **text-based diagram** you can drop into the markdown file as a new section:

---

## 7. Data Flow Diagrams

### One-Shot Integrators

```
  +-------------+        +---------------+        +-------------+
  | Integrator  | -----> |  Postprocess  | -----> |   Screen    |
  | (Normals,   |        |  (in-shader)  |        | (framebuffer)|
  |  Lambert)   |        +---------------+        +-------------+
         |
         v
   produces LDR color directly
```

* The integrator shader computes color, applies postprocess (e.g. tonemap) inside GLSL, and writes straight to the default framebuffer.
* No history or accumulation is used.

---

### Progressive Integrators

```
            +-------------+
            | Integrator  |
            | (PathTracer)| 
            +-------------+
                   |
                   v
         +--------------------+
         |   History Buffer   | <---+ (previous frame)
         |  (ping-pong pair)  |     |
         +--------------------+     |
                   |                |
                   v                |
          [accumulate new sample] --+
                   |
                   v
         +--------------------+
         |   ScreenPresenter  |
         | (postprocess pass) |
         +--------------------+
                   |
                   v
              +----------+
              |  Screen  |
              |(default) |
              +----------+
```

* The integrator outputs **linear HDR** each frame.
* The history buffer keeps a running average (or other accumulation strategy).
* The presenter applies postprocess exactly once and blits to the screen.

---
