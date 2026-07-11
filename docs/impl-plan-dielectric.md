# Impl plan — dielectric + "make regions real"

The first delta material, and with it the region machinery it forces: two-sided hits
(`scene_region_at`, epsilon classification, the boundary-owner rule), interior marching, the
transmission spawn offset, and the `ior_of` table. The BSDF itself is a transcription
(reference §2); the geometry/classification work is the substance.

**Provenance:** `fable-compiler-contracts.md` §2.7 (innermost-wins), §4.1 (Hit; owner shades;
frame toward `region_from`), §4.2 (epsilon classification), §4.3 (marcher owner hint), §6.2
(emission keys on `region_to`), §6.3 (dielectrics shadow-opaque in v1), §7.2 (RR pins incl.
`etaScale` note); `fable-reference-implementations.md` §2 (normative dielectric — the η² factor);
`fable-validation-scenes.md` §3 (F-ETA) + §5 (R-SUBMERGED); `docs/fable-module-anatomy.md` §7
(staging: on today's plumbing, no descriptor machinery); `docs/trace-loop-contract.md` (Ray pure
seed; spawn-offset side deferred to *this* item); item-2 plan's deferred table (this item claims
`scene_region_at`, `owner`, `ior_of`).

**Why R-SUBMERGED belongs here, not to media:** verification trace T2's killer case (glass
sphere submerged in a water pool — deepest-wins made it invisible) is a *pure dielectric*
scenario. Nested classification ships with the dielectric or the dielectric ships wrong.

---

## Phase 0 — RR placement (separate tiny commit, first)

Move Russian roulette to the §7.2 pin: **after** `throughput *= bs.weight`, gating the next
iteration, survival `min(0.95, spectrum_max(throughput))`. Both placements proven unbiased
(discussion, July 2026); post-weight decides on strictly better information, kills worthless
paths *before* the next trace, matches PBRT.
**Verify:** RR-off scenes byte-identical; Cornell 512-spp mean ≈ 1.216 holds; F-BOX 0.4 with RR
forced on.

## Phase 1 — two-sided hits (behavior-preserving for all existing scenes)

Target shapes:

```glsl
struct Hit { float t; Point p; Frame frame;      // frame.n oriented toward region_from (§4.1)
             int region_from; int region_to;      // epsilon-classified (§4.2)
             int region_owner;                    // whose surface this IS (§4.3) — material_of(region_owner) shades (§4.1)
             vec2 uv; };

int scene_region_at(Point p);      // generated: innermost-wins (§2.7) — among sdf<0, LEAST negative
                                   //   (d > best_d among negatives; the bug is one flipped inequality)
Ray ray_spawn(Hit hit, Direction wi);  // continuation ray offset to wi's side:
                                   //   make_ray(ambient_geodesic(hit.p, sign(ambient_dot(wi, n, p))·n, EPSILON), wi)
```

1. **`Hit.region_owner`** (structs.glsl) — the item-2 plan deferred it to exactly this moment.
   Named with the `region_` prefix so the three regional facts read as a family (owner = whose
   *boundary* this is — the docs' §4.1 "boundary owner", kept for vocabulary continuity). Backends
   set it (SDF arg-min already tracked; analytic sets the tested object's index). At exits
   `region_owner ≠ region_to`; `material_of(region_owner)` is the BSDF key.
2. **`scene_region_at`** (generated in intersection.ts, near `material_of`): loop over objects'
   inside-tests — SDF objects reuse `sdf_object_<i>(p) < 0`; analytic sphere `length(p−c) < r`,
   analytic plane `dot(p,n)+offset < 0` (half-space, matching the SDF convention). Innermost =
   least-negative among insides; `-1` if none. (Cornell sanity: inward-facing wall half-spaces
   put the interior *outside* every wall → interior classifies ambient, as today.)
3. **Classification once per hit, in the generated `scene_intersect`** (§4.2 "never per march
   step") — **implemented form (revised during phase 1):** probes run along the **geometric
   normal**, not the ray, and the **owner covers its own side**, so ONE probe classifies the
   outside: entering (`dir·n < 0`) ⇒ `region_to = owner`, `region_from = probe(+n)`; exiting ⇒
   `region_from = owner`, `region_to = probe(+n)`. Why not §4.2's literal `p ∓ ε·dir`: the marcher
   stops `MARCH_EPSILON` *short* of the surface, so a ray-direction probe reaches the far side
   only when `ε·cosθ` beats that residual — it misclassifies at grazing incidence. Normal probes
   clear the residual at every angle (`EPS_INTERFACE = 1e-3 = 10× MARCH_EPSILON`), and the
   owner-shortcut half is §4.3's hint made exact. Same semantics, robust mechanism (§4.2
   annotated). Backends stop writing `region_from/to` (they report `region_owner` + geometry).
4. **Frame orientation** (§4.1): after classification, if `ambient_dot(ray.direction, n, p) > 0`,
   rebuild the frame on `−n` — `n` faces `region_from`. (Lambert's internal flip becomes dead —
   leave it; eval may be called with arbitrary `wi`.)
5. **`ray_spawn`** (ray.glsl): transport's continuation *and* NEE shadow rays go through it —
   no hand-written offsets left in path_trace.
6. **Interior SDF marching** (raymarch.glsl) — **implemented form:** march the generated
   `scene_march_bound(p, out region)` = **min over objects of |sdf_i|** (per-object abs, then
   min — NOT abs of the signed min: inside a big region, |signed min| is the distance to the
   *container's* boundary and overshoots nested inner surfaces, e.g. the submerged sphere).
   Hit at `bound < MARCH_EPSILON`; `region` = arg-min = the owner. From a spawn point 1e-3
   inside, bound ≈ 1e-3 > MARCH_EPSILON (1e-4), so no false immediate hit. `sdf_intersect_any`
   marches the unsigned bound likewise. Analytic backend already interior-correct
   (`ray_sphere` returns the far root).
   **Normals come from the OWNER's own field** — `scene_normal(p, region)` takes the gradient of
   the generated `scene_object_sdf(p, region)`, never of the global signed min. The global min is
   hijacked by containers: on a nested surface the pool's deeply-negative sdf wins the min
   everywhere inside, and its gradient points at the nearest *pool* face — the sphere renders as
   a rounded cube with undeviated central rays. **Found on the GPU by the R-SUBMERGED witness**
   (invisible to the phase-1 gate: in non-nested scenes every other sdf is positive at a hit, so
   the owner always won the min). Matches the analytic backend's per-object normals. Side effect:
   concave corners no longer blend adjacent objects' fields inside the normal stencil — corner
   normals are marginally sharper than the old global-min gradient (more correct).
7. **path_trace**: BSDF key `material_of(hit.region_owner)`; **emission keys on `region_to`**
   (§6.2 side convention — at a glass exit the BSDF is glass but you receive ambient's emission,
   i.e. none). Two lookups, two jobs.

**Verify (the phase gate):** codegen diffs reviewed + snapshot `-u`; every existing scene renders
**identically** (all-opaque, entering-only: classification must reproduce `from=-1, to=owner`
exactly) — cornell/two-light means, furnace 0.4, mixed-backend scene unchanged.

## Phase 2 — the dielectric material

1. **Types/Validator:** `MaterialDescription` gains `transmittance?: MaterialProperty`
   (`model: 'dielectric'` and `ior` already exist); remove/adjust the Validator rejection of
   dielectric; Validator warns on partial overlap (V1-C5) — full containment allowed.
2. **`glsl/dielectric.glsl`** — transcribe reference §2 *verbatim in structure*:
   `fresnel_dielectric(cos_i, eta)`; eval/pdf/emission = zero/0/zero (pure delta);
   `dielectric_sample(wo, hit, mp, float uc, vec2 u)` with **`uc < F`** selecting the lobe
   (`u` unused — first real use of the split); TIR = reflection branch with F=1;
   **the η² factor `(n_i²/n_t²)` on transmission — the most-omitted line; do not "simplify"**;
   weight `SPECTRUM_ONE` (reflect) / `mp.transmittance · η²-factor` (transmit);
   flags `LOBE_REFLECTION|LOBE_DELTA` / `LOBE_TRANSMISSION|LOBE_DELTA`.
   Header discipline per fable-module-anatomy §6.
3. **`ior_of(int region)`** — generated table (intersection.ts, §2.3 family): region's
   material's `ior` (default 1.5 if unset on a dielectric; non-dielectrics 1.0), `ior_of(-1) = 1.0`
   (ambientMedium deferred to media, §2.4). `Value<T>`-driven ior compiles to a uniform read.
4. **materials.ts:** include dielectric.glsl when present (dispatch is already additive, §3.3);
   material lookup adds `transmittance` (default `SPECTRUM_ONE`); hand-written per-field triple —
   accepted, the schema generator replaces it in the deferred reorg pass.
5. **Transport:**
   - Generated **`material_has_nondelta_lobes(int mat)`** guards NEE (constant-folds to a plain
     `#ifdef`-free truth when the scene is uniform; a table only when mixed). Delta hits skip the
     shadow ray entirely (eval would be zero — this saves the march, per the reference loop).
   - Continuation via `ray_spawn(hit, bs.wi)` — transmission offsets to the far side for free.
   - **`etaScale`** (§7.2 note): on `LOBE_TRANSMISSION` multiply `etaScale *= radiance_scale`;
     RR survival uses `spectrum_max(throughput / etaScale)` so η² compression (restored on exit)
     doesn't over-kill inside glass. Efficiency only — unbiased either way.
   - `current_medium` **NOT added** (§4.4): its only pre-media reader is the self-heal debug
     counter; the dielectric reads both IORs from the *hit*. Lands with media, where
     `region_from` (already computed) ground-truths it. `prev_was_delta` stays inert (no
     hittable emitters yet).
   - Shadow rays: dielectrics are **shadow-opaque** (§6.3 v1 pin) — `shadow_opaque.glsl`
     unchanged.
6. **Strategy:** glass scenes want `maxBounces ≥ 12` (TIR chains) — per-scene strategy setting,
   no code.

## Phase 3 — scenes & witnesses (suite entries + snapshot)

- **`eta`** (F-ETA, validation §3): water half-space (SDF plane, ior 1.33) over an emissive
  plane (lambert, albedo 0, emission 1.0), camera in air looking straight down, RR **off**,
  `directLighting: 'none'`. **Center pixel 0.5540 ± 1%** in linear HDR
  (`(1−R₀)·(1/1.33²)`, R₀ = 0.020053). **Omitting η² renders 0.980 — the witness.**
- **`submerged`** (R-SUBMERGED, validation §5): water box (half-extent 5, ior 1.33), glass
  sphere (r 0.4, ior 1.5) centered, camera inside the water. Render with/without the sphere:
  footprint mean-abs-diff **> 5%** of Le scale. Deepest-wins bug → η=1 → sphere perfectly
  invisible → diff ≈ 0. Binary, tied to the flipped inequality.
- **`cornell-glass`** — glass sphere in the Cornell box (eyeball: Fresnel rim, TIR at grazing,
  inverted image through the sphere). **The shadow under the sphere is DARK and that is correct
  v1 physics** — dielectrics are shadow-opaque (§6.3 pin) and the point light is BSDF-unhittable,
  so no transport path can form a caustic until area lights/`light_of` or transmissive shadows
  land; the shadow is lit only by diffuse interreflection. Do not chase a bright spot. (The
  sphere floats per validation X-GLASS — exact floor tangency parks the scene on epsilon
  degeneracies; review finding.)
- **`analytic-glass`** — the same glass sphere behind the analytic backend: cross-backend
  convergence twin (interior far-root path exercised).
- X-GLASS (cross-strategy trio) **deferred** — needs the emissive-quad light (area lights/MIS
  item). Numeric readback = manual HDR export per validation §7 (headless harness still future).

---

## Deferred — mapped, not dropped

| Piece | Lands with |
|---|---|
| `current_medium` + self-heal + repair counter (§4.4, §11.4) | media item |
| Null interfaces / `is_null_interface` (§3.6), F-SLAB | media item |
| Spectral `shadow_transmittance` media form; transparent shadows | media item / §10.2 |
| `light_of`, area lights, MIS, X-GLASS three-way | lights/MIS item |
| Dielectric priority for *partial* overlaps (V1-C5 warns) | §10.2 |
| §4.3 owner-shortcut classification skip; per-object `EPS_INTERFACE` | perf pass, when measured |
| Descriptor/schema machinery + file reorg | fable-module-anatomy §7 step 2 |

## Open decisions (recommendations inline)

1. **`region_owner` stored on `Hit`** (recommended) — §4.1 keeps it out of the *contract* struct,
   but the marcher must transmit it somehow and a field is the honest implementation; the
   reference's `hit_owner_region(hit)` becomes a trivial accessor. (Deriving it from `from/to`
   fails for nested exits — sphere→water has two non-ambient sides. The `(owner, side)`
   decomposition also fails there: `to` = water is a third region only classification knows.)
2. **Classification in the generated `scene_intersect`** (recommended) — one site, once per hit,
   both backends inherit it; backends shrink to geometry + owner.
3. **`ior_of` in intersection.ts beside `material_of`** (recommended) — region-indexed tables
   live together (§2.3 family), sourced from `plan.materials`.

Verification chain: phase 0 (means hold) → phase 1 (existing suite identical) → phase 2+3
(F-ETA 0.554, R-SUBMERGED visible, cross-backend twin converges). Then the reorg pass has its
witnesses.
