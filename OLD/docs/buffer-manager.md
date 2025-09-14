Here’s a drop-in **`docs/BufferManagement.md`** you can add to the repo.

---

# Buffer Management

> How we allocate, reuse, and present GPU buffers for one-shot and progressive rendering.

This document covers the **BufferManager** and how it fits with **ScreenPresenter** and **Tracer** to support:

* one-shot integrators (no history), and
* progressive integrators (history ping-pong + postprocess).

---

## Goals

* **Named resources**: refer to textures/FBOs by stable string names (e.g. `"history.read"`).
* **Reuse & speed**: cache FBOs and avoid per-frame thrash.
* **Ping-pong**: ergonomic history swapping (`read ↔ write`) for accumulation.
* **MRT ready**: bind an ordered set of targets for multi-render-targets.
* **Clear & resize**: clear by **lifetime** and rebuild on size changes.
* **Simple present**: one blit step to display, with a postprocess plugin in the path.

---

## Key Concepts

### Named buffers (AOVs)

Every renderable texture has:

* **name** (string): your handle, e.g. `"history.read"`, `"albedo"`.
* **desc**: `{ format, size, lifetime, filtering, clear }`.

### Lifetimes

* **`"perFrame"`**: cleared each frame (e.g., transient AOVs).
* **`"history"`**: persists across frames until reset (e.g., accumulation).

### Ping-pong

Two textures for the same logical data:

* `"history.read"`: sampled this frame (previous result).
* `"history.write"`: written this frame (new result).
  Swap names when the frame ends.

### MRT binding

Bind **N** named buffers to `COLOR_ATTACHMENT0..N-1` in one call.
BufferManager validates the count and builds (or reuses) an FBO.

---

## API Overview

### Types

```ts
type Lifetime = "perFrame" | "history";
type TargetFormat = "rgba16f" | "rgba8" | "rg16f" | "r16f" | "r32f";

interface BufferDesc {
  format: TargetFormat;
  size: { w: number; h: number };
  lifetime: Lifetime;                  // perFrame | history
  filtering?: "nearest" | "linear";    // default: nearest
  clear?: [number, number, number, number]; // RGBA clear (default 0s)
}
```

### Core methods (high-level)

* `ensure(name, desc)`: create if missing or (re)create if size/format changed.
* `alias(name, texture, desc)`: adopt an external texture under a name.
* `swap(a, b)`: exchange textures & descs (ping-pong).
* `bindAsTexture(name, unit)`: bind named texture for sampling.
* `bindAsDrawTarget(names[])`: bind FBO for MRT; caches per unique `names.join(",")`.
* `unbindDrawTarget()`: restore previous FBO binding.
* `clearByLifetime(lifetime)`: clear all buffers with matching lifetime.
* `resize(name, w, h)` / `resizeAll(w, h)`: resize one/all named buffers.
* `getTexture(name)`: raw WebGL texture (rarely needed).

> **Performance:** FBOs and a scratch FBO for clears are cached/reused. No per-frame thrashing.

---

## Typical Patterns

### 1) Progressive accumulation (history ping-pong)

Engine (Tracer) ensures history buffers exist at the current viewport size:

```ts
bm.ensure("history.read",  { format:"rgba16f", size:{w,h}, lifetime:"history", filtering:"nearest" });
bm.ensure("history.write", { format:"rgba16f", size:{w,h}, lifetime:"history", filtering:"nearest" });

const fbo = bm.bindAsDrawTarget(["history.write"]);    // draw HDR into write
// ... issue draw calls ...
bm.unbindDrawTarget();

bm.swap("history.read", "history.write");               // next frame will read the new result
```

In the shader, sample the **previous** accumulation and combine:

```glsl
uniform sampler2D u_historyColor;
uniform int       u_sampleCount; // previous count

vec3 accumulate_box(vec3 current, vec3 history, int prevCount) {
  float n = float(prevCount);
  return (history * n + current) / (n + 1.0);
}
```

### 2) AOVs / MRT

Attach multiple render targets in order:

```ts
bm.ensure("albedo", { format:"rgba16f", size:{w,h}, lifetime:"perFrame" });
bm.ensure("normal", { format:"rgba16f", size:{w,h}, lifetime:"perFrame" });

bm.bindAsDrawTarget(["albedo", "normal"]); // COLOR_ATTACHMENT0,1
// ... draw (shader writes to layout(location = 0/1)) ...
bm.unbindDrawTarget();
```

### 3) Clear & reset

* On **resize** and **variant switch**, Tracer typically resets progressive history:

```ts
bm.clearByLifetime("history");   // wipes accumulation only
```

* On **per-frame AOVs**, you can either clear via MRT attach then `gl.clear`, or just overwrite.

---

## Where ScreenPresenter Fits

**ScreenPresenter** is a tiny blit pass used in **progressive** mode:

* Input: HDR texture (usually `"history.read"`) bound to a texture unit.
* Path: **postprocess** plugin is executed once here (tonemap → sRGB).
* Output: default framebuffer (the screen).

Usage:

```ts
// Tracer after ping-pong swap:
presenter.blitFromTexUnit({ srcUnit: 0 /* bound to history.read */ });
// presenter uses the active postprocess GLSL and a fullscreen quad under the hood
```

For **one-shot** integrators, the postprocess usually happens **inside** the main fragment and no separate present step is used.

---

## Formats & “strange” cases

Recommended defaults:

* **Accumulation/History**: `rgba16f` (wide range, widely supported for color render targets).
* **Per-frame AOVs**: `rgba16f` or `rgba8` (if LDR is fine).
* **Moments/variance**: `rg16f`, `r16f`.

Notes:

* `r32f` may not be color-renderable on all devices; prefer `rgba16f` unless you truly need 32-bit single-channel.
* Use **`nearest`** filtering for history (avoids sampling artifacts). AOVs used for postprocessing can use `linear` if desired.
* WebGL2 float color attachments require appropriate GPU/driver support; BufferManager logs/warns when extensions appear missing.

---

## Integration with Tracer

**One-shot**

* BufferManager is typically idle (no history). The fragment shader does any postprocess itself.
* Tracer draws once to the default framebuffer.

**Progressive**

* Tracer uses BufferManager to:

  * ensure `history.read/write`,
  * bind `history.write` as the draw target,
  * supply engine uniforms (`u_frameIndex`, `u_sampleCount`, `u_historyColor`),
  * draw the integrator,
  * `swap("history.read","history.write")`,
  * present via ScreenPresenter,
  * update counters.
* Resets: `clearByLifetime("history")` when canvas resizes, integrator/variant changes, or history-invalidating params change.

---

## Error Handling & Validation

* **MRT limit**: validated against `gl.MAX_COLOR_ATTACHMENTS` in `bindAsDrawTarget`.
* **Unknown names**: helpful errors for missing textures.
* **FBO completeness**: checked once when building cached FBOs (meaningful error if incomplete).
* **State safety**: `unbindDrawTarget()` restores the previous framebuffer binding.

---

## Debugging Tips

* **List buffers**: add a small helper to list names & descs when needed.
* **Readback** (debug only): bind a single target and `gl.readPixels` into a typed array.
* **NaNs/Inf**: accumulation going grey/black often means NaNs sneaking in—check the integrator math before blaming BufferManager.

---

## FAQ

**Q: Why name buffers instead of passing raw textures around?**
A: Names give you a stable contract between CPU orchestration and GLSL. It also makes ping-pong and MRT declarations trivial and readable.

**Q: Do I still need a separate PingPong class?**
A: No. Ping-pong is a one-liner: `bm.swap("history.read","history.write")`. Keeping it inside BufferManager simplifies ownership and avoids state duplication.

**Q: Where does postprocess happen?**
A: For **progressive**, in **ScreenPresenter** (once per frame). For **one-shot**, typically inside your integrator shader (call `postprocess()` directly).

**Q: Can I add more histories (e.g., variance, motion vectors)?**
A: Yes—`ensure()` them with `lifetime: "history"`, bind as MRT, and sample next frame by name.

---

## Minimal Example (progressive)

```ts
// Resize path
bm.ensure("history.read",  { format:"rgba16f", size:{w, h}, lifetime:"history", filtering:"nearest" });
bm.ensure("history.write", { format:"rgba16f", size:{w, h}, lifetime:"history", filtering:"nearest" });

// Frame
const fbo = bm.bindAsDrawTarget(["history.write"]);
program.use();
UM("").set2f("u_resolution", w, h);
UM("").set1i("u_frameIndex", frameIndex);
UM("").set1i("u_sampleCount", sampleCount);
bm.bindAsTexture("history.read", 0);
UM("").set1i("u_historyColor", 0);

// per-plugin uniforms …
quad.draw();
bm.unbindDrawTarget();

// Swap & present
bm.swap("history.read","history.write");
presenter.blitFromTexUnit({ srcUnit: 0 });

// Counters
sampleCount++;
frameIndex++;
```

---

That’s the complete picture: **BufferManager** owns textures/FBOs and lifetimes; **ScreenPresenter** turns HDR into pixels on screen; **Tracer** decides when to reset and how to route the frame through these pieces for one-shot vs progressive rendering.
