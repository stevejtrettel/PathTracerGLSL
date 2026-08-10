# Implementation plan: the delta-direction light class — `directional` + `beam`

**Status: BUILT Aug 9 2026 — numeric witness sweep OWNER-GATED.** All tasks T1–T4
landed as planned (vitest 1466 green, tsc clean; kitchen sink glslang-links both
kinds; snapshot additions only — zero churn in existing scenes). Runtime
spot-checked headless (SwiftShader, linear on-screen radiance): sun gate region
0.129 (≈0.1273 + 8-bit quantization + ~1e-3 sphere bounce), beam-wall spot 0.318 vs
0.31831 derived, beam-slab triple (0.1176, 0.0431, 0.0078) vs (0.1171, 0.0431,
0.0058), beam-fog shaft + laser demo render. Build deviations from the plan, both
cosmetic: the sun witness gained a clay-sphere occluder (a flat uniform-floor frame
gated the same number but showed nothing — the hard parallel shadow is the class
signature; gate moved to a clean-floor region, tol 0.003 absorbing the bounce
contamination), and two stale test expectations flipped ('rejects directional' →
accepts, in validator.test.ts and compiler.test.ts — the reserved word became the
kind by design). `npm run witness -- sun beam-wall beam-slab beam-fog` is the
owner's sweep set.

Authored Aug 9 2026 after a code audit (spot
descriptor, techniques/light NEE sites, shadow_media walker, Validator light section,
computeSelectPdf). Authority: `src/components/lights/README.md` (the occupant
contract), compiler-contracts §6.1/§6.4 (delta conventions, MIS weight 1),
`impl-plan-equiangular.md` §3 (the anisotropic-delta pin), B2 (one radiometric word).
Both kinds go through the finished lights door: **one GLSL file + one descriptor + one
registry line each** — the door test (`tests/compiler/lightsDoor.test.ts`) already
proves this shape compiles end to end.

## 1. What and why

The registry has two delta-in-**position** kinds (point, spot) and four area kinds.
The delta-in-**direction** class has zero occupants. This batch adds both members:

- **`directional`** — the sun. Uniform irradiance E from a fixed direction, no
  falloff, shadow ray to infinity. The kind name is already reserved input
  vocabulary (Validator.ts ~L68) — this batch makes the word real.
- **`beam`** — a collimated beam with a finite circular cross-section (disk aperture,
  radius r): the honest laser. The true delta² laser (delta in position AND
  direction) is unbuildable in an unbiased tracer — the eye ray and the beam line
  are two lines in 3D, single-scatter visibility is supported on a measure-zero set,
  and NO sampling strategy finds it (this degeneracy is why the photon-beams
  literature introduces a 1D blur kernel, i.e. bias). Finite cross-section dissolves
  the degeneracy exactly AND is the more physical model (real beams have a waist).
  From any point p inside the beam cylinder, exactly one emitted ray arrives — the
  sample is an **evaluation**, the same shape as every delta kind we have.

The visible-beam-in-fog shot then falls out of machinery that already exists:
distance sampling puts a medium vertex on the eye ray; when it lands inside the
cylinder, the delta NEE connection lights it; `shadow_transmittance` supplies the
beam's own attenuation from the aperture. Zero new seams, zero loop changes.

## 2. Design pins

**P1 — class semantics.** Both kinds: `delta: true`, `LIGHT_DELTA`, per-light pdf 1,
never BSDF-hittable, MIS weight 1 (§6.4), no `region` fact, no pdf function. Both are
ANISOTROPIC deltas → **no `deltaQuery` fact**, and the equiangular rejection is
already structural (`Validator.ts` ~L489 rejects `delta && deltaQuery === undefined`)
— zero Validator code for this. Consequence (existing contract, worth stating): plain
`pt` sees NEITHER kind, exactly as it sees no point/spot light today — these scenes
are nee/mis arms.

**P2 — `emission` = irradiance (W/m²).** B2's dimensional ladder gets its fourth
rung: intensity (delta-position) / radiance Le (area) / ε (media) / **irradiance E
(delta-direction)**. For `directional`, E is measured on a plane ⊥ to the direction
(radiance folds the cosine at the shading point via the BSDF as usual). For `beam`,
E is the irradiance across the aperture. Registry row name: `irradiance`
(radiometric, Spectrum) — `toValues` maps the precomputed emission product straight
into it, the spot `intensity` pattern.

**P3 — `direction` = propagation direction** (the way light TRAVELS), matching
spot's convention. Samplers set `wi = -l.direction`. Row kind `'direction'` (rotates
under future driven placement, never scales).

**P4 — `directional` occupant.** Rows: `direction`, `irradiance`. Sampler:

```glsl
ls.wi = -l.direction;  ls.distance = 1.0e20;   // §6.1 env convention (sampler_cdf.glsl L68)
ls.radiance = l.irradiance;  ls.pdf = 1.0;  ls.flags = LIGHT_DELTA;
```

The `1.0e20` sentinel is ALREADY the pinned convention — `structs.glsl` L58
documents `distance` as "1e20 for directional/environment" and the env sampler uses
it today, so every downstream consumer is proven: `ambient_geodesic(p, wi, 1e20)` is
finite in float32, the media shadow walker's fixed-target `remaining` arithmetic is
exact at that scale, and an unbounded ambient MEDIUM attenuates the sun to zero —
which is correct physics (infinite fog swallows a distant source) and identical to
how the samplable env behaves now. The Validator's reserved-word branch becomes dead
(it lives inside `if (d === undefined)`) — DELETE it; registration is the fix it was
waiting for.

**P5 — `beam` occupant.** Rows: `position` (aperture center, kind `point`),
`direction`, `radius` (kind `length` — scales under similarity), `irradiance`.
Sampler — pure projection test, no RNG consumed:

```glsl
LightSample beam_light_sample(BeamLight l, Point p, vec2 xi) {
    LightSample ls;
    vec3  rel    = p - l.position;
    float s      = dot(rel, l.direction);           // axial distance (metric exemption: Euclidean closed form)
    vec3  radial = rel - s * l.direction;
    if (s <= 0.0 || dot(radial, radial) > l.radius * l.radius) {
        ls.pdf = 0.0; return ls;                    // outside the cylinder: invalid sample
    }
    ls.wi = -l.direction;  ls.distance = s;         // shadow target = the aperture point p - s*d
    ls.radiance = l.irradiance;                     // NO falloff folded — collimated; T is the walker's job
    ls.pdf = 1.0;  ls.flags = LIGHT_DELTA;  ls.light_id = -1;
    return ls;
}
```

`pdf = 0` is the techniques' existing skip guard (`if (ls.pdf <= 0.0) return;` at
both NEE sites) — no new protocol. Collimation means transmittance is the ONLY
attenuation, and `shadow_transmittance(ray, aperture_point)` already computes it
(occluders and media between aperture and p; nothing behind the aperture blocks).
No `range` row — occlusion terminates the beam, which is what a laser does. v1 is a
HARD-EDGED disk (exact witness numbers); the Gaussian radial profile is one deferred
row (§6).

**P6 — selection power (pbrt PowerLightSampler formulas).** `beam`: Φ = E·πr² —
pure over rows. `directional`: pbrt's Φ = E·π·R²_world needs a scene fact the
`power(values)` signature doesn't carry. Mechanism: **`PlannedLight.powerCtx`** —
the Planner stamps `{ worldRadius }` on directional lights at desugar time
(bounding-sphere radius of the boundable geometry; unboundable-only scenes — bare
planes — fall back to a constant 10). `lightPower` passes it through as an optional
second `power(values, ctx?)` argument; `computeSelectPdf`'s exported signature and
the driven-recompute closures are untouched (worldRadius is not parameter-driven).
Declared: selection weights are VARIANCE-ONLY (`cdf_rescale` keeps every choice
unbiased) — the fallback is a heuristic by license, not an approximation of the
estimator.

**P7 — the v1 noise ceiling, declared.** Beam-in-fog via vertex NEE: distance
sampling is proportional to transmittance, not proximity to the beam, so only
vertices landing on the (short) eye-ray∩cylinder overlap contribute — tight beams in
thin fog will be firefly-ish at low spp. The unbiased fix is a beam-aware medium
technique (ray–cylinder intersection gives the overlap segment analytically; place
the vertex inside it) — exactly the `estimator.mediumLightSampling` axis the
equiangular batch carved. DEFERRED to its own batch (§6); v1 ships honest with this
paragraph as the caveat.

## 3. Tasks

**T1 — `directional`.** `components/lights/directional/{directional.glsl,
directional.ts}` + registry line. Delete the Validator reserved-word branch. Planner:
`powerCtx` stamp + the worldRadius computation (boundable-object bounding sphere —
reuse the instancing-era bounds machinery). Descriptor `power(values, ctx?)`
signature extension (only directional reads ctx).

**T2 — `beam`.** `components/lights/beam/{beam.glsl, beam.ts}` + registry line.
Row constraints: direction min-length (spot's), radius positive. No coupled rules →
no `validateAuthored` (it's optional; absence is the honest declaration).

**T3 — structure + static gates.** Both kinds into the registry kitchen-sink scene
(glslang link coverage); symbol-contract + desugar-totality tests pick the kinds up
from the registry automatically — verify, don't hand-add. Snapshot expectation:
ZERO churn in existing scenes (pure registry addition), new goldens only where a
witness scene enters the snapshot suite.

**T4 — witnesses + demos** (registry entries; sweep owner-gated as always).

## 4. Witnesses

| id | scene | arms | gate | derivation |
|---|---|---|---|---|
| `sun` | directional E=1 straight down, ρ=0.5 lambertian floor filling frame, black env, vacuum | pt-nee | mean **0.1592** (4-digit) | L = ρE/π = 0.5/π |
| `beam-wall` | beam ⊥ wall (ρ=0.5), vacuum, camera framed INSIDE the spot | pt-nee | mean **0.1592** | same closed form; gates the cylinder test + evaluation path |
| `beam-slab` | beam-wall through a chromatic ABSORBING-only slab (σ_a per-channel, depth D) | pt-nee | per-channel triple, exact | L_c = ρ·E·e^{−σ_a,c·D}/π — the F-SLAB pattern; gates the walker-supplied beam transmittance with zero scattering confound |
| `beam-fog` | beam crossing a bounded HG g=0 scattering fog box, side view — THE visible-beam shot | pt-nee ≡ pt-mis | identical-stream twin + calibrated mean tripwire | equality gates the MIS bookkeeping over the new delta kind; the derived single-scatter frame mean is an offline integral — calibrate the tripwire at sweep time |

Demos: `laser` card (fog + mirror bounce — the beam folding across the scene) and a
sun-through-fog god-ray card if it earns its place; demos are the replaceable layer.

## 5. Gates

tsc + targeted vitest while iterating; full vitest once per batch (snapshots:
zero-churn expectation is itself the gate); glslang via kitchen-sink; `npm run
witness` sweep owner-called. No perf arm — delta samplers are O(1) evaluations.

## 6. Deferred ledger

- **Beam-segment medium technique** — the noise fix (P7): `mediumLightSampling`
  occupant sampling the eye-ray∩cylinder overlap; needs the per-light placement
  query design discussion (the equiangular area-arm sibling). Trigger: first real
  laser-in-thin-fog scene that fireflies.
- **Gaussian radial profile row** on beam (one `exp` in the sampler + the power
  integral; witness numbers change) — after v1 gates green.
- **Tube/cylinder area light** — blocked on the cylinder analytic occupant
  (placement-fold stage 4).
- **Projection light (gobo) / textured area emitters** — after the imagery texture
  rail matures (needs an image CDF for importance sampling).
- **Portal lights**; **Hosek–Wilkie sun-sky** (an env-family procedural occupant,
  NOT a light kind — pairs naturally with `directional` when built).
- **Direction-dependent `deltaQuery`** form (would admit spot/beam/directional under
  equiangular) — the impl-plan-equiangular deferral, unchanged.
