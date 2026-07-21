# fable-mesh-lights.md — NEE/MIS sampling of emissive meshes

**STATUS: DRAFT — owner review pending.** Decision forks in §8. Nothing built.

**Goal:** an emissive mesh becomes a real samplable light — triangle-area-CDF NEE, full MIS —
instead of path-found-only. The first **data-driven light kind**: its sampler reads textures.

---

## 1. Where it sits in the lights door

The lights family's door is open (registry + descriptor desugar facts + the door test), and
an emissive mesh already has everything identity-shaped: a region id, `light_of` keyed by
region, the §6.2 w-bookkeeping. What's new is only the KIND: `mesh` joins `LIGHT_KINDS` as
its first data-driven occupant. Route: the **sampleAsLight material route** (like emissive
analytic spheres/quads) — a mesh object whose material has `sampleAsLight` + nonzero emission
enters the registry via the existing `valuesFromRegion` inverse; there is no authored
`{ kind: 'mesh' }` light (a mesh light IS a mesh object that emits — one authoring route,
no desugar-to-geometry direction needed).

## 2. The sampler (uniform-area over the mesh)

Per mesh light, ONE new rail texture: `mesh_N_lightcdf` — the normalized cumulative
**world-space** triangle areas, one texel per triangle, in the SAME (BVH-reordered) triangle
order as the index texture (one order truth).

```
mesh_light_sample(p, xi):
    tri  = binary search xi.x in lightcdf          // the sampler_cdf walk precedent (env)
    xr   = rescale xi.x within the triangle's CDF span      // pitfall-4 discipline
    bary = uniform-in-triangle from (xr, xi.y)              // the sqrt trick
    q    = world(bary · vertices)                            // constant placement folded (§5)
    wi, r from p→q;  cosL = ambient_dot(-wi, n_q)
    radiance = cosL > 0 ? Le : 0                             // ONE-SIDED (the quad pin)
    pdf  = select_pdf × r² / (cosL · A_total)                // solid-angle, A_total baked
```

- **One-sided** emission by the outward/front face — the pinned quad convention, identically.
  Back-facing samples return zero radiance with a valid pdf (unbiased, some waste on convex
  closed emitters; the visibility/solid-angle refinement is deferred like the
  spherical-rectangle quad work).
- **Uniform scale folds into the CDF for free:** A_world = s²·A_local uniformly, so the
  RELATIVE cdf is scale-invariant; only the baked `A_total` carries s².

## 3. The MIS pdf — no triangle identity needed

`mesh_light_pdf(light, p, q, wi) = r² / (cosL · A_total)` — uniform-area sampling over the
union makes the density independent of WHICH triangle was hit, so the emitter-hit MIS weight
needs only the hit geometry + the baked total area. `lighting_pdf` already receives the full
`Hit`; the arm is pure composition like every other kind. (This is why uniform-area is the
right v1: emission-weighted per-triangle CDFs would need triangle identity at the emitter
hit — exactly the `Hit.element` channel of fable-instance-attributes — a natural v2 pairing,
not a v1 requirement.)

## 4. Power + selection

`power = π · A_total · radiantScalar(Le)` (one-sided, the quad formula with the mesh's summed
area). Enters the existing power CDF/selection machinery untouched — including the two-stage
env draw and driven-emission recompute closures (`resolveLightValues` handles the emission
row; geometry rows are the texture, constant by the §6 pin below).

## 5. Placement + pins

- **Constant placement only** — the existing §6 pin ("driven placement excludes samplable
  emitters") extends verbatim: the sampler bakes the folded similarity (quat/translation/s
  literals) to map local vertices → world. The Validator rule already exists for analytic
  emitters; it gains the mesh case.
- **Instanced emissive meshes are excluded** (batch region ≠ per-instance light identity —
  deferred with per-instance emission).
- Open OR closed meshes may emit (emission is a surface affair; containment is orthogonal).

## 6. What the lights family learns (the door's first data-driven tenant)

The kind descriptor grows nothing structural — but its GLSL sampler takes SAMPLER arguments
(the cdf + position textures + the vertex data it shares with the intersection feature's
externs). Two clean consequences:
- the light feature declares `extern:mesh_N_lightcdf` + REUSES the mesh position/index
  externs (merge dedups by name — the same textures, one binding);
- the CPU side (`packMeshLightCDF`) rides `packMesh`'s output (areas from the reordered
  triangles) — one more rail texture, computed in `_uploadSceneGeometry`.

This is the pattern the many-lights BVH will later generalize (light data on the rail,
selected by walks) — mesh lights pilot it at the single-light scale.

## 7. Verification

- **`mesh-light-twin ⇄ cornell-area`-style ref** — an emissive TWO-TRIANGLE mesh quad with
  identical corner/edges/Le ≡ the analytic quad area light: same scene, pt/pt-nee/pt-mis all
  converge, equality-gated against the analytic arm (an EXACT cross-kind twin — the sharpest
  possible gate for sampler + pdf + power at once, since every formula must agree with the
  quad kind's closed forms).
- **veach-mesh** (optional): a curved emissive mesh in the veach-mis setup — pt-mis
  firefly-free (the qualitative MIS gate).
- TS: CDF builder unit test (partition, normalization, area sums vs brute); pdf↔sample
  agreement via the §11.3-style TS-twin harness if warranted.

## 8. Decision forks (owner)

1. **Uniform-area v1** (my pick — §3's identity-free pdf) vs emission-weighted triangle CDF
   (needs `Hit.element` at the emitter hit; natural v2 once instance-attributes lands).
2. **One authoring route** (sampleAsLight material on a mesh object; my pick) vs also an
   explicit `{ kind:'mesh' }` light record (adds a desugar direction for no new capability).
3. **One-sided pin** extended to meshes (my pick — hit side and sample side agree by the
   same outward-normal convention) vs two-sided emitters (the deferred quad aside applies).
4. **Sequencing** — after containment (my pick: the mesh region story settles first; also
   the glass-mesh + mesh-light demos compose into one showcase scene).
