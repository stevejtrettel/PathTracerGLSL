# The Volumetric Component

**Status:** Design contract for the volumetric component — the abstraction transport uses to traverse
a medium segment. Owner-decided (July 2026) after a comparison survey of pbrt-v3/v4, Mitsuba 3, and
production practice (SIGGRAPH 2017 Production Volume Rendering course, Kulla & Fajardo 2012,
Schmidt & Budge 2002, Novák et al. 2018 STAR). Refines `fable-compiler-contracts.md` §3.5/§7.2/§7.3
and **supersedes `fable-reference-implementations.md` §5's medium-segment lines** (the σ̄ ratio-weight
scheme — replaced by owner decision, §4 below). Companion: `docs/impl-plan-media.md` (to be revised
against this document).
**Date:** July 2026

---

## 1. The load-bearing separation: interfaces vs segments — PINNED

**Entering and exiting a medium is not the volumetric component's job.** Boundary crossings are
interface events owned by the surface/region machinery (§4.4): `current_medium = hit.region_to` at
`LOBE_TRANSMISSION` and at null crossings, self-healed by classification. The volumetric component's
entire world is:

> *"You are in medium M. The next boundary is at arc length `t_max`. Decide what happens in between."*

It never sees a boundary. This is exactly pbrt's split (`ray.medium` updated at crossings;
`Medium::Sample` receives only a ray and a `tMax`), Mitsuba 3's (`si.target_medium(ray.d)` flips a
single pointer), and the Novák et al. STAR's framing (free-path sampling and transmittance estimation
are separable building blocks composed by algorithms). Consequence: **interface behavior is a
material question; segment behavior is a strategy question.** The two axes never mix.

The walkthroughs: a fog cube is a null interface (no bounce) around segments run by this component;
tinted glass is a dielectric interface around absorbing segments; murky water is a dielectric
interface around scattering segments; random-walk subsurface scattering is murky water with brutal
coefficients and costs no new code. A diffusion-BSSRDF approximation, by contrast, replaces
enter→walk→exit with a surface-to-surface operator — that is a **material-axis** swap (a future
interaction model), not a volumetric-strategy swap. This document's contract locates it; it does not
build it.

## 2. The three seams — PINNED

```glsl
// ---- Seam 1: the segment decision (the volumeIntegrator strategy axis) ----
struct MediumSample {
    bool     scattered;  // true: real scattering event at t
    float    t;          // event arc length (valid when scattered)
    Spectrum weight;     // throughput factor for WHICHEVER outcome (§2.1 sample-returns-weight)
    Radiance radiance;   // inline radiance the strategy resolved itself — the RTE source term.
                         // §3 governs it. LIVE since medium emission (Jul 17 2026,
                         // impl-plan-medium-emission): the emissive arms fill it with the
                         // ε integral; non-emissive arms assign SPECTRUM_ZERO.
};
MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi);

// ---- Seam 2: per-segment transmittance (the shadow side) ----
Spectrum medium_transmittance(int med, Ray ray, float t);

// ---- Seam 3: the phase interaction — already pinned in contracts §3.5 ----
// <phase>_eval / _sample / _pdf returning InteractionSample with LOBE_MEDIUM.
```

- Both dispatchers are **generated** over the media present (§3.3 pattern) and specialized
  per material: an absorbing-only medium's `medium_sample` arm is deterministic Beer–Lambert
  (no RNG draw); a scene with no scattering media contains no sampling code at all.
- The **boundary walk stays in transport**: `shadow_transmittance` (§6.3) walks segments by
  re-spawn and composes `medium_transmittance` per segment — the same split as pbrt-v3's
  `IntersectTr` (walks) vs `Medium::Tr` (attenuates). Strategy swaps touch the per-segment
  body, never the walker.
- Strategies needing more randomness than `vec2 xi` (delta tracking's unbounded tentative
  collisions) draw from the global stream — the §2.9 escape hatch, documented per strategy.
  **Live since the heterogeneous build (Jul 17 2026):** the null-collision arms
  (`components/transport/volume/delta_tracking/`) use `xi` for the leading jump + lottery
  and `random()` for the loop tail, per this rule.
  **Freshness rule:** every tentative collision and every re-spawned segment draws fresh
  dimensions. (pbrt-v4's wavefront integrator shipped a bug reusing one distance sample across
  medium segments after a null crossing — an emissive nested volume was never sampled. Our
  counter-based `rng_dim` advances per draw, but the rule is stated so it survives refactors.)
- **Seam 4, named but unbuilt:** medium-vertex direct-lighting *placement* (equiangular sampling,
  Kulla & Fajardo 2012 — Arnold-production standard for lights embedded in media). It layers over
  seams 1–3 as a lighting-strategy concern (any 1D pdf places the NEE vertex; transmittance is
  reconstructed independently) and does not perturb this contract. Deferred with a reader:
  point-lights-in-fog scenes will show the spike-noise halos the paper documents until it lands.

**The transport call site (one shape, all strategies):**

```glsl
MediumSample ms = medium_sample(material_of(current_medium), current_ray, t_hit, random2());
radiance   += throughput * ms.radiance;      // generated ONLY under the §3 capability flag
throughput *= ms.weight;
if (ms.scattered) {
    // NEE from the event point (phase eval, NO cosine — §2.2), phase sample,
    // bounce++ (medium events count, §7.2), RR, continue
}
// else fall through to boundary logic (null interface / surface event) — unchanged
```

**Known limit, accepted:** pbrt-v4 broke this encapsulation (the null-scattering loop lives in its
integrator) because Miller-et-al MIS needs cross-strategy pdf access. If MIS *between*
distance-sampling strategies ever becomes a research target here, seam 1 gains a
`medium_sample_pdf` companion or opens up the same way. For swapping whole strategies and A/B-ing
them in the multi-renderer harness — this tracer's actual research mode — the encapsulated seam is
the right side of that trade. The majorant pin (§3.5) keeps the delta-tracking door open.

## 3. The `radiance` field and the partition rule — PINNED

The RTE along a segment has exactly three terms: attenuation of what lies beyond (**weight**),
inscattering (**event** → recursion), and the source term (**inline radiance**). pbrt-v3's minimal
`Sample`/`Tr` pair has no third slot — which is why pbrt-v3 cannot render emissive media. pbrt-v4
delivers emission at stochastically visited points (natural for tracking bodies); the production
course's component returns L directly (natural for closed-form and approximate bodies). The struct
carries the third term so each body can do what is natural to it behind one signature.

Named future readers (not speculation — owner ruling on the no-reader guideline): emissive media
(closed form: `Le·σ_a/σ_t·(1−e^{−σ_t·t})` returned inline), analytic single-scatter airlight,
approximate/stylized fog strategies.

**The partition rule.** `medium_sample` owns the partition of the segment's RTE terms:
a term returned inline MUST be excluded from events, and vice versa. Inline radiance is restricted
to terms no direct-lighting strategy can also produce (path-only, weight-1 under §6.2 bookkeeping).
Double-counting is thereby a per-strategy proof obligation, stated here once.

**The capability flag.** "Emits inline radiance" is a compile-time capability declared per volume
strategy (parallel to the materials' emissive-capable flag). The accumulate line is **generated only
for strategies that declare it** — nothing unread exists in any generated program. Bodies must still
assign the field (uninitialized GLSL struct members are garbage; assignment is checkable by eye).
**LIVE since Jul 17 2026 (impl-plan-medium-emission):** the flag is the `media.emission` link-map
decision — the walk's accumulate line, the `MediumProperties.emission` field, and the generated
`medium_emission` accessor all exist iff some medium's ε may be nonzero; the reserved slot is
exactly what the emission batch filled.

## 4. The v1 strategy: `analytic` — chromatic sampling per pbrt-v3 — PINNED (owner decision)

**Decision:** the v1 closed-form homogeneous body uses **uniform channel selection with the
balance-heuristic weight over per-channel exponential pdfs** (pbrt-v3 `HomogeneousMedium::Sample`;
also Mitsuba 3 volpath's shape). This **replaces** the σ̄ = `spectrum_average(σ_t)` ratio-weight
scheme in `fable-reference-implementations.md` §5 (which transcribed the Production Volume Rendering
course's reference integrator — a legitimate standard, but its weights are unbounded:
for σ_t spread like [0.5, 1.0, 2.0] the low channel's event weight grows as e^{+0.67t}, and F-BOX-M
multiplies dozens of such weights over 48 bounces. The balance-heuristic weights are bounded by the
channel count). Annotate reference §5 to point here.

```glsl
// medium_analytic.glsl — v1 closed-form homogeneous segment sampler (V1-C1).
// Normative. Transcribe, don't re-derive. Degenerates for grayscale extinction to:
// scatter weight = σ_s/σ_t (single-scatter albedo), survival weight = 1 — the §7.2
// "no weight on survival" pin is the grayscale special case of these formulas.
MediumSample medium_sample_analytic(MediumProperties m, float t_max, vec2 xi) {
    Spectrum sigma_t = m.sigma_a + m.sigma_s;

    int   c  = min(int(xi.x * 3.0), 2);                  // uniform channel selection
    float sc = max(sigma_t[c], 1e-9);                    // zero channel → t = huge → survive
    float t  = -log(1.0 - xi.y) / sc;

    MediumSample ms;
    ms.radiance = SPECTRUM_ZERO;                          // §3: mandatory assignment
    if (t < t_max) {
        Spectrum tr  = spectrum_exp(-sigma_t * t);
        float    pdf = spectrum_average(sigma_t * tr);    // (1/3)Σ_c σ_c e^{−σ_c t}
        ms.scattered = true;  ms.t = t;
        ms.weight = m.sigma_s * tr / max(pdf, 1e-20);
    } else {
        Spectrum tr  = spectrum_exp(-sigma_t * t_max);
        float    pdf = spectrum_average(tr);              // (1/3)Σ_c e^{−σ_c t_max}
        ms.scattered = false; ms.t = t_max;
        ms.weight = tr / max(pdf, 1e-20);
    }
    return ms;
}

// Seam 2, v1: exact Beer–Lambert. (Residual ratio tracking degenerates to exactly this for
// homogeneous media — the future heterogeneous estimator is a strict superset, zero-cost upgrade.)
Spectrum medium_transmittance_analytic(MediumProperties m, float len) {
    return spectrum_exp(-(m.sigma_a + m.sigma_s) * len);
}
```

Numerical note (from pbrt): on unbounded segments clamp `len`/`t_max` to a finite far bound before
the exponential so a zero σ_t channel never produces `inf × 0 = NaN`. Our `MAX_DIST` misses satisfy
this already; keep it true.

## 5. The strategy axis, renamed — amends contracts §7.3

`'raymarch'` was a misnomer for a closed-form sampler. The axis becomes:

```typescript
volumeIntegrator: 'none' | 'analytic' | 'raymarch' | 'delta-tracking' | 'ratio-tracking'
```

- **`analytic`** — v1: §4's closed-form homogeneous body. Default when the scene has scattering
  media ('none' otherwise); explicit field overrides.
- **`raymarch`** — reserved for honest biased fixed-step marching (Arnold ships this deliberately
  for heterogeneous transmittance: less noise, graceful degradation, hand-tuned step, irreducible
  bias). Rejected-not-removed.
- **`delta-tracking` / `ratio-tracking`** — the null-collision family (needs majorants, §3.5).
  Rejected-not-removed.

Every value is a body swap behind §2's seams; the transport loop, the call site, the phase contract,
and the shadow walker are strategy-invariant. This is the same invariance argument as
`ambient_geodesic` — Schwarzschild integrates an ODE inside the body; delta tracking loops inside
the body. And because the component speaks only arc length and advances via `ambient_geodesic`,
homogeneous media are already correct in curved spaces (Beer–Lambert along an H³ geodesic is the
same `exp(−σ·t)` in arc length).

## 6. What the survey confirmed (recorded so we stop re-deriving it)

| Question | Field practice | Our pin |
|---|---|---|
| Null crossings consume depth? | pbrt-v3: no (literal `bounces--`); Mitsuba 3: no; Schmidt–Budge "false hits": no. (pbrt-v4 wavefront: yes, per a user issue — unverified, and users needed maxdepth 50 to compensate.) | No (§7.2). `MAX_NULL_CROSSINGS` is our safety cap; pbrt-v3 has none. |
| Medium events consume depth? | pbrt-v3 & Mitsuba 3: yes | Yes (§7.2) |
| RR metric | pbrt-v3: max-component(β·etaScale); Mitsuba 3: max-component × η², clamp 0.95 | Identical (§7.2 amended) |
| Medium tracking | Mitsuba 3: single pointer, no stack. Mesh-world production: Schmidt–Budge priority interior lists (RenderMan/Arnold/Mantra) — exists *because* meshes lack a containment oracle | `current_medium` + `scene_region_at` oracle (§4.4); priorities remain the §10.2 answer for intentional partial overlap |
| Shadow transmittance | pbrt-v3 `IntersectTr` & Mitsuba 3 `sample_emitter`: segment-walk by re-spawn, nulls pass, real materials block | Identical (§6.3 + plan deviation 1) |
| HG convention | PVR course: `1+g²−2gc`, θ from propagation, g>0 forward — our reference §3 exactly. pbrt: `+2gc` with `dot(wo,wi)`; its own book footnotes the divergence, and its `Sample_p` listing states the density in the minus form while evaluating the plus form — the transcription trap incarnate | Reference §3 verbatim; do not consult pbrt for this function |
| Camera in a bounded medium | Mitsuba: authored on the sensor | Init −1, upgrade with a reader (plan §M1.4) |

Validation notes from the field, folded into our witness suite: Mitsuba 2 shipped a GPU/CPU
volumetric divergence on a camera-inside-homogeneous-medium scene, and pbrt-v4 carried unresolved
cross-integrator discrepancies on homogeneous slab scenes into 2022 — F-SLAB and cross-strategy
convergence are discriminating tests even for reference implementations. F-BOX-M's expected value
is unchanged under §4's sampler (0.4 exactly, per channel); the weight formulas it witnesses are
§4's, not reference §5's.

## 7. Consequences for `impl-plan-media.md` (revision list)

1. M2's medium-event lines are replaced by §2's call site + §4's bodies (channel-MIS, not σ̄-ratio).
2. `volumeIntegrator` values per §5 (`analytic`, not `raymarch`, in every scene/strategy).
3. The `MediumSample`/dispatch codegen joins the M1/M2 generated-tables work (seams 1–2 exist from
   M1 with the absorbing-only specialization; M2 adds the scattering arm + phase).
4. The haze strategy-pair witness as written is unbuildable (delta lights are invisible to
   BSDF/phase paths, so `pt` vs `pt-nee` can never agree while a point light contributes) — the
   equality pair moves to X-FOG with area lights. Replacement HG-sign witness: `{param}`-driven
   `phase_g`, watching the forward/backward halo asymmetry around the point light invert (the
   audit's `+2gc` bug swaps it). Expect Kulla–Fajardo spike-noise halos until seam 4 lands; write
   that into the scene's `expected`. *(Resolved: X-FOG landed with area lights — the `fog-area`
   witness passes three-way, July 2026. The g-flip witness (`haze`) stays as the live-slider
   regression.)*
5. M1→M2 staging guard: media + NEE without the spectral shadow walker is silently wrong (a null
   boundary would block a shadow ray) — temporary Validator rejection in M1, deleted by M2.
