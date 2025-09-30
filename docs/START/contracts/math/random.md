Absolutely — here’s a clean, updated write-up you can drop into your docs. I’ve preserved everything that’s still relevant, replaced the outdated RNG bits with the new counter-based system, and added a final chapter with optional upgrades you can bolt on later.

---

# Random Number Generation System

## Overview

The path tracer’s RNG system provides high-quality pseudo-random numbers for Monte Carlo sampling **without threading state through function calls**. Each pixel maintains its own RNG state that automatically advances with each random number request, ensuring decorrelated samples across pixels, frames, and sequential calls within a single path.

This document describes the current **counter-based RNG** (stateless mapping + per-fragment counter), how it’s initialized, how modules consume randomness, and what tradeoffs it entails. A final chapter outlines **optional improvements** you can enable later (per-purpose streams, quasi/blue-noise, etc.).

---

## Architecture

### Core RNG State (per fragment)

```glsl
uint rng_seed;     // Unique per pixel + frame (not shared globally)
uint rng_counter;  // Increments for each requested variate in this fragment
```

GLSL “global” variables in fragment shaders are **per-fragment**. Each pixel’s invocation gets its own copy of `rng_seed` and `rng_counter` that you can freely mutate during that pixel’s execution.

### Why counter-based?

Instead of iterating a hash (`state = hash(state)`), we map **(seed, counter)** through a strong 32-bit mixer:

```
random_u32(k) = mix32(seed + k * C)
```

with `k = rng_counter++` and `C` a Weyl increment (e.g., 0x9E3779B9). This avoids short cycles and eliminates screen-space correlation from feedback PRNGs while keeping the same simple call pattern (`random()`, `random2()`).

---

## RNG Core

### 32-bit mixer

```glsl
uint mix32(uint z) {
    z ^= z >> 16; z *= 0x7feb352du;
    z ^= z >> 15; z *= 0x846ca68bu;
    z ^= z >> 16; return z;
}
```

### Pixel/frame seeding

```glsl
uint hash_init(uvec2 pixel, uint frame) {
    // FNV-1a-ish fold, then final mix; ensure nonzero/odd
    uint h = 2166136261u;
    h = (h ^ pixel.x) * 16777619u;
    h = (h ^ pixel.y) * 16777619u;
    h = (h ^ frame   ) * 16777619u;
    return mix32(h | 1u);
}
```

### Counter → random uint

```glsl
uint rng_u32() {
    // Weyl progression to sweep 32-bit space uniformly
    uint x = rng_seed + rng_counter * 0x9E3779B9u;
    rng_counter++;
    return mix32(x);
}
```

### Float mapping

```glsl
// High-quality uniform in [0,1) using 23 random mantissa bits
float random01() {
    uint bits = (rng_u32() >> 9) | 0x3f800000u; // [1,2)
    return uintBitsToFloat(bits) - 1.0;         // → [0,1)
}

// Convenience
vec2 random2_01() { return vec2(random01(), random01()); }
vec3 random3_01() { return vec3(random01(), random01(), random01()); }
```

> Why not `u32 * 2^-32`? Because 32 bits don’t fit in a 23-bit float mantissa. Building the float directly yields a uniform with full 23-bit precision and better stratification properties.

---

## Initialization (injected prologue)

Initialize once per pixel in `main()` (or your compiler’s prologue):

```glsl
void main() {
    vec2 pixel = gl_FragCoord.xy;

    rng_seed    = hash_init(uvec2(pixel), uint(u_frame_index));
    rng_counter = 0u;

    // Now free to use random01()/random2_01() anywhere
    Ray ray = camera_generateRay(pixel, random2_01());
    // ...
}
```

* **Pixel coordinates** decorrelate neighboring fragments.
* **Frame index** produces a different sequence each frame (temporal AA).
* **No zero seeds**: the init forces nonzero/odd to avoid degenerate paths.

---

## Sampling Utilities (`random.glsl`)

(unchanged in interface; updated to use `random01()`)

```glsl
// Uniform sphere
vec3 sample_sphere_uniform(vec2 xi) {
    float z = 1.0 - 2.0 * xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;
    return vec3(r * cos(phi), r * sin(phi), z);
}

// Cosine-weighted hemisphere (Lambertian)
vec3 sample_hemisphere_cosine(vec2 xi) {
    float z   = sqrt(xi.x);
    float r   = sqrt(max(0.0, 1.0 - xi.x));
    float phi = TWO_PI * xi.y;
    return vec3(r * cos(phi), r * sin(phi), z);
}
```

**Call site pattern remains the same:**

```glsl
vec2 xi = random2_01();  // then pass xi into samplers
```

---

## Integration in `ShaderCompiler`

The compiler injects the RNG core and per-fragment state, plus the initialization into the generated `main()`:

1. **RNG system injection**

```ts
private getRNGSystem(): string {
  return `
uint rng_seed;
uint rng_counter;

uint mix32(uint z) { ... }
uint hash_init(uvec2 pixel, uint frame) { ... }
uint rng_u32() { ... }

float random01() { ... }
vec2  random2_01() { ... }
vec3  random3_01() { ... }
`;
}
```

2. **Prologue in `main()`**

```glsl
vec2 pixel = gl_FragCoord.xy;
rng_seed    = hash_init(uvec2(pixel), uint(u_frame_index));
rng_counter = 0u;
```

All subsequent calls to `random01()` / `random2_01()` use this per-fragment sequence.

---

## Module Usage Pattern

### Internal generation (unchanged)

Each module generates random numbers internally—no `xi` plumbing across call boundaries:

```glsl
// Lighting module
LightSample lighting_sample(Point p) {
    vec2 xi = random2_01();
    // ...
}

// Interaction module
Direction interaction_surface_scatter(Direction wo, Hit hit, out float pdf) {
    vec2 xi = random2_01();
    // ...
}

// Transport
for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
    if (random01() > p_survive) break; // Russian roulette
    vec2 xi = random2_01();            // BRDF sample
    // ...
}
```

### Benefits retained

* **Clean interfaces**: no `xi`/state parameters everywhere.
* **Module independence**.
* **Automatic decorrelation**: sequential calls advance `rng_counter`.
* **No dimension bookkeeping**.

---

## Design Tradeoffs

### Strengths

* **Much better decorrelation** than hash-iteration PRNGs.
* **Deterministic per pixel/frame** (nice for temporal accumulation).
* **Simple mental model**: call `random01()` when needed.
* **Fast**: a couple of integer ops per variate.

### Limitations (and current stance)

* **Exact reproducibility across code changes**: still limited (call-order changes alter counters). If you need strict reproducibility, see Improvements §1–2.
* **No stratification / QMC** out of the box (but easy to add later).
* **Same stream for every purpose** (camera, BSDF, lights) right now; acceptable in practice with the counter approach, but see Improvements §1–2 if patterns reappear.

---

## Performance Characteristics

* **State**: 2× `uint` per fragment (8 bytes).
* **Cost**: 1 `mix32` + a few integer ops per variate.
* **Quality**: Good 32-bit avalanche + 23-bit float mapping.
* **Decorrelation**: Effective across pixels, frames, and sequential draws.

---

## Debugging & Sanity Checks

* **White noise test**
  Replace output with `return RGB(vec3(random01()));` — should look like clean static, no bands.
* **Two-channel test**
  `return RGB(vec3(random2_01(), 0.0));` — both channels equally noisy, uncorrelated.
* **Counter reset**
  Ensure `rng_counter = 0u;` is set once per pixel in your prologue.
* **Frame advance**
  Confirm `u_frame_index` increments each accumulation frame.

---

## Migration Notes (from the old system)

* **Removed**: iterative Wang hash as PRNG state (`rng_seed = wang_hash(rng_seed)`).
* **Added**: counter-based core `rng_u32()` with `mix32` and Weyl progression.
* **Float mapping**: prefer `random01()` (23-bit) over scaling `u32 * 2^-32`.
* **Everything else unchanged**: sampling utilities, module-internal generation pattern, and integration strategy.

---

# Potential Improvements (Optional)

These are **drop-in upgrades** you can add later without changing module interfaces (or with a single find/replace). None are required for good results; they’re here for when you want extra robustness or art-directable behavior.

## 1) Per-purpose streams (no plumbing)

**A. Semantic helpers (one header, one find/replace):**

```glsl
const uint RNG_TAG_CAMERA = 0xC1A0A3E1u;
const uint RNG_TAG_BSDF   = 0xB5DF00D5u;
const uint RNG_TAG_LIGHT  = 0xA1D1A1B5u;
const uint RNG_TAG_RR     = 0x9E3779B9u;

uint rng_u32_stream(uint tag) {
    uint x = rng_seed + rng_counter * 0x9E3779B9u + tag * 0x85ebca6bu;
    rng_counter++;
    return mix32(x);
}
float rng01_stream(uint tag) {
    uint bits = (rng_u32_stream(tag) >> 9) | 0x3f800000u;
    return uintBitsToFloat(bits) - 1.0;
}
vec2 rng2_camera() { return vec2(rng01_stream(RNG_TAG_CAMERA), rng01_stream(RNG_TAG_CAMERA)); }
vec2 rng2_bsdf()   { return vec2(rng01_stream(RNG_TAG_BSDF),   rng01_stream(RNG_TAG_BSDF)); }
vec2 rng2_light()  { return vec2(rng01_stream(RNG_TAG_LIGHT),  rng01_stream(RNG_TAG_LIGHT)); }
```

Then replace `random2_01()` with `rng2_bsdf()` (or camera/light) in the relevant modules.

**B. Compiler auto-tagging (zero module edits):**
Have your `ShaderCompiler` inject a unique `RNG_TAG` (FNV-1a hash of module id) and remap:

```glsl
#define RNG_TAG 0xDEADBEEFu
#define random01() rng01_stream(RNG_TAG)
#define random2_01() vec2(random01(), random01())
```

## 2) Cranley–Patterson rotation (per-pixel shift)

Apply a random per-pixel/frame offset to any 2D sample to break residual grid alignment:

```glsl
vec2 cp_rotate(vec2 xi) { return fract(xi + random2_01()); }
```

## 3) Exclusive ranges for fragile transforms

Avoid exact 0 or 1 when using `log`, `tan`, `acos`:

```glsl
float random01_exclusive() {
  const float eps = 1.0/8388608.0; // 2^-23
  float r = random01();
  return clamp(r, eps, 1.0 - eps);
}
```

## 4) Blue-noise seeds for low SPP

Use a small tileable blue-noise texture to seed the first few dimensions (camera jitter, direct light) and then fall back to RNG for the rest. Greatly reduces structured noise at very low sample counts.

## 5) Quasi-random sequences (later)

For stratification/convergence wins, replace the first N dimensions with Sobol/Halton (with scrambling and per-pixel Owen rotations), then keep the counter-based RNG for the rest.

## 6) Stronger PRNG families (if desired)

* **SFC32 / xoshiro128**: fast, excellent stats (4× `uint` state).
* **Philox / Threefry**: counter-based, ideal for GPU; slightly heavier ALU.
* **PCG32**: great quality but needs 64-bit ops (emulation in GLSL adds cost).

---

## TL;DR

* You now use a **counter-based RNG** with a strong mixer: simple, fast, and far fewer screen-space correlations.
* Keep calling `random01()` / `random2_01()` inside modules—no state threading needed.
* When you’re ready, enable one of the **per-purpose stream** options to lock in decorrelation without changing module interfaces.
