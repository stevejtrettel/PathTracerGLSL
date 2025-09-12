# Buffer Manager

> A small WebGL2 utility that owns named render textures (AOVs, histories), binds them as MRT draw targets, manages **ping-pong pairs**, and clears/resizes them efficiently. It’s designed for our one-pass + blit pipeline and progressive path tracing.

---

## What it does

* **Create & alias** named 2D textures (e.g., `hdr`, `albedo`, `normal`, `moments`).
* **Bind as textures** for sampling and **as draw targets** (MRT) for rendering.
* **Cache FBOs** per attachment set (no per-frame framebuffer churn).
* **Fast clears** by lifetime: `"perFrame"` vs `"history"`.
* **Resize** on canvas/DPR changes (per name or bulk).
* Built-in **ping-pong pairs** for history (Option C).
* Guardrails: **MRT count** validation, **EXT\_color\_buffer\_float** check.
* **State restore**: `unbindDrawTarget()` returns to the previous FBO.

---

## Key concepts

* **Named texture**: you interact with buffers by stable string names (e.g., `"historyA"`).
* **Lifetime**:

    * `"perFrame"`: cleared every frame (transients like G-buffer AOVs).
    * `"history"`: persists across frames (accumulations, moments).
* **Ping-pong pair**: a base name (`"history"`) maps to two textures `historyA/historyB` with a flip bit. Each frame you write to one and sample the other, then `swapPair("history")`.

---

## API (TypeScript)

```ts
new BufferManager(gl: WebGL2RenderingContext)

create(name: string, desc: BufferDesc): WebGLTexture
alias(name: string, tex: WebGLTexture, desc: BufferDesc): void

resize(name: string, w: number, h: number): void
resizeAll(w: number, h: number): void

bindAsTexture(name: string, unit: number): void

bindAsDrawTarget(names: string[]): void
unbindDrawTarget(): void

clearByLifetime(l: "perFrame" | "history"): void

// Ping-pong (built-in)
createPair(base: string, desc: BufferDesc): [string, string]
pairRead(base: string): string              // current “previous”
pairWrite(base: string): string             // current “next”
swapPair(base: string): void
bindPairReadAsTexture(base: string, unit: number): void
bindPairWriteAsDrawTarget(base: string): void
resizePair(base: string, w: number, h: number): void

// Utilities
list(): string[]
getDesc(name: string): BufferDesc | undefined
getTexture(name: string): WebGLTexture | undefined
dispose(): void
```

### `BufferDesc`

```ts
interface BufferDesc {
  format: "rgba16f" | "rg16f" | "r16f" | "rgba8" | "r32f"; // r32f sampling-only on WebGL2
  size: { w: number; h: number };
  lifetime: "perFrame" | "history";
  filtering?: "nearest" | "linear";  // default: nearest
  clear?: [number, number, number, number]; // default: [0,0,0,0]
}
```

---

## Usage patterns

### 1) Create buffers (on build/resize)

```ts
const bm = new BufferManager(gl);

// History pair for progressive color accumulation
bm.createPair("history", {
  format: "rgba16f",
  size: { w: canvas.width, h: canvas.height },
  lifetime: "history",
  filtering: "nearest",
  clear: [0,0,0,0]
});

// Optional per-frame AOVs (albedo/normal, etc.)
bm.create("albedo", { format: "rgba16f", size, lifetime:"perFrame" });
bm.create("normal", { format: "rgba16f", size, lifetime:"perFrame" });
```

### 2) Per-frame loop (integrator pass + present)

```ts
// 1) Bind previous history for reading (TU0)
bm.bindPairReadAsTexture("history", 0);
prog.set1i("u_historyColor", 0);
prog.set1i("u_frameIndex", frameIndex);
prog.set1i("u_sampleCount", sampleCount);

// 2) Bind write target (MRT if you have more outputs)
bm.bindPairWriteAsDrawTarget("history");
// ... gl.viewport, prog.use(), fullscreenQuad.draw()
bm.unbindDrawTarget();

// 3) Present (blit via postprocess shader)
//   bind freshly written history (pairRead points at it after swap? see below)
present.use();
bm.bindAsTexture(bm.pairWrite("history"), 0); // the one we just wrote to
present.set1i("u_src", 0);
fullscreenQuad.draw();

// 4) Flip & tick
bm.swapPair("history");
sampleCount += 1;
frameIndex += 1;
```

> Tip: Present using the **texture you just rendered into** (pre-swap), then swap. Alternatively, call `bm.swapPair("history")` first and present `bm.pairRead("history")`. Just be consistent.

### 3) Clearing by lifetime

```ts
// On accumulation reset (resize, variant switch, param marked resetAccumulation)
sampleCount = 0;
frameIndex = 0;
bm.clearByLifetime("history");
```

### 4) Canvas resize / DPR change

```ts
bm.resizePair("history", newW, newH);
bm.resize("albedo", newW, newH);
bm.resize("normal", newW, newH);
bm.clearByLifetime("history");
sampleCount = frameIndex = 0;
```

---

## Display “blitter”

We present by drawing a fullscreen quad that samples the HDR texture and calls the display plugin:

```glsl
// present.frag
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
vec3 display(vec3 hdr); // provided by postprocess plugin

void main(){
  vec3 hdr = texture(u_src, v_uv).rgb;
  outColor = vec4(display(hdr), 1.0);
}
```

Bind the source with `bm.bindAsTexture(name, unit)` and draw. This keeps integrators pure (return linear HDR).

---

## Design choices (why it’s like this)

* **FBO cache**: We allocate one FBO per attachment set and **re-attach textures each bind**. This avoids per-frame FBO thrash and naturally tracks resizes/aliases.
* **Scratch FBO clear**: One reusable FBO for clears; much faster than create/delete per texture.
* **State restore**: `unbindDrawTarget()` resets the FBO to what the app had bound, avoiding GL state leaks.
* **Option C ping-pong**: History flip lives here; tracer code stays tiny and focused.
* **Validation**: We check `MAX_COLOR_ATTACHMENTS` and warn if `EXT_color_buffer_float` is missing (RGBA16F rendering may not be supported on some platforms).

---

## Gotchas & tips

* **EXT\_color\_buffer\_float**: Without it, rendering to `rgba16f` may fail. We log a warning in the constructor. Consider falling back to `rgba8` or a different path for those devices.
* **MRT limits**: Typical WebGL2 limit is 4 color attachments. We validate and throw if exceeded.
* **Present source**: Present the texture **you just wrote** this frame (before swap), or swap first and present `pairRead`. Don’t double-swap.
* **Clears**: Only clear `"history"` on resets; clear `"perFrame"` each frame if you rely on implicit zeros.
* **Formats**:

    * `r32f` is often **not renderable** in WebGL2 (sampling is fine). Prefer `r16f`/`rg16f` for render targets.
    * Use `nearest` for history to avoid bilinear mixing of samples; switch to `linear` intentionally (e.g., for filtered AOVs).
* **State order**:

    1. `bindAsDrawTarget` → draw
    2. `unbindDrawTarget`
    3. Present (sample as texture)
    4. `swapPair`
* **Teardown**: Call `dispose()` on context loss or app shutdown.

---

## Minimal progressive tracer loop (reference)

```ts
// setup (once or on resize)
bm.createPair("history", { format:"rgba16f", size:{w,h}, lifetime:"history", filtering:"nearest", clear:[0,0,0,0] });

// per frame
prog.use();
prog.set2f("u_resolution", w, h);
prog.set1i("u_frameIndex", frameIndex);
prog.set1i("u_sampleCount", sampleCount);

bm.bindPairReadAsTexture("history", 0);
prog.set1i("u_historyColor", 0);

bm.bindPairWriteAsDrawTarget("history");
fullscreenQuad.draw();
bm.unbindDrawTarget();

// present the just-written texture
present.use();
bm.bindAsTexture(bm.pairWrite("history"), 0);
present.set1i("u_src", 0);
fullscreenQuad.draw();

// advance
bm.swapPair("history");
sampleCount++;
frameIndex++;
```

---

## FAQ

* **Do I still need a separate PingPong class?**
  No. Use `createPair/pairRead/pairWrite/swapPair`.

* **Can I use MRT?**
  Yes—pass multiple names to `bindAsDrawTarget([...])`. Respect `MAX_COLOR_ATTACHMENTS`.

* **Where do integrator “caps” fit?**
  When you add caps, they should specify **what targets to create** (by name/format/lifetime). You’ll call `create()`/`createPair()` here based on those caps.

---

That’s it. With `BufferManager` in place, the progressive path tracer is just: **read history → integrate one sample → box-accumulate → write history → present → swap**.
