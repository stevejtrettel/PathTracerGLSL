# Impl plan — homogeneous media: null interfaces, absorption, scattering (V1-C1)

Volumetric media on the region machinery the dielectric item built, behind the **volumetric
component** contract: `current_medium` with the §4.4 self-heal (its first real reader), null
interfaces (§3.6), the `medium_sample`/`medium_transmittance` seams with per-material
specialization, then scattering with HG phase and medium events. Homogeneous throughout (V1-C1):
distance sampling and transmittance are **closed-form** — no delta tracking, no majorant machinery;
the `volumeIntegrator` axis's v1 value is **`analytic`**.

**Provenance:** [fable-volumetric-component.md](fable-volumetric-component.md) (**the design
authority for this build** — seams, MediumSample, partition rule, chromatic sampling decision,
axis rename; its §7 drove this revision); contracts §2.4 (ambientMedium), §3.5 (medium interface,
MediumProperties), §3.6 (null interfaces), §4.4 (current_medium single variable + self-heal),
§6.3 (spectral shadow query; dielectrics stay shadow-opaque), §7.2 (event loop + accounting pins),
§7.3 (volumeIntegrator axis, as amended); §1.1 V1-C1; verification F2/F3/F4/F5 + traces T3/T4/T5/T6;
reference-implementations §3 (HG — **transcribe the forward-convention denominator `1 + g² − 2gc`
exactly**; the audit-caught sign trap) and §4 (segment-walking shadow transmittance). Reference §5's
medium-segment lines are **superseded** — the normative chromatic sampler is the volumetric-component
doc §4 (pbrt-v3 channel selection + balance-heuristic weights, owner decision; NOT σ̄-ratio).

**Reference deviations (annotated in the docs):**
1. `scene_intersect_from(ray, t, maxDist, h)` — a t-windowed query that predates the trace-loop
   contract. Conforming replacement: **segment-walk by re-spawning** — advance the origin past each
   boundary with `ray_spawn(hit, direction)` and shrink the remaining `maxDist`.
2. The reference's null-interface continuation offsets to the **near** side under §4.1 orientation —
   it would re-hit the same boundary forever. `ray_spawn(hit, ray.direction)` picks the far side
   correctly. Reference bug; our helper already does the right thing.
3. The reference's `russian_roulette` helper uses `spectrum_average` and no etaScale — ours
   (post-weight, `spectrum_max`, η²-corrected) is the amended §7.2 pin; keep ours.
4. Reference §5's σ̄ ratio-weight medium sampling — superseded per above.

**RNG freshness rule (volumetric-component §2, after pbrt-v4's shipped wavefront bug):** every
segment after a re-spawn and every tentative decision draws fresh dimensions. Our counter-based
`rng_dim` gives this structurally; verification includes eyeballing the generated loop for any
draw hoisted out of the per-segment path.

---

## Phase M0 — authoring surface, analysis, validation (no GLSL)

1. **Types** (`src/compiler/types.ts`):
   - `MaterialModel` gains `'none'` (a material with no optical surface — §3.6).
   - `MaterialDescription.medium?: { sigma_a: MaterialProperty; sigma_s?: MaterialProperty;
     phase_g?: MaterialProperty }` (defaults 0 / 0 / 0). Constants or `{param}` only (V1-C1).
   - `SceneDescription.ambientMedium?: string` (§2.4 — a material name; absent = vacuum).
   - `RenderStrategy.transport.volumeIntegrator?: 'none' | 'analytic' | 'raymarch' |
     'delta-tracking' | 'ratio-tracking'` (volumetric-component §5; default derived).
2. **Analyzer:** `media: { hasMedia, hasScatteringMedia, hasNullInterfaces }` — medium block or
   ambientMedium present; any `sigma_s` nonzero-or-param; any model `'none'`.
3. **Validator (V1-C1 as rejections, per §1.1):** GLSL-expression medium properties rejected
   ("procedural media not yet supported — declare a majorant when they are", §3.5);
   `raymarch`/`delta-tracking`/`ratio-tracking` rejected-not-removed (only `none`/`analytic` live);
   `model: 'none'` **without** a medium block = error (an invisible object is authoring error);
   `ambientMedium` naming an unknown material or one without a medium block = error; warn when
   `ambientMedium`'s material has a surface model (its boundary doesn't exist).
   **Also (review C4):** reject `model: 'emissive'` like disney — superseded by emission on any
   surface model + `'none'` for pure medium regions.
4. **Planner:** `PlannedMaterial.medium` (resolved constants/params, GlslExpression backstop-throws
   like ior); `RenderPlan.ambientMedium` = the material id or −1 (→ `material_of(-1)`, §2.4);
   `program.transport.volumeIntegrator: 'none' | 'analytic'` resolved as
   `strategy value ?? (hasScatteringMedia ? 'analytic' : 'none')`.
5. **`spectrum_exp(Spectrum)`** helper in math.glsl (§2.5 discipline), `#ifdef HAS_MEDIA`-gated.

Gate: `npx tsc --noEmit` + `npx vitest run`; snapshot untouched (nothing generated yet).

## Phase M1 — null interfaces + absorbing media + the component skeleton

The deterministic half: seams 1–2 exist with **only the absorbing-only specialization** — no
sampling, no RNG draw, `medium_sample` arms are `{scattered:false, weight:exp(−σ_a·t_max)}`.

1. **Structs (structs.glsl, `#ifdef HAS_MEDIA`):** `MediumProperties {sigma_a, sigma_s, phase_g}`
   and `MediumSample {scattered, t, weight, radiance}` (volumetric-component §2/§3; the radiance
   accumulate line is capability-gated and NO v1 strategy declares it — bodies still assign ZERO).
2. **Generated capability tables** (materials.ts, beside the NEE guard): `is_null_interface(int
   mat)` (model `'none'`), `material_is_emissive(int mat)` (nonzero emission — closes the review's
   unguarded-emission-block finding: the emission fetch and dispatch now sit behind this
   compile-time gate, the one intended non-#ifdef change to media-free scenes), and
   `material_has_medium(int mat)` (so per-segment code constant-folds away for media-less
   current_medium values).
3. **Generated component dispatch** (materials.ts): `scene_medium_properties(int mat, vec3 p)`
   (`p` unused-but-present, V1-C1); `medium_sample(int med, Ray, float t_max, vec2 xi)` and
   `medium_transmittance(int med, Ray, float len)` switching over media present — in M1 every arm
   is the deterministic absorbing form.
4. **Transport (path_trace.glsl, all under `#ifdef HAS_MEDIA` / `HAS_NULL_INTERFACES`):**
   - `int current_medium = -1` (§4.4); **self-heal** on boundary hits:
     `if (hit.region_from != current_medium) current_medium = hit.region_from;`.
   - The **uniform call site** (volumetric-component §2) on every segment where
     `material_has_medium(material_of(current_medium))` — on hits AND misses (`t_max = MAX_DIST`
     kills the environment through an absorbing ambient automatically). The `if (ms.scattered)`
     branch is `#ifdef HAS_SCATTERING` (arrives M2).
   - **Null interfaces:** `if (is_null_interface(mat_owner))`: `current_medium = hit.region_to`,
     re-spawn same direction via `ray_spawn(hit, current_ray.direction)`, `null_crossings++` with
     `MAX_NULL_CROSSINGS` (pin: 32), **no bounce consumed** (`bounce--; continue;` — pbrt-v3's own
     mechanism, keeping the `for` header increment so media-free loops are untouched), no emission,
     no NEE (§3.6).
   - `current_medium = hit.region_to` on `LOBE_TRANSMISSION` (tinted glass interiors compose with
     the interface `transmittance`).
   - Camera init stays `-1` (a camera inside a *bounded* medium mistracks one segment, then heals —
     §4.4; classification-init is a two-line upgrade when a scene needs it).
5. **Temporary staging guard (Validator, deleted in M2):** media + `directLighting != 'none'` is
   rejected — the opaque shadow query would silently block at null boundaries. The error message
   names M2's `shadow_media`.
6. **Scenes:** **`slab`** (F-SLAB): emissive backwall + `ink { model:'none', medium:{sigma_a:
   [1,2,4]} }` box slab, camera through it perpendicular; RR off, NEE off. **Expect: center
   pixel `(0.36788, 0.13534, 0.01832)` ± 1%/channel** — catches null-BSDF leaks, double-attenuation
   (renders the *square*), spectral σ_a plumbing, two null crossings of `current_medium`.
   **`fogcube`** (R-FOGCUBE, absorbing variant): gray absorber cube (`model:'none'`) floating over
   an emissive checker floor; **expect: no Fresnel-like rim at the silhouette** (a rim = the null
   interface leaked a BSDF).

Gate: media-free scenes identical after preprocessing except the `material_is_emissive` gate
(defines absent → same loop); slab numbers; fogcube rim; suite + snapshot + gallery entries with
`expected` filled.

## Phase M2 — scattering media (medium events, HG, spectral shadows)

1. **`glsl/phase_hg.glsl`** — transcribe reference §3 *exactly*: `c = dot(wi, -wo)` (forward
   convention), denominator `1 + g² − 2gc`, `hg_sample` builds its frame around `-wo`, weight =
   `SPECTRUM_ONE` (exact), `pdf = spectrum_average(hg_eval)`, flags `LOBE_MEDIUM`.
2. **`medium_sample` scattering arms** — transcribe volumetric-component §4 *exactly* (pbrt-v3
   channel-MIS: uniform channel, per-channel exponential, balance-heuristic weight both outcomes;
   grayscale degeneracy check: scatter → σ_s/σ_t, survival → 1). Generated
   `medium_is_scattering(int mat)` selects arms; `HAS_SCATTERING` define.
3. **Transport medium events** (`#ifdef HAS_SCATTERING`, inside the uniform call site's
   `if (ms.scattered)`): `p_evt = ambient_geodesic(origin, dir, ms.t)`; NEE from the medium point
   (phase **eval**, no cosine — §2.2, `shadow_transmittance(make_ray(p_evt, ls.wi), ls.distance)`);
   `hg_sample`; continue with `make_ray(p_evt, wi)` (no surface offset); **bounce++ via the loop
   header** (`continue` — medium events count, §7.2); RR per iteration as pinned (duplicated in the
   branch until the item-9 generator split).
4. **Spectral `shadow_transmittance`** (new `glsl/shadow_media.glsl`, emitted *instead of*
   shadow_opaque when the scene has media + NEE): segment-walk by re-spawn (deviation 1), composing
   `medium_transmittance` per segment (full σ_t — the single-scattering shadow approximation), null
   interfaces pass, everything else (opaque AND dielectric, §6.3 v1) returns `SPECTRUM_ZERO`;
   `MAX_SHADOW_SEGMENTS` (pin: 8); exhaustion → ZERO (conservative). **Starting medium recovered
   internally via `scene_region_at(ray.origin)`** — self-contained, no signature change.
   **Delete the M1 media+NEE Validator guard.**
5. **Scenes:** **`furnace-scatter`** (F-BOX-M): the furnace + `ambientMedium` haze
   `{sigma_s:[0.5,1.0,2.0], sigma_a:0, phase_g:0.7}`, maxBounces 48, NEE off, RR off.
   **Expect: still exactly (0.4, 0.4, 0.4) ± 0.004/channel** — catches the channel-MIS weights,
   HG normalization, medium-event weights, and bounce starvation (mean < 0.4 ⇒ raise maxBounces).
   **`haze`** (the replacement HG-sign witness — volumetric-component §7.4; the pt/pt-nee equality
   pair was unbuildable with delta lights and moves to X-FOG with area lights): a foggy room with a
   point light AND a small emissive panel, `phase_g: { param: 'haze.g', default: 0.7, min: -0.95,
   max: 0.95 }`. Keys: pt-nee (medium NEE + hg_eval + shadow_media — light shafts) and pt
   (hg_sample-only transport; sees only the panel). **Expect:** dragging `haze.g` positive
   brightens the halo *around the light direction* and negative dims it — the audit's `+2gc` bug
   inverts this; key 1 ≥ key 2 everywhere by exactly the delta-light term; spike-noise halos near
   the light are EXPECTED until equiangular placement lands (Kulla–Fajardo; deferred table).

Gate: F-BOX-M 0.4 ± 0.004/channel; haze g-witness direction; M1 scenes unchanged; media-free
scenes still identical-after-preprocessing; `npx vitest run` + snapshot review.

---

## Deferred — mapped, not dropped

| Piece | Lands with |
|---|---|
| Heterogeneous/procedural media, majorant declaration+validation, delta/ratio tracking, honest `raymarch` | V1-C1 relaxation (§1.1) |
| Equiangular medium-NEE placement (seam 4 — point lights in fog; Kulla–Fajardo) | own item, after area lights or when halo noise hurts |
| Volumetric emission (`MediumProperties.emission` + the radiance capability flag's first reader) | first emissive-medium scene |
| Analytic/approximate fog strategies (inline-radiance readers) | first approximate-strategy experiment |
| X-FOG proper (the pt/pt-nee equality pair) + medium-side MIS + `prev_bsdf_pdf` bookkeeping | area-lights/MIS item |
| `medium_sample_pdf` companion (MIS between distance-sampling strategies) | if that research direction opens |
| §11.4 repair-counter debug strategy (self-heal is silent for now) | debug-views item |
| Env-samplable miss weighting | env-as-light item |
| Camera-inside-bounded-medium classification init | first scene that needs it |
| Diffusion-BSSRDF SSS (material-axis, not medium-axis — volumetric-component §1) | future material model |
| Transport template → generated blocks (the #ifdef count keeps arguing for it) | §10.1 item 9, still last |

## Pinned constants

`MAX_NULL_CROSSINGS 32`; `MAX_SHADOW_SEGMENTS 8`; shadow spawn reuses `ray_spawn`/EPSILON (one
epsilon family); EPS-offset gaps in Beer–Lambert lengths are ~1e-3 per crossing — negligible vs
the ±1% F-SLAB tolerance. Medium codegen lives in **materials.ts** (media are "materials of the
interior", §3.5; `PlannedMaterial` carries the block).

Verification chain: M0 (types/validator tests) → M1 (media-free identical + F-SLAB exact numbers
+ fogcube rim) → M2 (F-BOX-M 0.4 + haze g-witness). Then the reorg pass has phase_hg + medium
codegen as its third/fourth model files — likely its trigger point.
