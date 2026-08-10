# Emitter profiles — the angular-emission axis

**Status: FUTURE POSSIBILITY — unscheduled.** Written Aug 9 2026 at the owner's
request after the soft-beam design discussion. The simple thing was built instead
(the `softbeam` kind, this doc's §5 v0) because we don't yet know the light type
earns an axis. **Trigger to build this design: a second profile is wanted** (a
cosine-power spotlight, a Gaussian laser cross-section, a gobo) — at that point the
softbeam's hardwired gate generalizes into the registry below and `softbeam` folds
into `disk × cone`.

## 1. The problem class

Delta-direction lights (beam) through specular chains are probability-zero for the
unidirectional estimator family: NEE at a specular vertex has no lobe to evaluate;
BSDF sampling cannot hit a zero-solid-angle source. A **finite-divergence** emitter
dissolves this structurally — it is hittable, so BSDF-sampled paths through
arbitrary curved mirrors/glass terminate on it and score, the way area lights work
through glass today. The declared law: chance-hit probability scales with the
emission cone's solid angle, so variance grows as 1/δ² toward the delta limit.
Divergence is *physics* (real lasers diverge), not regularization.

## 2. The axis (why not kinds, why not materials)

An emission **profile** answers "into which directions," orthogonal to the kind's
"what shape emits." Materials cannot host it (the §3.4 schema is direction-blind and
profile parameters are per-light); new kinds per profile would duplicate every
geometric fact for one multiplicative factor. So: a third mini-registry under
`lights/`:

```
components/lights/profiles/<id>/{<id>.glsl, <id>.ts}

ProfileDescriptor {
  id,
  glsl,                 // float <id>_profile_eval(<rows...>, Direction w)
  authoredParams,       // Validator C7 loop reuses the light-kind machinery
  rows,                 // appended to the CARRYING light's generated struct
  toValues,             // authored → rows (divergence → cos_divergence, …)
  emittedSolidAngle(v), // ∫ P·cosθ dω — the power/selection factor (π·sin²δ cone; π none)
}
```

Authoring: `profile: { type: 'cone', divergence: 0.03 }` on a carrying light;
absence = the identity profile (today's hemispherical emitter, zero churn, exact
linkage keeps all profile machinery unemitted). v1 carriers: the planar one-sided
kinds (quad, disk) — the compile-time normal IS the axis. Sphere carriers need an
authored axis; deferred.

## 3. One profile truth at four read sites

The load-bearing invariant — the "Le shared exactly" (pt ≡ pt-nee) anchor extended
by one factor:

1. **NEE sampler**: `ls.radiance = Le · <id>_profile_eval(rows, ω_from_light)` — one
   multiply in the kind sampler, rows on the same generated struct.
2. **Hit-side emission**: a per-region gate in the generated emission dispatch,
   routed by the backing-material id, reading the SAME rows/literals. (The softbeam
   v0 hardwires exactly this — `ProgramDescription.materials.emissionCones`.)
3. **`lighting_pdf` / MIS**: **unchanged.** Profiles modulate radiance, not sampling
   density; MIS weights depend only on pdfs, so §11.2 equalities survive untouched.
   Profile importance sampling is a separate, later estimator improvement.
4. **Selection power**: `Φ = Le·A·emittedSolidAngle(v)`.

## 4. Radiometric pin

`emission` stays **Le** (B2 — the profile restricts where, not what the word means).
Irradiance/watts spellings are authoring-layer sugar (`Le = E/(π sin²δ)` for cone).
Profile parameters are geometry-class rows: constant in v1 (never `Value<>`), same
pin as light geometry.

## 5. Roadmap (each = one folder + one registry line once the axis exists)

| profile | gives | needs beyond the axis |
|---|---|---|
| `cone` (v0 exists as the `softbeam` KIND) | the hittable laser | nothing |
| `cosine-power` | smooth stage-light falloff, hittable (unlike delta spot) | nothing |
| `gaussian` | physical TEM₀₀ cross-profile | nothing |
| `textured` | gobos / projectors | the imagery texture rail |
| `ies` | measured luminaires | a records-channel tenant |

**The v0 that exists** (built Aug 9 2026): `softbeam` — a standalone hittable kind
(disk aperture, cone-gated radiance over the disk light's geometric pdf), whose
descriptor `emissionCone` fact + the cone-gated dispatch arm are this design's §3.2
seam in miniature. Migration when the axis lands: `softbeam` desugars to
`disk × cone`; the authored form can stay as sugar.

## 6. Related deferred work

- **Plan-time image-beam fold** (flat specular × delta beams — exact, the
  laser-between-mirrors class): a *transport* fold in the placement-fold tradition;
  independent of profiles.
- **Specular NEE for curved single bounces** (root-find the mirror point +
  curvature Jacobian): the exact answer where soft beams are only tunable-variance;
  ties to the expression-machinery root-isolation re-trigger.
- **Light tracing / photon beams**: the general answer, parked for the WebGPU
  tracer's estimator family (owner scope decision).
