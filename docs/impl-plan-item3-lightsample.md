# Impl plan — §10.1 item 3: LightSample → §6.1 conventions + CDF selection

Reshape the light sampler from the slice's ad-hoc `lighting_sample(p)` to the pinned §6.1
shape: the `LightSample` struct gains `flags`/`light_id`, point lights are tagged
`LIGHT_DELTA`, selection becomes a compile-time **power-weighted CDF** driven by explicit
`xi`, and the uninitialized-fallthrough edge case is closed.

**Provenance:** transcribed from `fable-compiler-contracts.md` §6.1 (the `LightSample`
struct + measure conventions) and `fable-reference-implementations.md` §6.3 (the point-light
sampler + selection dispatcher). The §10.1 item-3 text: *"folded-1/d², pdf=1 point lights →
§6.1 conventions with `LIGHT_DELTA`; `random()·N` selection → CDF selection (also fixes the
uninitialized-sample edge case)."*

---

## Target shapes (§6.1 / reference §6.3)

```glsl
const uint LIGHT_DELTA = 1u;   // point/directional: not BSDF-hittable, excluded from BSDF-side MIS

struct LightSample {
    Direction wi;        // toward the light, unit
    float     distance;  // to the sampled point (1e20 for directional/env)
    Spectrum  radiance;  // incident radiance, WITHOUT visibility (delta lights fold 1/d² in)
    float     pdf;        // total: selection × per-light, SOLID-ANGLE measure
    uint      flags;
    int       light_id;
};

LightSample lighting_sample(Point p, vec2 xi);   // explicit xi (§2.9): xi.x selects, xi.y for area samples
```

**Per-kind sampler as a fixed library file** (`glsl/light_point.glsl`), mirroring the material
pattern (`lambert.glsl` + generated dispatch). Adding quad/sphere lights later = one more
`light_<kind>.glsl` + one dispatch arm — the §3.3 shape, applied to lights:
```glsl
LightSample point_light_sample(Point position, Spectrum intensity, Point p) {
    vec3 d = position - p;  float d2 = dot(d, d);
    LightSample ls;
    ls.wi = d * inversesqrt(d2);  ls.distance = sqrt(d2);
    ls.radiance = intensity / d2;   // delta light: falloff FOLDED into radiance (§6.1)
    ls.pdf = 1.0;                   // per-light pdf; selection pdf multiplied in by the dispatcher
    ls.flags = LIGHT_DELTA;  ls.light_id = -1;   // dispatcher sets the real id
    return ls;
}
```

Generated dispatcher — CDF selection over samplable lights, then call the per-kind sampler:
```glsl
LightSample lighting_sample(Point p, vec2 xi) {
    // weights per the selection metric (strategy axis — see below); select_pdf_i = w_i / Σw
    int   light_id;  float select_pdf;
    if      (xi.x < <cdf_0>) { light_id = 0; select_pdf = <sp_0>; }
    else if (xi.x < <cdf_1>) { light_id = 1; select_pdf = <sp_1>; }
    else                     { light_id = <N-1>; select_pdf = <sp_{N-1}>; }  // guaranteed — closes the edge case
    LightSample ls;
    if (light_id == 0) ls = point_light_sample(<P_0>, <I_0>, p);
    else if (light_id == 1) ls = point_light_sample(<P_1>, <I_1>, p);
    else ls = point_light_sample(<P_{N-1}>, <I_{N-1}>, p);
    ls.light_id = light_id;
    ls.pdf *= select_pdf;    // total = per-light × selection (§6.1)
    return ls;
}
```
For the current 1-point-light scenes this collapses to the trivial arm (`select_pdf = 1`).

**Light selection is a compile-time strategy axis (research knob).** The CDF weights come from
`strategy.transport.lightSelection: 'uniform' | 'power'` (default `'power'`):
- `'power'` — `w_i = spectrum_average(color_i · intensity_i)` — importance-samples brighter lights.
- `'uniform'` — `w_i = 1` — the naive baseline.

Both bake into the generated CDF, so A/B is *swap the strategy and recompile* — or define two
strategies (`nee-power`, `nee-uniform`) and switch renderers live (keys 1–9) to compare variance.
Future selection metrics (runtime light-importance, etc.) slot in as new options on this axis.

---

## In scope for item 3

1. **`structs.glsl`** — reshape `LightSample`: drop `position` (confirmed unread in transport),
   add `uint flags` + `int light_id`; add `const uint LIGHT_DELTA = 1u`.
2. **`glsl/light_point.glsl`** (NEW fixed library) — `point_light_sample(Point position,
   Spectrum intensity, Point p)`, the per-kind sampler (delta conventions above). Mirrors
   `lambert.glsl`; included by the lighting feature when point lights are present.
3. **`lighting.ts`** (`generateLightSampling`) — include `light_point.glsl`, and emit the
   `lighting_sample(Point p, vec2 xi)` **dispatcher**:
   - CDF selection with weights from the strategy's `lightSelection` metric (`'power'` →
     `spectrum_average(color·intensity)`, `'uniform'` → 1), a guaranteed final `else`
     (no fallthrough → fixes the uninitialized-sample bug),
   - calls `point_light_sample(<Pᵢ>, <Iᵢ>, p)` for the selected light, sets `light_id`, `ls.pdf *= select_pdf`.
   - Zero-light case: `pdf = 0` (NEE skipped), now takes `xi` too.
4. **`types.ts`** — `TransportDescription.lightSelection?: 'uniform' | 'power'` (default `'power'`).
5. **`plan/types.ts`** — `LightingDesc = { method: 'nee'; selection: 'uniform' | 'power' }`.
6. **`Planner.ts`** — `lighting: { method: 'nee', selection: transport.lightSelection ?? 'power' }`.
7. **`path_trace.glsl`** — `lighting_sample(hit.p)` → `lighting_sample(hit.p, random2())` (explicit xi, §2.9).
   NEE otherwise unchanged; `flags`/`light_id` are set but their consumer (MIS) is deferred — an inert
   hook like `prev_was_delta`.

**Note on behavior:** converged image is unchanged (same NEE integrand: single delta light,
`radiance·f·cos/pdf` identical). It is **not** byte-identical per-sample — transport now draws
`random2()` for the (ignored) delta-light `xi`, shifting the RNG stream. Like items 1–2, this
converges to the same mean; the low-spp noise pattern moves. Verify on the *converged* mean.

---

## Deferred — NOT in item 3, mapped to later items

| Deferred piece | Why not now | Lands in |
|---|---|---|
| **`light_of(region)` table + light registry** (§6.2) — emissive materials as lights, `sampleAsLight`, desugaring area lights to regions | needs *hittable* lights; point lights are delta (never hit), so nothing consumes `light_of` yet. **(Corrects the item-2 plan, which tentatively mapped `light_of` here.)** | area-lights item |
| **Quad / sphere area-light samplers** (reference §6.1/6.2; area→solid-angle `pdf_A·d²/cosθ`, `xi.y` for the surface point) | no area lights in the scene | area-lights item |
| **`lighting_pdf(p, wi, light_id, hit)`** (§6.1 MIS query) | MIS is deferred | MIS item (§6.4) |
| **MIS** (power heuristic β=2, §6.4) — `LIGHT_DELTA`/`LOBE_DELTA` weighting on emitter hits | NEE-only slice; the `flags`/`prev_was_delta` hooks are pre-threaded | MIS item |
| **`cdf_select` / `cdf_rescale` helpers + batch two-level sampling** (§4.7) | inline if-else CDF suffices for small N; helpers/binary-search are for many lights | many-lights item |
| **`shadow_transmittance` spectral** (§6.3) | boolean `scene_intersect_any` fast path kept | media item |
| **Environment as a samplable light** (`environment_sample`/`environment_pdf`, §6.2) | env is analytic/none now | environment/HDRI item |
| **`lighting_get_light(id)` accessor for `Value<T>` light params** | lights are baked constants | Value<T>-lights item |

---

## Verification

- **Snapshot** diffs (LightSample struct, the reshaped `generated:light-sampling` block,
  `path_trace` NEE call). Review = the LightSample reshape + CDF selection, then `-u`.
- **Typecheck** clean (only `lighting.ts` changes).
- **Live GPU:** Cornell converges to the **same mean** (~1.216, NaN=0). Expect the low-spp
  noise pattern to shift (RNG stream moved) — check the converged value, not a frame.

---

## Decisions (resolved with the user)

1. **Per-kind functions, not inline** — `point_light_sample` in a fixed `light_point.glsl`,
   called by the generated dispatcher; the §3.3 material pattern applied to lights. Build the
   real extension surface now even though only point lights exist, so quad/sphere are additive.
2. **Selection metric is a swappable strategy axis** — `strategy.transport.lightSelection:
   'uniform' | 'power'`, default `'power'` (`spectrum_average(color·intensity)`). It's a
   research tracer: A/B power vs uniform by switching strategies live. Compile-time (bakes the
   CDF). Note: compile-time power-weighting is not per-point-optimal — runtime light importance
   (BVH/ReSTIR) is a separate future axis (WebGPU-shaped), a *new option* on this axis later.
3. **`LIGHT_DELTA` in `structs.glsl`** beside `LightSample` (light-domain constant, parallel to
   `LOBE_*` in `interaction.glsl`). Move to a `lights.glsl` module when area-light samplers give
   lights enough shared library code to warrant one.

Related: `fable-compiler-contracts.md` §6.1–6.4; `fable-reference-implementations.md` §6.3;
`docs/impl-plan-item2-hit-regions.md` (note its `light_of` row is superseded here).
