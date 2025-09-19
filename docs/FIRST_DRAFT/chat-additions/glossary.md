# Glossary (Core Terms)

Short, precise definitions used across **World**, **Photography**, **Engine**, and **App**. When in doubt, defer to **Core Principles**.

---

## Pillars & Orchestration

- **World** — What exists: *Geometry*, *Scene*, *Materials*, *Lights*. No transport logic.
- **Photography** — How we measure: *Camera*, *Estimator*, *Film*, *Developer*.
- **Engine** — Deterministic infrastructure: compilation, resource binding, draw calls, readback.
- **App** — Orchestration & workflows: *Recipe*, *ParameterStore*, *RenderCoordinator*, *Extensions/Services*.

- **Recipe** — A complete configuration naming modules (by kind/name/version) with initial parameters and optional variants.
- **Recipe Variant** — A small delta over a base recipe (e.g., “Preview”, “Production”).

---

## World

- **Geometry** — Metric, geodesic propagation, frames, dot product in the chosen manifold; agnostic to scene content.
- **Scene** — Spatial organization and intersection/inside queries over objects (SDFs, meshes, CSG, etc.).
- **Object** — Placement + material ID; never stores appearance.
- **Material** — Appearance laws: BRDF/phase, absorption; provides `eval/sample/pdf`; no control flow.
- **Light** — Radiance providers: analytic, area, environment. Provide `sample/eval/pdf`.

- **Emissive Material** — A material that emits radiance; may be exposed to the light sampling system per policy.

---

## Photography

- **Camera** — Maps pixel + subpixel RNG to a world-space ray using engine-provided uniforms (position, frame, optics).
- **Estimator** — Owns transport: path tracing, direct-only, MIS, delta tracking, medium handling, etc.
- **Film** — Accumulates per-pixel statistics (mean/variance/history). GPU-resident by default.
- **Developer** — Maps HDR linear radiance to display (tone mapping, false color). No scene/transport effects.

- **Analysis Mode** — Debug visualization replacing the normal output (normals, depth, IDs, variance, zebras, false color).

---

## Engine

- **Shader Compiler** — Collects modules, validates deps, prefixes functions, generates `main()`, extracts uniforms, compiles/links.
- **Uniform Binder** — Deterministic map from parameter paths to GLSL uniforms; batches updates once per frame.
- **Resource Manager** — Allocates film attachments/textures/FBOs, validates capabilities, manages ping‑pong, lifetimes.
- **Render Executor** — Configures target + viewport, binds full-screen triangle, issues draw, supports readback, tracks stats.

- **Program Key** — Deterministic hash of module choices + compile-time flags controlling shader variants.
- **Film Manifest** — Declarative description of film resources (attachments, formats, persistence, swap policy).

---

## App & State

- **ParameterStore** — Central state: typed paths with metadata, validation, batch onChange notifications.
- **RenderCoordinator** — Mode control (interactive/progressive/production), accumulation policy, progress reporting, tiling.
- **Extension (Service)** — Optional feature installed without modifying App/Engine APIs; accessed via service registry and event bus.

---

## Sampling & Determinism

- **Seed** — Fixed initial RNG seed producing reproducible sequences system-wide.
- **Sampling Dimensions** — Reserved RNG coordinates assigned per subsystem (camera vs estimator, etc.).
- **Accumulation** — Progressive refinement across frames/samples (incremental mean/variance).

---

## Errors & Fallbacks

- **Fatal Error** — Must abort (e.g., shader compile/link failure, out-of-memory).
- **Recoverable Error** — Warn and continue with default/fallback (e.g., missing parameter with safe default).
- **Research Error** — Invalid sample (NaN/INF) sanitized to black; increments counters; run continues.
- **Capability Fallback** — Alternative formats/modes when GPU features are missing (e.g., LDR instead of HDR).

---

## Production

- **Tile** — Sub-rectangle of the frame rendered independently (with its own accumulation/reset).
- **Checkpoint** — Saved partial result enabling resume/retry for long runs.
- **Readback** — CPU copy of GPU film buffers; sync or async; used for export/checkpoints/testing.