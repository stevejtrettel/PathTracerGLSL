
# ScreenPresenter

> A tiny “present” pass that turns an **HDR texture** into **on-screen pixels** by running a **postprocess plugin** (tonemap → sRGB) and drawing a fullscreen quad to the default framebuffer.

ScreenPresenter is used by the **progressive** path-tracing path (where the integrator writes HDR into a history buffer). For **one-shot** integrators, you usually call `postprocess()` in the main fragment and **don’t** use ScreenPresenter.

---

## What it does

* Binds the **default framebuffer** (the canvas).
* Uses a minimal fragment shader that:

    1. samples an input HDR texture (`u_src`),
    2. calls the active **postprocess** plugin entrypoint
       `vec3 postprocess(vec3 hdr)`,
    3. writes the LDR result to `outColor`.
* Sets common globals like `u_resolution`.
* Draws a fullscreen quad.

---

## When to use it

* **Progressive** rendering: integrator renders to `history.write`, ping-pongs to `history.read`, then ScreenPresenter displays `history.read`.
* Multi-stage pipelines where the final stage is “take **this** HDR texture and apply **that** postprocess”.

> For **one-shot** integrators, prefer keeping postprocess inline in the integrator’s shader (keeps the pipeline single-pass).

---

## Postprocess contract

Postprocess is a regular plugin (role: `"postprocess"`) that must contribute:

```glsl
// REQUIRED entrypoint:
vec3 postprocess(vec3 hdr);
```

Typical postprocess implementations do:

* tonemapping (Reinhard, ACES, filmic),
* clamp to \[0,1],
* linear → sRGB (or any display transfer function).

Example (our default tonemap+SRGB):

```glsl
vec3 tonemapReinhard(vec3 x) { return x / (x + vec3(1.0)); }
vec3 linear_to_srgb(vec3 c) {
  vec3 a = 12.92 * c;
  vec3 b = 1.055 * pow(c, vec3(1.0/2.4)) - 0.055;
  return mix(a, b, step(vec3(0.0031308), c));
}
vec3 postprocess(vec3 hdr) {
  vec3 ldr = tonemapReinhard(hdr);
  return linear_to_srgb(clamp(ldr, 0.0, 1.0));
}
```

---

## API

```ts
class ScreenPresenter {
  constructor(gl: WebGL2RenderingContext);

  // Present the texture bound to the given texture unit.
  blitFromTexUnit(opts: { srcUnit: number }): void;

  // Free GL resources (programs, VAOs as applicable).
  dispose(): void;
}
```

### Uniforms (provided/expected)

* **Inputs set by ScreenPresenter:**

    * `u_resolution : vec2` — canvas size in pixels.
    * `u_src        : sampler2D` — bound to the `srcUnit` you pass.

* **Provided by your postprocess plugin:**

    * `vec3 postprocess(vec3 hdr);`

> If the postprocess plugin declares additional uniforms (e.g., exposure), `Tracer` will still prefix/bind them via `UniformManager` under the plugin’s namespace.

---

## Typical usage (progressive flow)

**CPU orchestration** (simplified):

```ts
// 1) Integrator drew into history.write, then ping-ponged:
bm.swap("history.read", "history.write");

// 2) Bind history.read for sampling at a known unit:
const SRC_UNIT = 0;
bm.bindAsTexture("history.read", SRC_UNIT);

// 3) Present:
presenter.blitFromTexUnit({ srcUnit: SRC_UNIT });
```

**Presenter fragment shader** (conceptually):

```glsl
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2      u_resolution;
uniform sampler2D u_src;

// From the active postprocess plugin:
vec3 postprocess(vec3 hdr);

void main() {
  vec3 hdr = texture(u_src, v_uv).rgb;
  vec3 ldr = postprocess(hdr);      // tonemap + OETF (e.g., sRGB)
  outColor = vec4(ldr, 1.0);
}
```

---

## Do / Don’t

**Do**

* Use ScreenPresenter only once per frame in **progressive** mode.
* Keep postprocess side-effect free (pure function of HDR color).
* Bind exactly one source texture (`u_src`). If you need more inputs, extend the presenter or use a multi-input postprocess plugin.

**Don’t**

* Don’t call `postprocess()` **both** in the integrator and in the presenter (you’ll tonemap twice).
* Don’t sample `history.write` directly in the presenter—always sample the **read** side after ping-pong.

---

## Integration with Tracer

* **One-shot**: Tracer draws once; postprocess is typically called **inside** the integrator’s shader; ScreenPresenter is **not** used.
* **Progressive**: Tracer

    1. ensures `history.read/write`,
    2. draws integrator into `history.write`,
    3. swaps read/write,
    4. binds `history.read` to a texture unit,
    5. calls `ScreenPresenter.blitFromTexUnit({ srcUnit })`.

Tracer is also responsible for **resetting** history (e.g., resize, variant switch, param change) so the next present starts from clean state.

---

## Performance notes

* The presenter is a **single** fullscreen draw to the default framebuffer.
* No mipmapping or filtering changes; sampling uses whatever filtering you created on the input texture (use `nearest` for history).
* Keep the postprocess lightweight; complex denoisers or multi-tap filters belong in a dedicated pass, not the presenter.

---

## Troubleshooting

* **Everything turns gray**: you likely postprocessed **twice** (in the integrator and in the presenter). Remove one.
* **Banding**: you might be clamping too early or writing LDR to the history buffer. History must be **HDR** (e.g., `rgba16f`).
* **Inverted/rotated**: check your vertex shader for the fullscreen quad and coordinate convention.
* **Black output**: verify `u_src` is bound to the same unit you pass to `blitFromTexUnit`.

---

## Extending ScreenPresenter

* **Extra inputs**: add more sampler uniforms (`u_src2`, `u_src3`) and expose a `blitFromTexUnits({ units: number[] })`.
* **Capture**: add an optional “readback” path to save screenshots (bind a temporary FBO, blit, and `readPixels`).
* **HDR output**: if you target an HDR display pipeline, make the postprocess configurable or bypass it entirely.

---

That’s it—ScreenPresenter is intentionally small: one input HDR texture, one postprocess call, one fullscreen draw to the canvas. It keeps the progressive pipeline clean and makes “what goes to the screen” explicit.
