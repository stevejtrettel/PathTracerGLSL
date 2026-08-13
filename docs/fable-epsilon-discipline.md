# The epsilon discipline: what the surface-proximity constants guard, and what they should be

**STATUS: INVESTIGATION, NOT AN APPROVED DESIGN. NOTHING HERE HAS BEEN BUILT.**
No line of code in the repository has been changed on the basis of this document. It exists so
that the owner can decide whether any of it should be, and so that whoever picks it up next does
not have to re-derive the census. Written Aug 12 2026, after the `slab-albedo` witness came in low
by 2.7 / 1.9 / 1.1% with no bug in the transport.

**Every claim below carries a confidence grade. Do not skip them.** The distinction between what
was read, what was measured, and what was proposed is the most important content in this file —
the analysis is roughly one-third derivation and two-thirds proposal, and it was written by a
model. Treat the proposals as hypotheses with named falsifiers, not as a plan.

| grade | meaning |
|---|---|
| **[READ]** | Quoted from the source at the cited `file:line`. Verifiable in seconds. |
| **[MEASURED]** | Produced by code that is in the repository and gated by its own tests. Reproducible. |
| **[ARITHMETIC]** | Follows from [READ] facts by calculation you can redo. |
| **[CITED]** | External source, verified to exist and to say what is attributed to it. |
| **[INFERRED]** | Traced through the code by reading, but never executed or measured. |
| **[PROPOSED]** | An engineering criterion this document invents. Not derived from anything. |

---

## 1. Why this exists

**[MEASURED]** `slab-albedo` (`tests/witnesses/scenes/slabAlbedoWitness.ts`) puts a semi-infinite
scattering halfspace under a uniform environment and measures its plane albedo through an
orthographic camera. For isotropic scattering that quantity is known exactly — Chandrasekhar's
`A_p(µ) = 1 − √(1−ω)·H(µ)`, solved to ~1e-14 by `tests/helpers/halfspace.ts` and gated three
independent ways in `halfspace.test.ts` (paper-derived single-scattering limits, the moment
identity `∫₀¹H dµ = (2/ω)(1−√(1−ω))`, and an independent random walk).

The Aug 12 sweep measured, against those exact values:

| arm | measured | exact | deficit |
|---|---|---|---|
| µ = 1 | 0.2420 / 0.4293 / 0.6395 | 0.2488 / 0.4375 / 0.6466 | −2.7 / −1.9 / −1.1 % |
| µ = 0.6 | 0.2980 / 0.4990 / 0.7006 | 0.3066 / 0.5088 / 0.7086 | −2.8 / −1.9 / −1.1 % |
| µ = 0.3 | 0.3627 / 0.5704 / 0.7561 | 0.3741 / 0.5824 / 0.7654 | −3.1 / −2.1 / −1.2 % |

**[MEASURED]** The Lambertian control (`slab-albedo-ref`) reads 0.3000 / 0.5000 / 0.7000 at every
one of those angles, so the camera, environment, framing and accumulation are exact. The deficit is
in the medium.

**[MEASURED]** Three signatures, each excluding an alternative:

- The deficit is **proportional to the single-scattering share** (47 : 32 : 23% of the total →
  predicted ratios 1 : 0.69 : 0.49; measured 1 : 0.69 : 0.40). So it is a near-surface effect, not
  a per-collision loss (which would hurt the highest-albedo channel most) and not truncation
  (same signature).
- The deficit **grows toward grazing as 1/µ**. An offset applied along the *ray* would shrink at
  grazing; only a fixed-*depth* offset — i.e. along the normal — grows.
- A model in which the walk begins **~0.026 optical depths below the surface** reproduces all nine
  measurements to ~0.002, with the residual flat in µ.

**[READ]** `ray_spawn` (`src/glsl/core/ray.glsl:16`) displaces the origin by `EPSILON` **along the
normal**. **[ARITHMETIC]** At this fixture's `σ_t = 20`, `EPSILON = 1e-3` is 0.020 optical depths —
about 77% of the fitted 0.026.

**A fit consistent with a mechanism is not proof of one.** The remaining ~23% is unexplained; §6
names the suspect and the test that would settle it.

---

## 2. The census: seven jobs, two numbers

**[READ]** Every use of the surface-proximity constants in `src/`. Values: `EPSILON = 1e-3`
(`core/math.glsl:8`), `EPS_INTERFACE = 1e-3` (`core/math.glsl:10`), `MARCH_EPSILON = 1e-4`,
`NORMAL_EPSILON = 1e-3`, `MARCH_EPSILON_MAX = 5e-4` (`core/march.glsl:13,14,19`), and
`march_epsilon(t) = min(5e-4, 1e-4·(1+t))` (`core/march.glsl:20`).

| # | site | constant | what it guards |
|---|---|---|---|
| **J1** | `ray.glsl:16` — spawned origin moved along the normal | `EPSILON` | the next query re-finding the surface just left |
| **J2** | `t > EPSILON` in `sphere:26`, `box:28,51`, `plane:16`, `quad:13`, `disk:14`, `cylinder:47,87` | `EPSILON` | the same, along the ray |
| **J3** | `maxDist − 2·EPSILON` in `shadow/opaque:14`, `shadow/media:30` | `EPSILON` | the light's own surface counting as an occluder |
| **J4** | GRIN exit pull-back `2·EPSILON`, `grin.glsl:180,323` | `EPSILON` | **keyed to J2** — "robustly above the primitives' `t > EPSILON` floor" |
| **J5** | `t = max(t0, EPSILON)`, `geometry/index.ts:288` | `EPSILON` | restarting a march inside the marcher's acceptance band |
| **J6** | `scene_region_at(hit.p ± n·EPS_INTERFACE)`, `generate/features/intersection.ts:1647,1655` | `EPS_INTERFACE` | classifying which region is outside |
| **J7** | tetrahedral gradient taps, `geometry/index.ts:323` | `NORMAL_EPSILON` | finite-difference normal of an SDF |

### 2.1 `EPSILON` turns out to be derived — from the marcher

**[READ + INFERRED]** J5 requires the spawn offset to exceed the marcher's acceptance band, whose
cap is `MARCH_EPSILON_MAX = 5e-4`. `EPSILON = 1e-3` is exactly 2× that — the same rule
`EPS_INTERFACE` states out loud ("10× MARCH_EPSILON so a probe along the normal clears the
marcher's stop-short residual", `math.glsl:10`).

So the number is **correct for a marched surface** and was never re-derived for anything else.
J1–J4 inherited a marcher constant. The inference is that this is *why* it is 1e-3; the constant
itself carries no comment, so this cannot be graded [READ].

---

## 3. The organising principle

**[PROPOSED]** The requirement does not depend on the *consumer* of `hit.p`. It depends on **how
`hit.p` was produced**:

| provenance | positional accuracy | scale |
|---|---|---|
| analytic root (sphere/box/plane/quad/disk/cylinder) | floating point | `~\|p\|·2⁻²³`, a few ulp → **2e-7 … 2e-6** for \|p\| ∈ [1,10] |
| triangle test (mesh) | floating point | same |
| march, **unrefined** | `march_epsilon(t)` by construction | **1e-4 … 5e-4** |
| march, **refined** (`refine: C`) | bracket / 2¹⁴ | **~3e-8** |

**[ARITHMETIC]** Three orders of magnitude between the analytic and unrefined-march regimes, with
one constant serving both.

This is a *provenance* fact, and the compiler already has it: backend resolution is a Planner
decision (`resolveBackend`) and `Hit` carries `region_owner`.

---

## 4. What each job should be

**[PROPOSED] throughout this section.** One new primitive is required: `fp_uncertainty(p)`, the
ulp-scale positional error, coordinate-relative rather than absolute.

| job | proposed requirement | current | ratio (analytic case) |
|---|---|---|---|
| J1 spawn offset | the uncertainty of the hit it spawns from: `fp_uncertainty(p)` analytic, `2·march_epsilon(t)` unrefined-march | 1e-3 | ~1000× |
| J2 acceptance floor | `fp_uncertainty(origin)` | 1e-3 | ~1000× |
| J3 shadow back-off | `2 · fp_uncertainty` (two endpoints, two errors) | 2e-3 | ~1000× |
| J4 GRIN pull-back | 2× J2 — already derived, follows automatically | — | — |
| J5 march start | `2 · march_epsilon(t0)` — spelled from the *marcher*, not from `EPSILON` | 1e-3 | correct by coincidence |
| J6 classification probe | **two-sided — see §5** | 1e-3 | — |
| J7 gradient tap | **unexamined — see §8** | 1e-3 | — |

**[CITED]** `fp_uncertainty` is a solved problem: Wächter & Binder, *Ray Tracing Gems* ch. 6,
pp. 77–85, computes the offset in integer space so it is correct at any coordinate magnitude.
The abstract's own claim is "more robust than current common practice, minimal overhead, requiring
no parameter tweaking". <https://research.nvidia.com/publication/2019-03_A-Fast-and> — transcribe,
do not re-derive (house rule).

**[READ]** Secondary consequence worth weighing independently of media: `Validator.ts:1487` warns
when `transform.scale` exceeds 10² because "world-space epsilons (EPSILON, MARCH_EPSILON,
EPS_INTERFACE) are fixed". Making J1–J3 fp-relative makes them **scale-free by construction**, and
that warning largely dissolves.

---

## 5. J6 is different in kind and should stay generous

**[READ]** Every other job fails in one direction: too small and you self-intersect. The
classification probe fails in **two**:

- too small → does not clear the marcher's stop-short residual → misclassifies the outside region;
- too big → steps through a thin feature or a narrow gap between nested regions → also
  misclassifies.

**[INFERRED]** So J6 has a genuine two-sided bound —
`2·march_epsilon(cap) ≤ EPS_INTERFACE ≪ thinnest region gap in the scene`. The current value is the
lower bound, correctly derived and enforced by `tests/compiler/epsilonCoupling.test.ts`. **The
upper bound is scene-dependent and nothing checks it.** That is an open gap independent of
everything else in this document.

**[INFERRED]** J6 **costs no energy** — it is a query, not a path segment. An earlier draft of this
analysis wrongly suspected `EPS_INTERFACE` of contributing to the §1 deficit. It cannot.

---

## 6. The unexplained ~23%: J2 is the suspect

**[READ]** `sphere.glsl:24`, verbatim:

> *Outside origins whose near root is ≤ EPSILON now miss (hairline, energy-bounded).*

**[INFERRED — traced by reading `pt.ts`, never executed]** Consider a path scattering inside a
medium within `EPSILON` of the boundary, heading outward. The primitive computes the exit root,
finds `t < EPSILON`, and returns false. Then in the walk:

- `pt.ts:280` — `medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, …)`. With
  `boundary = false` the medium is sampled over `[0, MAX_DIST]`.
- `pt.ts:342` — the §4.4 self-heal runs **only when a boundary was found**. There is no repair.

**[ARITHMETIC]** At `σ_t = 20` the probability of surviving `MAX_DIST` without scattering is
effectively zero, so such a path scatters *outside the object*, in a medium that extends to
infinity, and continues until it absorbs or exhausts `maxBounces`.

If this is real it is not a "hairline miss" — it is a leak, it deletes the same population as J1
(shallow, outbound), and it is the same 1e-3 in the same units. Two mechanisms, one constant.

**This has not been measured.** J1 and J2 have different µ-dependence, so a CPU walk modelling each
separately can pin the split. That is the cheapest open item in this document.

---

## 7. The marcher, and what media do to its tolerance

### 7.1 `MARCH_EPSILON` has a wide legal window and sits in the middle of it

**[ARITHMETIC]** Two computable ends, for this scene scale:

- **Lower — the field's numerical resolution.** `f` is evaluated in fp32; for a scene of extent
  ~10 the absolute error in `f` is ~`10·6e-8 ≈ 6e-7`. Compound fields (the gyroid's `√6` divisor,
  the quartic tangle) are worse. So `ε_m ≳ 1e-6`. *This end is an estimate, not a measurement.*
- **Upper — sub-pixel geometry.** At the witness budget (160×120, fov 1.0) an angular pixel is
  `1.0/120 ≈ 0.0083` rad; at `t = 3` that is 0.025 world units. So `ε_m ≲ 1e-2`.

The window is four orders wide and `1e-4` is almost exactly its geometric mean — what you pick when
the only criteria are "converges" and "sub-pixel", which was the situation when there were no media.

### 7.2 Media supply a third criterion

**[PROPOSED]** For a boundary around a medium, the positional uncertainty of the entry point *is*
an optical-depth uncertainty, `τ_err = σ_t · ε_hit`, and no offset discipline can recover it. Hence

```
ε_hit  ≤  τ_tol / σ_t
```

**This criterion is invented by this document. It is not derived from anything in the codebase.**
It is a defensible engineering rule and should be argued with, not adopted.

**[ARITHMETIC]** At `σ_t = 20` and `τ_tol = 1e-3`: `ε_hit ≤ 5e-5`.

### 7.3 The correction that matters: refinement changes who this applies to

**[READ]** `geometry/index.ts:245-275`. Hit refinement is **opt-in** (`d.refine !== undefined`).
When declared it runs a doubling bracket sized by the declared factor, then **14 bisections**,
giving a residual of ~`march_epsilon/2¹⁴ ≈ 3e-8` — floating-point level. §7.2 is **void** for a
refined shape.

**[READ]** Exactly **one** thing in the repository declares `refine`: the quartic tangle in
`tests/witnesses/scenes/customFieldWitness.ts:60` (`refine: 4`). **Zero** of the eleven registered
marched geometry shapes do — including the bottle that `porcelain`, the flagship subsurface demo,
uses as a marched shell around a medium.

So §7.2 applies in practice to essentially every marched medium boundary — but for a contingent
reason, not a structural one. **If `refine` adoption changes, this section's conclusion changes
with it.** An alternative worth weighing: rather than tightening `ε_m` globally, *require*
`refine` on any marched shape that bounds a medium. That reaches fp accuracy without touching the
step budget of shapes that don't need it, and it is a declared-fact change rather than a numeric
one.

### 7.4 The adaptive growth is justified by the wrong argument for media

**[READ]** `march.glsl:17-19`: the acceptance threshold grows with distance, justified as
"pixel-footprint scaling: a fixed 1e-4 at t = 40 resolves geometry far below one pixel and just
burns steps".

**[PROPOSED]** That argument is about **resolution**. Optical depth is about **energy**. A boundary
located `5e-4` too deep does not blur a silhouette; it deletes `σ_t·5e-4` of medium.

**[ARITHMETIC]** At `σ_t = 20` the cap is worth `τ = 0.010`, ≈ 1.6% in albedo at `C = 0.3`, reached
at `t ≈ 4`.

**[PROPOSED — never observed]** Consequence: an unrefined marched object with an interior medium
should get **darker as the camera pulls back**, saturating at `t ≈ 4`. Nothing in the suite would
see this. It deserves its own witness before it is believed: the same marched translucent object at
two camera distances, which must read the same.

---

## 8. What this document does not cover

- **J7, the gradient tap** (`NORMAL_EPSILON = 1e-3`). A finite-difference step has its own
  two-sided bound — cancellation below, curvature above — and it is a different analysis. It is
  listed in the census for completeness and has not been examined.
- **Curved spaces.** Every offset here is spelled through `ambient_geodesic`. What "a few ulp along
  the normal" means in H³ or Schwarzschild has not been considered.
- **The mesh arms.** `mesh.glsl:85,107` use `t > EPSILON`; `mesh_side_range` deliberately uses
  `t > 0.0` with a comment explaining why. Read them before touching J2.
- **Whether any of this is affordable.** No performance number in this document is measured.

---

## 9. Open measurements, in the order they should be taken

Each is stated with what it would settle. **Nothing here should become code before the first two.**

1. **The J1/J2 split.** CPU only, free. Model each mechanism separately in a halfspace random walk
   (`tests/helpers/halfspace.ts` already has the walk) and compare against the nine measured
   numbers. Settles §6, and tells you whether one fix or two are needed.
2. **`npm run witness -- slab-albedo slab-albedo-sparse`.** `slab-albedo-sparse` is already built
   and registered: the same medium at `σ_t = 2` in a slab ten times deeper, so it is still 80 free
   paths and still semi-infinite. `A_p` is scale-invariant in `σ_t`, so it must read the identical
   numbers. **This is the falsifier for the entire document.** If the deficit scales down by ten,
   the density-scaling law holds. If it does not, §1's diagnosis is wrong and everything after it
   should be discarded.
3. **The march-step cost of a tighter `ε_m`** (`npm run witness -- --perf`). Sphere tracing degrades
   badly at grazing incidence and this codebase already carries a stall-aware exhaustion path for
   it; the cost is not guessable. Settles whether §7.2 is affordable, or whether the `refine`
   route in §7.3 is the better trade.
4. **A distance-invariance witness for a marched medium boundary.** Settles §7.4, which is
   currently a prediction with no observation behind it.

---

## 10. What would falsify this

- `slab-albedo-sparse` reading low by the same amount as `slab-albedo` ⇒ the deficit is not
  density-scaled, so it is not an epsilon effect, and §§2–7 are built on a wrong premise.
- The J1/J2 CPU split failing to reach the measured 0.026 ⇒ a third mechanism exists and has not
  been found.
- A marched translucent object reading the same at two camera distances ⇒ §7.4 is wrong.

---

## 11. Standing state if nothing is done

`slab-albedo` stays **red**, with the cause written into its registry card. Its expected values are
exact and were deliberately **not** loosened — hiding a measured bias behind a tolerance is how the
next real defect gets missed. Red-and-documented is a legitimate resting state; it is what the four
grin furnaces and `softbeam-wall` already are.

`slab-albedo-sparse` is the control that would prove or refute the mechanism, and it costs one
filtered sweep.

The full Aug 12 sweep state — all ten failing checks in four unrelated groups, with what is and
is not established about each — is recorded in `tests/witnesses/README.md` under "Known failing
witnesses". Read it before assuming a red row belongs to this document: only four of the ten do.

---

## 12. Sources

- Wächter & Binder, *A Fast and Robust Method for Avoiding Self-Intersection*, Ray Tracing Gems
  ch. 6, pp. 77–85 (2019) — <https://research.nvidia.com/publication/2019-03_A-Fast-and>
- Chandrasekhar, *Radiative Transfer* (1950) — the `H`-function and the closed-form albedos of an
  isotropically scattering semi-infinite halfspace. Implemented in `tests/helpers/halfspace.ts`.
- In-repo: `docs/fable-subsurface.md` §4 and §8 Step 3 (why the slab witness measures what it
  measures), `tests/witnesses/README.md` (the exact / cross-check tier policy),
  `tests/compiler/epsilonCoupling.test.ts` (the one coupling rule currently enforced).
