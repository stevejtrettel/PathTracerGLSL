# impl-plan-display.md — the display / output section

**Status:** PLANNED (Jul 14 2026). Supersedes the ad-hoc `film/` grouping.
**Depends on:** nothing structural — `accumulation`/`tonemap` already exist as
strategy fields; this reorganizes the components + finishes the output half.

## Why

The old `film/` folder crosses the strategy-taxonomy line: `accumulate_*` is
**estimator** math (the Monte-Carlo sample mean `(1/N)Σ`, Welford variance),
`tonemap_*` is **view** math (the display transfer). One folder, two math roles.
And the *output* half (where the converged estimate goes) is half-built: HDR export
works, PNG is stranded because no `'ldr'` export target is ever registered
(`buildExportTargets` — the bug memory already flagged).

## The model — three stages downstream of the estimate

The converged estimate is a **linear HDR radiance field** (`accumulation_previous`,
+ optional variance at attachment 1). Downstream of it, a linear pipeline of THREE
stages — one optional transfer feeding two sinks:

```
estimate (linear HDR)
   │
   ├─ [optional] tonemap transfer          ← GLSL; one layer, bypassed for raw HDR
   │
   ├──▶ screen sink   (engine blit to canvas — live display)
   └──▶ export/ sink  (file: png = post-tonemap · hdr = pre-tonemap/raw · exr later)
```

- **Stage T — tonemap (optional transfer).** A per-pixel function, GLSL, the
  `tonemap/` family. `exposure (shared) → vec3 <id>_curve(x) [occupant] → sRGB OETF
  (shared) → dither (shared)`. It is ONE layer SHARED by both sinks — the same curve
  that draws to screen is what a PNG bakes in. Bypassed entirely (identity) for raw
  HDR and for §11 probes.
- **Stage S1 — screen sink.** Engine blits the (tonemapped) drawing buffer to canvas.
  Live display. Already built.
- **Stage S2 — export/ sink.** The file-output layer (app): png (taps the tonemapped
  drawing buffer), hdr (taps the estimate BEFORE tonemap → RGBE), exr/AOV later. Stamps.

**The tie:** the SINK decides whether the transfer ran upstream of it. png/screen see
the tonemapped buffer; hdr/exr tap the raw estimate. Tonemap itself is agnostic — it's
just the optional layer in the middle.

### Pinned decisions
- **`tonemap/` is its OWN optional layer — not part of `export/`, not "display".** It
  precedes both sinks and is shared by them. (This is the correction to the first draft
  of this doc, which had folded the sink concern into a single "view/display" bucket.)
- **No GLSL `display/` family.** The swappable GLSL object is only the tone *curve*;
  the family stays **`tonemap/`** (matches `view.tonemap`).
- **`export/` is the app-layer file-sink layer** (already exists as `buildExportTargets`
  + `file-export.ts` + `App.exportHDR/PNG`). It is an action on the estimate, not a
  renderer property → `RenderStrategy.view` stays `{ tonemap }`. Screen display is the
  engine's blit, a separate sink from file export.
- **Math is static; policy/plumbing are generated** (same rule as the transport-glsl
  target): the occupant supplies ONLY `vec3 <id>_curve(vec3)`; the tonemap `main()`
  and its header (uniforms, exposure, `safe_color`, `linear_to_srgb`, dither) are
  generated/shared glue.

---

## Stage 1 — split `film/` → `accumulator/` + `tonemap/` (pure move, byte-identical GLSL)

Two top-level families:
- `src/components/accumulator/` — `average`, `oneshot`, `variance`, `exponential`
  (estimator; `estimator.accumulation` points here).
- `src/components/tonemap/` — `none`, `reinhard` (view; `view.tonemap`).
- `fullscreen.vert.glsl` is neither — it is shared pipeline plumbing. Move it to the
  shared GLSL util location (wherever `core/` shared vert lives), NOT into a family.

Touch: the two `index.ts` registries + every import/provenance string that says
`components/film/...`. GLSL bytes MUST be identical (hash-verify per the components
proof regime) — snapshot churn = provenance renames only. Update `structure.test.ts`
family-root expectations and `purity.test.ts` if it enumerates families.

**Gate:** `npx vitest run` green (snapshots re-goldened to provenance-only diffs),
`npm run witness` unchanged numbers.

## Stage 2 — shared-header refactor: occupant = `curve()` only

Today each tonemap occupant writes its own `main()` and re-pastes `linear_to_srgb`.
Refactor so:
- **Occupant** supplies only `vec3 <id>_curve(vec3 x);  // HDR-linear → display-linear [0,1]`
  and a capability `encodesToDisplay: boolean`.
- **Shared/generated display header** owns: `u_radiance`, `u_resolution`,
  `DISPLAY_EXPOSURE`, `safe_color`, `linear_to_srgb`, optional ordered dither, and a
  GENERATED `main()`: `exposure → <id>_curve → (encode if encodesToDisplay) → fragColor`.
- `none`: `encodesToDisplay=false`, identity curve → generated `main()` emits raw
  `safe_color(radiance)*exposure` (preserves the probe semantics §11 needs).
- `reinhard`: `encodesToDisplay=true`, `curve = x/(1+x)`; keep behavior identical.

**Gate:** re-goldened snapshots + witness numbers unchanged (reinhard/none pixels
identical modulo the refactor; verify a screenshot spot-check).

## Stage 3 — production tonemap roster (occupant = one `curve()` each)

Build order by production-relevance (each = one GLSL file + one descriptor + one line):
1. **reinhard** — done in Stage 2; add the extended white-point variant `x(1+x/w²)/(1+x)`
   as a param.
2. **aces** — Narkowicz fitted RRT+ODT (cheap, the filmic workhorse). DOC WARNING:
   skews saturated hues — that is *why* agx/khronos exist. (Full Hill fit = later variant.)
3. **agx** — Troy Sobotka / Blender default. Modern neutral, excellent highlight
   desaturation. The current production default many reach for.
4. **khronos_pbr_neutral** — Khronos PBR Neutral. Purpose-built for material preview
   (preserves hue/saturation, no filmic contrast) — the right default for a *research*
   tracer judging material correctness, not making pretty pictures.
5. **hable** (Uncharted 2) + **gt** (Gran Turismo / Uchimura) — classic filmic curves;
   lower priority, nice to have.

Each occupant owes: the `curve()` function, a `.md` with the fit's provenance, and a
line in `tonemap/index.ts`. Extend `TonemapDesc` union in `plan/types.ts` accordingly
(it already lists `aces`/`filmic` as reserved values — wire them).

**Deferred (name so they don't leak into an occupant):** auto-exposure metering,
bloom, LUT grading, and the OETF-as-its-own-seam (only promote `tonemap/`→`display/`
if you ever want swappable encodes: sRGB vs Rec.709 vs PQ/HDR-display).

## Stage 4 — finish the output/container half

- **Register `'ldr'` export target** (the actual bug): the tonemapped 8-bit result is
  the drawing buffer — register `'ldr'` as a canvas/default-framebuffer readback in the
  engine's export-name list so `getAvailableExports()` includes it and
  `readExport('ldr')` returns the `Uint8Array`. Fixes `App.exportPNG` (currently always
  throws) + `TiledRenderer`'s `exports.includes('ldr')` branch. Stamps already wired.
- **HDR file export already works** (`'hdr'` → `accumulation_previous` float → RGBE +
  stamps). HDR = storing the raw linear estimate (radiance floats > 1.0) instead of a
  tonemapped [0,1] image. It is **purely a pixel-fidelity/format concern and is
  CAMERA-AGNOSTIC** — a pinhole render exports to `.hdr` just as validly as any other.
  No change needed here.
- **Environment-map workflow (a separate, optional combination — NOT what "HDR"
  means):** an env map you reuse as a background wants TWO independent things that
  happen to co-occur — (a) HDR float values (the export above) AND (b) an
  equirect/octahedral *projection* (the camera axis). Combine them and you render a
  lat-long HDR that reloads as an `image` environment (env-as-light's `.hdr` loader),
  closing the render→reuse loop. Both halves already exist; the work is only to
  document the combination + a round-trip smoke-test (render `cornell` through the
  equirect camera → `.hdr` → back through the HDR loader; RGBE codec already TS-tested).
  Do not describe this as "HDR needs equirect" — they are orthogonal.

**Deferred output work:** EXR (half/float, multi-channel — variance buffer is the
first AOV customer, `exportAOV` already exists for it); high-res/tiled is already in
`TiledRenderer`; PQ/HDR-display output.

## Ordering / independence

Stage 1 is a pure refactor — land it ALONE (owner rule: don't mix refactors with
feature work). Stages 2–3 are the tonemap feature. Stage 4 is app-layer output and is
independent of 1–3 (can land any time after Stage 1's registry paths settle).
