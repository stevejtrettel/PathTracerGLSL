# Current Build Status

## Functional
- **Tracer façade (`tracer/Tracer.ts`)**
  - Wraps engine + systems into an ergonomic API (use -> build -> frame).
  - Manages shader program, uniform managers, quad draw.
- **Core engine (`core/Engine.ts`)**
  - Pure plugin registry; no GPU.
- **Systems**
  - `ShaderAssembler`: assembles fragments with `u_resolution` global.
  - `UniformManager`: binds uniforms, tolerant to missing ones.
  - `ProgramCache`: deduplicates shader programs.
  - `FullscreenQuad`, `ShaderProgram`: working WebGL wrappers.
- **Sandbox plugins**
  - SolidColorPlugin, GradientColorPlugin — verified working.
- **First real plugins**
  - `TestIntegratorPlugin`: trivial integrator, returns constant color.
  - `SRGBDisplayPlugin`: converts HDR vec3 -> clamped 0–1 sRGB.

## In-progress / placeholders
- **Geometry**: not yet implemented. Needed before real ray-based integrators.
- **Camera**: no plugin yet. Integrators currently bypass ray generation.
- **Scene**: no primitives. Will start with hardcoded SDFs.
- **Controls**: not touched yet.

## Removed / refactored
- Engine-owned `u_time`, `u_frame` -> **gone**.  
  Only `u_resolution` is an engine global.  
  Time/frames will be plugin-owned when needed.

---

## Current File Tree

```
src/
├── tracer/
│   └── Tracer.ts
│
├── core/
│   ├── Engine.ts
│   └── types.ts
│
├── systems/
│   ├── ShaderAssembler.ts
│   ├── DependencyResolver.ts
│   └── UniformManager.ts
│
├── rendering/
│   ├── ShaderProgram.ts
│   ├── ProgramCache.ts
│   └── FullscreenQuad.ts
│
├── integration/
│   ├── test_integrator.glsl
│   └── TestIntegrator.ts
│
├── display/
│   ├── srgb_display.ts
│   └── SRGBDisplay.ts
│
├── glsl/
│   └── fullscreen.vert
│
└── main.ts
```

---

## Next Steps

### Step 1 — Euclidean Geometry Stub
- `geometry.types`:
  - `#define Point vec3`, `#define Tangent vec3`, etc.
  - `struct Ray { Point origin; Tangent direction; }`
  - `struct Frame { Point position; Tangent forward, up, right; }`
- `geometry.ops`:
  - `dot_g`, `norm_g`, `normalize_g`
  - optional `GEPS = 1e-5` constant
- `EuclideanGeometryPlugin.ts`: contributes the two chunks, no uniforms.

### Step 2 — Minimal Camera Plugin
- `PinholeCameraPlugin` with GLSL:
  ```glsl
  Ray generateRay(vec2 uv) {
    return Ray(Point(0.0, 0.0, 0.0),
               normalize(vec3(uv - 0.5, -1.0)));
  }
  ```
- No uniforms at first; later add FOV, position.

### Step 3 — Scene Lib
- GLSL chunk with:
  - `float sdfSphere(Point p, float r)`
  - `float sdfPlane(Point p)`
  - `Normal normalFromSDF(...)`
- Included as "lib.sdf" so integrators can depend on it.

### Step 4 — Two Real Integrators
- **NormalsIntegrator**: raymarch scene, color = 0.5*(n+1).
- **DirectLightingIntegrator**: Lambert shading from one directional light.
- Both depend on geometry + camera + sdf lib.

### Step 5 — Hot-Swap Demo
- In `main.ts`, map keys:
  - `3` -> NormalsIntegrator
  - `4` -> DirectLightingIntegrator
- Swap with `tracer.use(new IntegratorX()).build()`.

---

## Summary
We have:
- ✅ Infrastructure (Tracer, Engine, Systems, Rendering helpers).
- ✅ Display plugin.
- ✅ Test integrator.
- ❌ Geometry/camera/scene not yet.
- ❌ Real integrators not yet.

Next: build the **Euclidean stub -> camera -> scene lib -> two integrators** pipeline. That gets us to the true use case: *swapping between integrators that actually trace a scene*.
