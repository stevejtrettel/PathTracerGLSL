# Impl plan — §10.1 item 5: shadow query → `shadow_transmittance` contract

Route NEE's occlusion test through the pinned §6.3 `shadow_transmittance()` contract, which
returns a **`Spectrum`** (per-channel surviving fraction) instead of a boolean. For today's
opaque-only scenes the compiler emits the cheap boolean specialization — `scene_intersect_any`
wrapped — so this is **behavior-preserving, in fact byte-identical** (see below). The point is
the *contract*: making the shadow query spectral now is the seam where Beer–Lambert
transmittance through media and tinted null-interface crossings plug in later, with no change
to the transport loop and no contract rewrite.

**Provenance:** transcribed from `fable-compiler-contracts.md` §6.3 (the pinned signature +
rationale — "make the *contract* spectral and let the compiler specialize to the cheap boolean
version when features are absent") and `fable-reference-implementations.md` §4 (the v1
segment-walking body, whose media path is deferred here). The §10.1 item-5 text: *"`scene_intersect_any`
remains as the compiled fast path behind the `shadow_transmittance` contract."*

---

## Target shape (§6.3 pinned)

```glsl
// PINNED signature — 3 args, no medium param (§6.3). The compiler picks the body.
Spectrum shadow_transmittance(Point p, Direction wi, float dist);
```

**Item-5 body — the opaque specialization** (fixed library `glsl/shadow_opaque.glsl`, emitted
when the scene has no media). It *is* the current inline test, moved behind the contract:

```glsl
// Opaque specialization of §6.3: transmittance is 0 (blocked) or 1 (clear). No media, no
// null-interface crossings yet — the compiler emits the segment-walking form (reference §4)
// instead once the scene has media. Depends on: scene_intersect_any() (intersection feature).
Spectrum shadow_transmittance(Point p, Direction wi, float dist) {
    Ray shadow_ray;
    shadow_ray.origin    = p;          // caller pre-offsets: hit.p + n·EPSILON
    shadow_ray.direction = wi;
    shadow_ray.tmin      = EPSILON;
    shadow_ray.tmax      = dist;
    return scene_intersect_any(shadow_ray, dist) ? SPECTRUM_ZERO : SPECTRUM_ONE;
}
```

**NEE call site** (`path_trace.glsl`) — multiply the contribution by the transmittance, guard
on non-black to keep the fully-shadowed early-out (skips the BSDF eval, as today):

```glsl
Spectrum vis = shadow_transmittance(hit.p + hit.frame.n * EPSILON, ls.wi, ls.distance - EPSILON);
if (!spectrum_is_black(vis)) {
    Spectrum f     = interaction_surface_eval(mat, ls.wi, wo, hit, props);  // bare f (§2.2)
    float    cos_i = abs(dot(ls.wi, hit.frame.n));                          // transport applies the cosine
    radiance += throughput * ls.radiance * f * cos_i * vis / ls.pdf;
}
```

**Why byte-identical (stronger than items 1–3).** The opaque form draws **no random numbers**,
so the RNG stream is unchanged (items 1–3 shifted it and only preserved the *converged mean*).
The call reduces to the same `scene_intersect_any(ray, dist)` with the same ray fields; when
clear, `vis = 1.0` and `f·cos·1.0/pdf ≡ f·cos/pdf` exactly (IEEE `1.0 * x == x`); when blocked,
the `spectrum_is_black` guard skips exactly as the old `if (!intersect_any)` did. So per-sample
output is bit-for-bit identical — the snapshot GLSL moves, the pixels do not.

---

## In scope for item 5

1. **`glsl/shadow_opaque.glsl`** (NEW fixed library) — the `shadow_transmittance` opaque body
   above. Mirrors `light_point.glsl`: a fixed per-specialization file the feature includes.
2. **`lighting.ts`** (`contributeLighting`) — when `plan.program.lighting !== null`, push the
   `shadow_opaque.glsl` block *before* the generated dispatcher (both are NEE-only; ordering
   within the lighting contribution is free since neither calls the other). The lighting
   feature already runs after intersection (`scene_intersect_any`) and before transport
   (`path_trace`) — the declare-before-use chain holds without touching the feature order.
3. **`path_trace.glsl`** — replace the inline `if (!scene_intersect_any(...))` block with the
   `shadow_transmittance` + `spectrum_is_black` form above. NEE otherwise unchanged.

That's the whole change: one new fixed GLSL file, one `blocks.push` in the lighting feature,
one rewritten NEE block. No TS type changes, no Planner changes, no new uniforms.

---

## Deferred — NOT in item 5, mapped to later items

| Deferred piece | Why not now | Lands in |
|---|---|---|
| **Segment-walking media body** (reference §4): `scene_intersect_from(p,wi,t,dist,h)`, `MAX_SHADOW_SEGMENTS`, per-segment `spectrum_exp(-(σ_a+σ_s)·len)` | no media exist; opaque form is exact for opaque scenes | media item |
| **`is_null_interface(hit)` predicate** (§3.6) — the null-vs-dielectric classification that decides pass-through vs block | only the walking form reads it; opaque form blocks on *any* hit | media item |
| **Starting-medium source.** §6.3 pins the signature at **3 args** (no `medium`), but reference §4's body needs the caller's `current_medium`. Resolution (deferred, not baked): recover it from `scene_region_at(p)` (self-healing, §4.4) so the pinned 3-arg signature holds — **decide deliberately when media lands**, don't add a 4th arg (would break the pin) | opaque form needs no medium | media item |
| **`scene_medium_properties` / `MediumProperties` plumbing** | no media | media item |
| **Dielectric-shadow-opaque policy** (return `0` at a dielectric hit, reference §4 line 165) | opaque form already returns 0 on any hit; becomes a *distinction* only once null interfaces pass | dielectric item |
| **MNEE / refracted-connection** (un-declining the dielectric shadow ray — the point-light-caustic fix discussed) | §6.3 OPEN; the only WebGL2-viable caustic path, slots in by replacing the `dielectric → 0` line with a Snell root-find | far-future (§6.3 OPEN) |
| **Spectral tint through a null interface** (colored fog/glass shadows) | needs the medium form + tint | media item |

**Compatible-by-construction (no work):** environment and future area-light NEE call the *same*
`shadow_transmittance(p, wi, dist)` — it only needs a point, a direction, and a distance, all of
which those samplers already produce. The contract doesn't special-case light kind.

---

## Verification

- **Snapshot** (`generated-glsl.snapshot.test.ts`) diffs: the new `glsl/shadow_opaque.glsl`
  block and the rewritten `path_trace` NEE section, across every NEE case (cornell, minimal
  pathtracer/direct, both two-light strategies). Furnace is unaffected — `directLighting:'none'`
  emits no lighting contribution, so no `shadow_transmittance` at all. Review the diff, then `-u`.
- **Typecheck** clean (GLSL-only change; no TS types touched).
- **Live GPU (the strong claim):** cornell and two-light render **byte-identical** to pre-item-5
  — not just same-converged-mean. Confirm a fixed-seed frame is unchanged (RNG stream did not
  move). If it *does* differ, something drew a random number that shouldn't have — a bug.
- **Contract exercise:** none yet has partial transmittance (0<T<1) — that first appears with
  the media form. Item 5 installs the seam; the F-SLAB Beer–Lambert scene (validation §2) is its
  first real numeric customer, and lands with the media item.

---

## Decisions (to confirm with the user)

1. **Opaque form as a fixed library file** (`shadow_opaque.glsl`), planner-selected — parallel
   to the material/light pattern. The media form arrives as a *second* file (`shadow_media.glsl`)
   or generated block the Planner picks when the scene declares media; the boolean file is never
   edited into the media one. This is the §6.3 "compiler specializes when features absent" shape.
2. **Owned by the lighting feature**, not intersection. Rationale: `shadow_transmittance` is a
   NEE concept (reference files it under lighting, §4), it's needed *only* under `ENABLE_NEE`, and
   the lighting feature already gates on `plan.program.lighting`. It calls into intersection's
   `scene_intersect_any` across the (already-correct) feature-order boundary — a normal
   library-to-library call, same as the light dispatcher calling `point_light_sample`.
3. **Keep the pinned 3-arg signature now**; defer the medium-origin question (arg vs
   `scene_region_at`) to the media item rather than pre-threading a param the opaque form ignores.
   Consistent with the §2.11/flags discipline: don't add interface surface until a reader exists.

Related: `fable-compiler-contracts.md` §6.3; `fable-reference-implementations.md` §4;
`fable-transport-verification.md` F4 (why media shadows are segment-walk, not marching);
`fable-validation-scenes.md` §2 (F-SLAB — the media form's first numeric test).
