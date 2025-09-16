Here’s a single doc you can drop into `docs/engine-architecture.md`. It defines the **Minimal Core** (your “dumb executor”), the **Expanded Engine**, and a practical **upgrade plan**—including *when*, *why*, and *how* to move up a notch.

---

# Two-Tier Engine Architecture for a Research Path Tracer

*(Minimal Core now; Expanded Engine when it pays off)*

## Executive summary

We adopt a two-tier architecture:

* **Tier 1 — Minimal Core (“dumb executor”)**: tiny, stable, gets pixels fast. Research modules supply GLSL; the engine compiles, binds, and runs full-screen passes. Great for early experiments and focused algorithm work.

* **Tier 2 — Expanded Engine (“guardrails & scale”)**: adds lightweight assembly checks, resource pooling, shader caching, deterministic sampling layout, and simple diagnostics. Same mental model, more safety and speed when complexity grows.

We start on Tier 1 and upgrade **incrementally** based on clear triggers (compile churn, collisions, reuse needs), without re-writing research modules.

---

## Tier 1 — Minimal Core

### Purpose

Provide a boring, reliable executor that keeps WebGL out of research code. It concatenates module GLSL, compiles once, binds parameters, runs a trace pass, then a film pass to accumulate, and presents to the screen.

### Responsibilities

* Compile/link shader programs from provided GLSL text.
* Bind parameters to uniforms (one snapshot per frame).
* Manage a handful of textures/FBOs (current, previous, accumulated).
* Execute a small, ordered list of full-screen passes (trace → accumulate → display).

### Non-responsibilities

* No dependency resolution or symbol collision checks.
* No feature hashing or program cache beyond a single program handle.
* No hot-swap or multi-pipeline residency.
* No deterministic sampling layout orchestration.
* No diagnostics beyond basic GL errors.

### Minimal file tree

```
engine/
  core/
    Engine.ts              # Frame loop, orchestration, resize
    Context.ts             # Canvas + WebGL2 + logger
  execution/
    Pass.ts                # Fullscreen pass descriptor + execute()
    PassRunner.ts          # Runs [trace, accumulate, display]
    FullscreenTriangle.ts  # Single VAO helper
  resources/
    Texture.ts             # Thin wrapper (size, format)
    Framebuffer.ts         # FBO wrapper (attach textures)
    ResourcePool.ts        # Very simple reuse by (w,h,format)
    PingPong.ts            # Double buffer + swap()
  shaders/
    ShaderProgram.ts       # Compile/link, reflect minimal locations
    ShaderBuilder.ts       # Concatenate module GLSL in a fixed order
  parameters/
    ParameterSet.ts        # Namespace→value map
    UniformBinder.ts       # Apply parameter set to program
```

### Core contracts

* **Shader modules** (research) expose:

    * `getShaderCode(): string` — GLSL fragment(s) for their role.
    * `getParameters(): descriptors` — names, defaults, (optional) uniform names.
* **Pass** consumes a compiled program, named input textures, and an output target; it binds and draws the full-screen triangle.

### Frame lifecycle (Tier 1)

1. If resized: reallocate textures/FBOs.
2. Build (or reuse) **trace pass** program; bind snapshot of parameters; draw into `current`.
3. Run **film pass** once (accumulate `previous` + `current` → `accumulated`).
4. Blit/display `accumulated` to screen; `swap(previous, accumulated)` for next frame.

### Invariants

* No runtime `#ifdef` feature branching inside assembled shader.
* Research modules **never** call WebGL.
* One immutable **parameter snapshot per frame**.

### Strengths

* \~500–900 SLOC engine; easy to reason about.
* Fast path to “first pixels”.
* Clean separation keeps research code focused.

### Limitations / risks

* **Name collisions** & **ordering bugs** (plain concatenation).
* **Unnecessary recompiles** (no cache key).
* **Sampler correlations** (no layout coordination).
* **Accumulation breakage on resize** unless handled carefully.
* Weak introspection when debugging (“why did this compile?”).

---

## Tier 2 — Expanded Engine

### Purpose

Preserve the “dumb executor” feel while adding **guardrails** that become essential with multiple tracers, curved geometries, and longer experiments (A/B pipelines, reproducibility, performance).

### What’s added (and why)

* **Assembler-Lite** (prefix + requires/provides): prevents symbol collisions and missing dependencies while still emitting a single, minimal shader (no runtime defines).
* **FeatureHash + ProgramCache**: compile programs once per configuration; huge iteration speed-up.
* **Parameter snapshots** (unchanged concept, better plumbing): immutable per frame; `UniformBinder` uses reflection to avoid mis-binds.
* **SampleLayout**: deterministic indexing `(pixel, frame, domain, dim)` so different samplers (RNG/Sobol/blue-noise) can be swapped safely without hidden correlations.
* **CapabilityQuery**: choose legal float/MRT formats based on device; fewer “works on my GPU” surprises.
* **ResourcePool + PingPong + Framebuffer helper**: stable accumulation across frames/resizes; less boilerplate.
* **Optional diagnostics**: cheap stats (compile time, frame time) + shader dumps to understand what was built.

### Expanded file tree (lean version)

```
engine/
  core/
    Engine.ts              # As Tier 1; adds simple hot-swap and resize policy
    Context.ts
    CapabilityQuery.ts     # Probe float RTs, MRT, precision needs
  execution/
    Pass.ts
    PassRunner.ts
    FullscreenTriangle.ts
  resources/
    Texture.ts
    Framebuffer.ts
    ResourcePool.ts
    PingPong.ts
  shaders/
    ShaderProgram.ts
    AssemblerLite.ts       # Prefix + requires/provides + glue
    FeatureHash.ts         # Cache key from modules/constants/formats/res-bin
  parameters/
    ParameterStore.ts      # Descriptors + transactions
    Snapshot.ts            # Frozen, per-frame view
    UniformBinder.ts       # Reflection-aware binding
  sampling/
    SampleLayout.ts        # Named domains, deterministic allocation
  diagnostics/ (optional)
    Stats.ts               # Counters + timer query wrappers (if available)
    ShaderDump.ts          # Persist assembled GLSL + symbol map
```

### Architectural deltas (Tier 1 → Tier 2)

* **ShaderBuilder → Assembler-Lite**: from “append strings” to “prefix + verify + append”.
* **Ad-hoc rebuilds → FeatureHash/ProgramCache**: only rebuild when the hash changes.
* **ParameterSet → ParameterStore + Snapshot**: discipline around per-frame immutability.
* **Manual formats → CapabilityQuery + Formats**: device-legal choices by default.
* **Uncoordinated RNG → SampleLayout**: named domains prevent overlap & bias.
* **Fragile accumulation → PingPong with resize policy**: stable results across window changes.

### Strengths

* Keeps the simple mental model: modules write GLSL; engine executes passes.
* Safer, faster iteration (fewer rebuilds; fewer mysterious bugs).
* Deterministic sampling & resource handling—critical for research reproducibility.

### Remaining out-of-scope (by design)

* No frame-graph scheduler.
* No multi-canvas or multi-view.
* No complex pass orchestration (unless you choose to add it later).

---

## Minimal vs Expanded — decision matrix

| Concern                | Minimal Core         | Expanded Engine                       | Notes                                                         |
| ---------------------- | -------------------- | ------------------------------------- | ------------------------------------------------------------- |
| First-pixel time       | **Fastest**          | Slightly slower                       | Expanded adds small boot cost (capability probe, cache init). |
| Compile churn          | High (rebuild often) | **Low** (FeatureHash cache)           | Matters once you A/B modules frequently.                      |
| Symbol safety          | Fragile              | **Safe** (prefix + requires/provides) | Prevents “works until module X is added”.                     |
| Sampler correctness    | Risk of correlations | **Deterministic** (SampleLayout)      | Essential for PT/BDPT/VCM comparisons.                        |
| Accumulation on resize | Easy to break        | **Stable** (PingPong + policy)        | Saves time during interactive work.                           |
| Device portability     | Trial/error          | **Probed** (CapabilityQuery)          | Reduces “it broke on laptop Y”.                               |
| Debuggability          | Limited              | **Better** (ShaderDump, stats)        | Helpful when assembling larger shaders.                       |
| SLOC / complexity      | **Low**              | Moderate                              | Still lean; small number of extra files.                      |

---

## When to upgrade (objective triggers)

Upgrade from Minimal → Expanded when you hit **any** of these:

1. **Rebuild pain**: recompiles > 100 ms frequently during A/B testing, or you switch modules > 10× per session. *(FeatureHash/ProgramCache pays for itself.)*
2. **Name conflicts or missing symbols**: you’ve patched collision bugs twice. *(Assembler-Lite closes this class of failure.)*
3. **Sampling concerns**: you’re comparing samplers/tracers and care about variance. *(SampleLayout becomes mandatory.)*
4. **Curved geometries + new materials**: you need a geometry-agnostic ABI. *(Assembler-Lite + clear prefixes prevent Euclidean leakage.)*
5. **Frequent resizes / changing resolutions**: accumulation history keeps breaking. *(PingPong + resize policy stabilizes.)*
6. **Cross-machine demos**: it must run on student laptops/cluster nodes. *(CapabilityQuery avoids format surprises.)*
7. **Reproducibility**: you need to dump exact shaders/configs for a paper. *(ShaderDump + hash makes builds auditable.)*

If none apply yet, stay Minimal. Simplicity wins.

---

## How to upgrade (incremental, low-risk)

Upgrade in **small stages**. Each stage is self-contained; you can stop after any one.

### Stage A — Assembler-Lite (prefix + requires/provides)

* **Delta**: Replace `ShaderBuilder` with `AssemblerLite`.
* **Why**: Prevent symbol collisions and missing providers.
* **Acceptance tests**: Intentionally add two modules with `generateRay()`; build must fail with a clear error. Add `requires("localFrame")` to a tracer and ensure geometry provides it.

### Stage B — FeatureHash + ProgramCache

* **Delta**: Introduce a cache key built from module IDs/versions, constants (e.g., max bounces), formats, and a coarse resolution bin; cache the linked program.
* **Why**: Stop recompiling on parameter changes that don’t affect code.
* **Acceptance tests**: Toggling a uniform does not rebuild; swapping a module does.

### Stage C — ParameterStore + Snapshot

* **Delta**: Move from mutable `ParameterSet` to transactions + per-frame snapshot; ensure UniformBinder only consumes snapshots.
* **Why**: Eliminate mid-frame tearing; enable diff-based uniform updates.
* **Acceptance tests**: Inject rapid UI changes mid-frame; visuals remain stable.

### Stage D — SampleLayout

* **Delta**: Register named domains for the active tracer (e.g., `lens`, `bsdf_dir`, `nee_pick`); samplers consume indices, not global RNG.
* **Why**: Deterministic, de-correlated sampling across module swaps.
* **Acceptance tests**: Swap sampler strategy; convergence curves remain comparable.

### Stage E — CapabilityQuery + Resource discipline

* **Delta**: Probe device capabilities; steer formats and MRT usage; formalize PingPong + resize policy.
* **Why**: Portability and robust accumulation across resizes.
* **Acceptance tests**: Resize repeatedly; accumulation behaves as specified. Run on a second machine/GPU.

### Optional — Diagnostics (Stats + ShaderDump)

* **Delta**: Record compile/frame times; dump assembled GLSL + symbol map on demand.
* **Why**: Faster debugging, reproducible results for papers.
* **Acceptance tests**: Confirm dumps match the active configuration; compile timings show cache hits.

---

## Why upgrade (benefits in research terms)

* **Reproducibility**: FeatureHash + dumps → cite exactly what ran.
* **Fair comparisons**: SampleLayout → samplers/tracers compared apples-to-apples.
* **Velocity**: Cache + pools → spend time changing algorithms, not waiting on compiles.
* **Correctness**: Assembler checks stop silent geometry/material coupling errors.
* **Portability**: Capability-aware formats reduce demo day surprises.

---

## Backwards compatibility policy

* Research modules keep the same surface: `getShaderCode()` + parameter descriptors.
* Upgrades do **not** require module rewrites—only the engine gains checks/caches/pools.
* If you adopt a geometry/material ABI, modules *may* simplify (less boilerplate), but old modules continue to work as long as they provide the required entrypoints.

---

## Go/No-Go checklists

**Stay Minimal if**

* One tracer, one camera, Euclidean only.
* You aren’t swapping modules often.
* You don’t care about exact variance comparisons yet.

**Move to Expanded if**

* You hit any trigger listed above.
* You plan to publish comparison plots (sampler/tracer).
* You need reliable accumulation during interactive work and resizes.

---

## Appendix — Glossary (short)

* **Assembler-Lite**: A tiny assembler that prefixes symbols and validates `requires/provides`, then concatenates GLSL into a single program **without** runtime `#ifdef`s.
* **FeatureHash**: Deterministic key for the exact program shape; drives the program cache.
* **SampleLayout**: Deterministic mapping of random sample dimensions by named domain, ensuring de-correlation and repeatability.
* **PingPong**: Double-buffered textures used to carry state (e.g., film accumulation) across frames.

---

### TL;DR

Start **Minimal** to move quickly. As soon as you feel pain (compile churn, collisions, sampling doubts, resize breakage, portability), adopt the **Expanded** pieces *one small stage at a time*. You’ll keep the “dumb executor” vibe while gaining the stability and speed a long-running research codebase needs.
