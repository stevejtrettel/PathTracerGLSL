# Subsurface scattering: research, decisions, and the build plan

**Status (Aug 12 2026, second pass).** The DECISIONS in §5 are the owner's and are settled. Of the
plan in §8: **Step 1 (the inversion) is BUILT and now VERIFIED against exact transport** —
`src/authoring/subsurface.ts`. **Step 2 (interior termination) is BUILT and has been CORRECTED
once** — see the §6 addendum; the first version read the wrong quantity and was inert for exactly
the media it was written for. **Step 3's white furnace is BUILT and PASSING**; **Step 3's slab
test is BUILT, and was rebuilt from scratch after the first version measured the wrong thing.**
Step 4 remains unstarted. Everything below the §6 addendum line is GPU-unswept.

**The correction that reshaped this document.** The slab test originally asserted that a medium
authored for colour `C` renders as `C`, and it failed by 5–17% with nothing broken anywhere. The
authored `C` is a **spherical albedo** — hemispherically integrated, under diffuse illumination,
which is the quantity van de Hulst's fit fits. A camera measures a **plane albedo** `A_p(µ)`:
reflectance in one exit direction. Those agree only for a Lambertian reflector, and a scattering
halfspace is not one — it is brighter at grazing than at normal, most so at low albedo. No sample
count closes the gap; it was never noise. §4 and §8 Step 3 below say this where it matters.

Two things fell out of fixing it, both good:

- The inversion is now checked against **exact transport** rather than against its own algebra.
  Measured: the fit is accurate to **0.0021 absolute** everywhere — van de Hulst's own claimed
  "at most 0.002", reproduced — and similarity holds the colour to **0.0064** across
  `g ∈ [−0.5, 0.9]`. The parameterization and its `g` term were right all along.
- The slab witness became an **exact** gate instead of one bounded by the fit's ~1% error. For
  isotropic scattering the halfspace has a classical closed-form solution, and we now assert it.

**Step 2's gate is still the slab test, not the furnace, and the reason is now one line rather
than four.** The interior survival probability is the medium's own single-scattering albedo; with
`σ_a = 0` that is exactly 1, so the rule is a no-op for ANY lossless medium. A furnace needs
losslessness to have an exact value at all, so the two requirements are mutually exclusive.

Terms are defined on first use. Every number in the tables I either quoted from a named source
or computed and checked myself; the checks are shown so they can be re-run.

---

## 1. The thing itself, in one paragraph

A translucent object is not a special kind of surface. It is **a refractive boundary with a
cloudy interior**. Light refracts in through the surface, bounces around off whatever is
suspended inside — a random walk — until it either gets absorbed or finds its way back out,
leaving somewhere other than where it entered. That displacement is the whole effect. Marble,
skin, milk, jade and porcelain differ only in how far light travels between bounces, how much
survives each bounce, and which direction bounces prefer.

We can already express this: a `dielectric` or `rough_dielectric` material with a `medium`
block. `docs/fable-volumetric-component.md` §1 predicted it would cost no new code, and it
didn't — see the `sss-lab`, `porcelain`, `porcelain-array` and `sss-presets` demo cards.

So this is **not** about adding a subsurface model. It is about two things we don't have: an
honest way to author the numbers, and a way to stop the walk that doesn't lie.

## 2. Three quantities, and why only one is intuitive

Everything below is per colour channel. That isn't a detail — chromatic behaviour is most of
what makes these materials recognisable.

| quantity | symbol | meaning | intuitive? |
|---|---|---|---|
| mean free path | `1/σ_t` | average distance travelled between bounces | **yes** |
| single-scattering albedo | `α = σ_s/σ_t` | fraction surviving each individual bounce | **no** |
| anisotropy | `g ∈ [−1,1]` | direction preference: −1 backward, 0 even, +1 forward | sort of |

The middle row is the problem. Light leaving a dense object has bounced *hundreds* of times, so
the colour you see is not `α` — it is a saturating function of `α`. The difference between
`α = 0.99` and `α = 0.999` is the difference between a grey object and a white one. Nobody can
author that by hand. This is the entire reason production renderers have an inversion step, and
it is the thing we are building.

## 3. What production does

Sources in §11. Everyone converged on the random walk; diffusion survives only as a cheap
fallback; and since 2024 the parameterization is written down in a cross-vendor spec rather than
being per-vendor folklore.

| renderer | default | fallback kept | anisotropy | note |
|---|---|---|---|---|
| Arnold | `randomwalk` (+`v2`) | empirical BSSRDF | yes, HG | `v2` better on thin/backlit, "more costly and noisier" |
| RenderMan | path-traced | Jensen / d'Eon / Burley | yes, + non-exponential flights | replaced the profile menu outright |
| Cycles | random walk | Christensen–Burley | yes; skin ≈ 0.8 | two random-walk modes because the inversion changed |
| OpenPBR (spec) | either | either | yes, HG | specifies the *parameters*, not the algorithm |
| pbrt-v4 | tabulated BSSRDF | — | — | also supports plain medium-in-a-shape |

Pixar's stated reason for switching, which is also the argument against us ever building a
diffusion model: brute-force path tracing "looks more natural and is also more robust compared
to popular diffusion-based approximations." The dipole's specific failure is assuming a flat,
semi-infinite slab, so it leaks light through nose shadows and underestimates transmission
through ears and thin edges.

Two hard constraints production reports:

- **Geometry must be closed.** Pixar: with single-sided meshes the walk "keeps marching and
  marching and never exits." Our `closed: true` watertightness check is exactly this guard.
- **Bleeding light between separate objects** (teeth into gums) needs an explicit group id —
  Arnold calls it an SSS Set Name. We have no equivalent.

## 4. The inversion we are adopting

OpenPBR is a written specification that Autodesk Standard Surface and Arnold deliberately match,
and Cycles' current source implements the same inversion. That makes it the obvious choice: it
isn't one vendor's taste, and our numbers become comparable to everyone else's.

`s` is the **similarity parameter** — one number combining `α` and `g`. It exists because a
dense forward-scattering medium and a thinner even-scattering one produce nearly the same
appearance after many bounces. That fact is why the inversion *must* take `g` as an input:

```
forward   s = sqrt((1 − α)/(1 − α·g))
          C = (1 − s)(1 − 0.139 s)/(1 + 1.17 s)

inverse   s = 4.09712 + 4.20863 C − sqrt(9.59217 + 41.6808 C + 17.7126 C²)
          α = (1 − s²)/(1 − g s²)
```

Given the colour `C` you want and the `g` you chose, that yields `α`; with `σ_t = 1/radius` the
rest follows as `σ_s = α σ_t` and `σ_a = (1 − α) σ_t`. All of it is arithmetic done once on the
CPU — nothing new on the GPU.

**What `C` IS, precisely, because getting this wrong cost a witness.** `C` is the **spherical
albedo** of a semi-infinite medium: the fraction of incident flux returned when the medium is lit
uniformly from the entire hemisphere, integrated over all exit directions. It is one number
summarising a whole distribution. It is emphatically **not** the reflectance you would measure by
looking at the medium from a particular direction — that is the **plane albedo** `A_p(µ)`, a
function of the exit cosine, and for a scattering halfspace it varies strongly: at `C = 0.3` the
reading is 0.249 head-on and 0.374 at `µ = 0.3`, a 50% spread. The two coincide only when the exit
distribution is Lambertian, which is the one thing a low-albedo medium's return is not.

This is a statement about the *authored parameter*, not about our renderer. OpenPBR defines
`subsurface_color` the same way (its composition rule `E_multi = (1 − E_spec)·C` is an energy
statement, hence hemispherical), and the fit is to van de Hulst's own diffuse-illumination
reflectance. Any test of "does the authored colour mean what it says" must therefore compare
against a *hemispherical* quantity — which is why that test lives on the CPU
(`tests/authoring/subsurface.test.ts`) and not in front of a camera.

**I verified this rather than trusting it — twice, and the second time properly.** The first pass
(the table below) checked the fit against *itself*: the inverse round-trips through the forward
formula to ~1e-5, the `α` step is exact algebra given `s`, and at `g = 0` it agrees with the
independently-derived Chiang fit to within 0.17%. All true, and all of it would still have been
true if the fit were an accurate fit to the wrong quantity.

The second pass (Aug 2026) checks it against **exact transport**. For isotropic scattering the
semi-infinite halfspace is solved in closed form by Chandrasekhar's `H`-function, so both albedos
are exactly computable — `A_s = 1 − 2√(1−α)·∫₀¹H(µ)µ dµ` — and we can simply ask whether the `α`
this inversion produces really has spherical albedo `C`. It does, to **0.0021 absolute across the
whole range** (worst at `C = 0.05`; under 0.0008 above `C = 0.6`, which is where every translucent
material actually lives). That is van de Hulst's own quoted accuracy, reproduced independently,
which is about as strong a confirmation as a fit can get. For `g ≠ 0` there is no closed form, so
that arm is checked against an independent CPU random walk instead: the colour holds to **0.0064**
across `g ∈ [−0.5, 0.9]`, worst at backward-scattering low albedo where similarity theory is
weakest and few enough bounces occur for the phase function to still matter.

The solver is `tests/helpers/halfspace.ts`, itself gated against paper-derived single-scattering
limits and Chandrasekhar's moment identity.

| `C` | `s(C)` | round-trip `C` | `α` (g=0) | Chiang `α` | difference |
|---|---|---|---|---|---|
| 0.30 | 0.49242 | 0.30000 | 0.757527 | 0.755792 | 0.173% |
| 0.50 | 0.29714 | 0.50000 | 0.911709 | 0.912298 | −0.059% |
| 0.80 | 0.09701 | 0.80001 | 0.990589 | 0.990093 | 0.050% |
| 0.95 | 0.02224 | 0.95001 | 0.999505 | 0.997939 | 0.157% |

Two fits derived by different people from different arguments agreeing this closely is good
evidence both are right. **The reason to prefer van de Hulst is the `g` term.** Chiang's fit is
isotropic-only, so under it turning the anisotropy dial silently changes the object's colour —
the hole the `porcelain-array` wedge card exposed.

**One trap, learned from Cycles having to ship two modes.** Their *legacy* mapping folded
anisotropy into the length instead: `σ_t = (1/radius)/(1 − g)`. That changes what `radius`
*means*, so old and new mappings cannot coexist silently — hence "Random Walk" and "Random Walk
(Fixed Radius)" living side by side forever. Fold `g` into `α` via `s`, never into the radius,
and we never owe anyone a compatibility mode.

## 5. Decisions (owner, settled)

**5.1 Thin shells are not part of this work.** Production ships a separate mode for leaves and
paper — a surface with no interior at all, treated as fully forward-scattering. It is a different
kind of thing and it is out of scope. Not deferred, not planned: absent.

**5.2 We do the correct scattering the whole time.** Similarity theory is *explanation only*. It
is why the inversion takes `g` (§4), and it is a real physical prediction we can observe (that is
what the `porcelain-array` card measures). It is **not** an optimization we adopt. Specifically
rejected:

- Cycles' switch to isotropic scattering after bounce 9 with a fixed guiding fraction.
- Rombo's automatic reduction of `g` with compensation ("20% less render time, same visual
  result").

Both trade the real phase function for a cheaper stand-in. We keep the authored `g` in the
Henyey–Greenstein phase function at every bounce, at every depth, always. If this costs us
render time, that is the price of the correct answer and we pay it.

**5.3 No hidden per-channel radius default.** OpenPBR's default `subsurface_radius_scale` is
`(1.0, 0.5, 0.25)`: a multiplier that makes red travel four times further than blue, so that one
`radius` dial produces the reddish bleed characteristic of skin. It is a convenience — it bakes a
colour shift into a parameter that looks neutral, and its justification is a hand-wave at
Rayleigh scattering (`σ_t ∝ λ⁻⁴`). **We do not adopt it.** Radius is authored per channel,
explicitly, and defaults to equal across channels. Anyone wanting skin's ratio types it. (For
reference, Arnold suggests `(1.0, 0.35, 0.2)` for skin.)

**5.4 From OpenPBR we take the parameterization only, for now.** Its full material — a layered
coat / specular / diffuse-and-subsurface stack with non-reciprocal albedo scaling for energy
conservation — is a much larger commitment. **Research note for later: revisit OpenPBR's material
as our collection of surface models grows; we may want more pieces of it.** Not now.

## 6. What has to be fixed, and why it is not optional

Our walk counts interior bounces against the same `maxBounces` budget as everything else, and
terminates by Russian roulette on the path's accumulated throughput, capped by `maxSurvival`
(default 0.95). Both parts fight this material.

- **The cap sits below the medium's survival rate.** At `α = 0.998` a bounce physically survives
  with probability 0.998, but the roulette kills it with probability 0.05 and compensates the
  survivors by `1/0.95` each time. Over hundreds of bounces that compounding factor is fireflies.
  Unbiased, and very noisy.
- **The budget truncates.** Set the cap to 1 instead and nothing stops the walk except
  `maxBounces` — which is a *bias*: the render converges to a darker, wrong image and no amount of
  time closes the gap.

So today the choice is noise or bias.

**Correction to an earlier draft of this section, which was wrong.** It claimed production
"terminates on absorption" while we weight the throughput, as though these were different
estimators. They are not, and the renderers do not differ from us that way. pbrt multiplies its
path weight by `σ_s/σ_t` at a real collision and then applies roulette to that weight; Cycles
terminates when the weight falls below a threshold; the original PathTracer applied Beer's law per
step and rouletted the result. All three are what we already do. I asserted the difference from
reading prose about production renderers before reading their termination code, and it did not
survive the reading.

**The defect is narrower and more specific: it is the ceiling.** Our survival probability is
`min(0.95, brightest channel of throughput)`. In a dense medium the throughput starts near 1, so
for the first many collisions the *ceiling* is the binding term — we kill 5% of paths that
physically continue with probability 0.998 and multiply each survivor by `1/0.95`. The ceiling
exists for a good reason (a clear-glass path never dims, so nothing else could ever end it) but
that reason is a property of *surfaces*, and it was applied to medium events only because both
sites share one emitted function.

The fix follows from an identity rather than a new estimator: **multiplying the weight by `α` and
then rouletting with survival probability `α` leaves the weight exactly unchanged and kills the
path with exactly the physical absorption probability.** So "terminate on absorption" is not an
alternative scheme — it is our existing scheme with the survival probability chosen per collision
from that collision's own dimming factor, uncapped, instead of from the accumulated path
brightness under a ceiling. Surfaces keep the current rule.

What this trades, stated plainly: fewer fireflies, but *longer paths* (we stop culling 5% per
collision), so more work per sample. It also moves the residual error — a dense material's
leftover error stops being noise that more samples fix and starts being truncation if
`maxBounces` is too small. This makes the bounce budget more load-bearing, not less. It does
nothing for thin or strongly-absorbing media, where the throughput was already the binding term.

Decision 5.2 raises the stakes here rather than lowering them. Holding the observed colour fixed
at `C = 0.8` and asking the inversion for `α`, the walk length grows sharply with `g`:

| `g` | `α` | ≈ bounces before absorption, `1/(1−α)` |
|---|---|---|
| −0.5 | 0.9859 | 71 |
| 0 | 0.9906 | 106 |
| 0.5 | 0.9953 | 211 |
| **0.8 (skin)** | **0.9981** | **527** |
| 0.9 | 0.9991 | 1054 |

Since we are keeping the true phase function at all depths, skin-like materials genuinely need
hundreds of bounces. Absorption-based termination is what makes that affordable *and* correct at
the same time — it is the one change that improves both.

### 6.1 Addendum (Aug 2026): the rule was built reading the wrong quantity

The argument above is right and stands. The first implementation of it was not, and the way it was
wrong is worth recording, because the symptom was invisible and the tell was a single line of code.

The rule needs "the probability this collision continues". What it was given was `ms.weight`, the
factor the volume arm had just applied to the throughput — which *looks* like the same thing and
is not. That weight is a **product**:

```
w_c  =  α_c  ×  [ σ_t,c·e^(−σ_t,c t) / mean_k(σ_t,k·e^(−σ_t,k t)) ]  ×  (η² , in the GRIN arm)
        ↑        ↑
    the physical  the chromatic channel-selection MIS ratio — a variance-reduction
     absorption   artifact of how we pick a channel, not a property of the medium
```

Only the first factor is a probability. The second averages to one across channels but is
individually unbounded, which is why the implementation needed a `min(1, …)` clamp — and that
clamp, documented at the time as "REQUIRED, not defensive", was the tell. **A physical survival
probability cannot exceed one.** When a quantity needs clamping into `[0,1]` before it can be used
as a probability, it is not the probability.

The consequence was not academic. For any medium with a **chromatic σ_t** the MIS ratio pushes the
product above 1 at essentially every collision, the clamp binds at exactly 1, and the rule does
nothing whatsoever. Chromatic σ_t is not an edge case — it is skin, marble, milk, every material
in §5.3's discussion. **The rule was inert in precisely the media that motivated it**, and no test
in the suite could have seen that, because the two scattering witnesses with absolute values both
run roulette off and the one that runs it on is lossless.

**The fix is to ask the medium instead of reading the weight.** A generated `medium_survival(med, p)`
accessor answers `σ_s/σ_t` per channel, routed per medium by the same predicate that routes
`medium_sample` itself:

- **weighted-absorption arms** (the analytic channel-MIS body, the GRIN arc-length body) hand back
  a path that is alive but dimmer, so a survival is genuinely owed: the answer is `α`.
- **tracking arms** (delta tracking, Kutz Alg. 4) already killed the path on absorption before the
  walk saw it. Nothing is owed: the answer is 1, and a program whose every scattering medium is
  delta-tracked links neither the accessor nor the rule.

There is **no clamp**, and its absence is the proof the quantity is right: `σ_s/σ_t ≤ 1` by
construction. The change is behaviour-preserving everywhere the numeric suite measures — every
witness carrying the rule has a grey or lossless medium, where the old and new probabilities are
the same number and consume the same random draw — and changes exactly the chromatic case that was
broken.

The general lesson, which is not about media: **an expression that is numerically equal to what you
want in the case you tested is not the same as the quantity you want.** The clamp was the evidence,
sitting in the source with a comment explaining why it was necessary, for a month.

## 7. What we already have

Verified against the source this session.

| capability | where | note |
|---|---|---|
| the random walk | `components/transport/integrators/pt` | medium events already count toward `maxBounces` |
| HG phase, authored `g`, both signs | `components/volume_scattering/hg` | `\|g\| ≤ 0.99`; endpoints excluded because `g = ±1` gives NaN |
| per-channel `σ_s`, `σ_a` | `MediumDescription` | plus `{param}` for live dials |
| chromatic distance sampling | `transport/volume/analytic` | one channel chosen per step, MIS over all three |
| smooth Fresnel boundary | `materials/dielectric` | with the `η²` radiance factor and TIR |
| rough Fresnel boundary | `materials/rough_dielectric` | GGX-T, built Aug 11 |
| interiors for closed meshes | Validator | watertightness actually checked, not trusted |
| nested regions | generated `scene_region_at` | innermost wins |
| furnace-style exact-value tests | `tests/witnesses` | the pattern exists (`furnace = 0.4`) |

Note the range difference: OpenPBR says `g ∈ [−1, 1]`, we allow `[−0.99, 0.99]`. That is a
numerical guard with a stated reason, not an oversight, and it is worth writing into whatever
authoring function we build so the error arrives early and legibly.

## 8. What we need

### Step 1 — the parameterization (BUILT)

**Build:** one authoring-layer function taking the colour you want, a per-channel radius and an
anisotropy, returning the `MediumDescription` the compiler already understands.

```
subsurfaceMedium({ color, radius, anisotropy }) → { sigma_s, sigma_a, phase_g }
```

**Where:** `src/authoring/` — a new file alongside `flatten.ts`. Deliberately *not* a new field
on `MediumDescription`: the compiler keeps seeing `σ_s`, `σ_a`, `phase_g` exactly as it does
today, so this batch touches **no compiler code, no component, no GLSL**. It is the same shape as
`flattenGroups`: the authoring layer composes, the compiler sees the flat result.

**Details it must get right:**
- Radius is per channel, no hidden multiplier (5.3).
- `g` passes straight through to `phase_g`, unchanged (5.2).
- Clamp `α` to `≤ 0.999999` — Cycles' clamp; without it a requested colour of pure white asks
  for a medium that never absorbs and the walk cannot terminate.
- Reject `|g| > 0.99` at authoring time with a message naming the numerical reason, rather than
  letting the Validator catch it later.
- Keep the existing direct route (`σ_s`/`σ_a` authored outright) working and unchanged. It is the
  right tool when you want to *state* the physics rather than a target appearance, and the
  transcribed-original card depends on it.

**Gate:** TS unit tests — forward/inverse round-trip, exactness of the `α` step given `s`,
monotonicity in `C`, that `g` actually moves `α` in the right direction, the clamp, and the `g`
range rejection. This is CPU arithmetic, so unit tests are the correct gate and no GPU run is
needed.

**Amended (Aug 2026): that gate was necessary and not sufficient, and I should have seen it.**
Every check listed above tests the fit against ITSELF — that the inverse inverts the forward
relation, that the algebra is the algebra. All of them would pass unchanged if the forward
relation described the wrong physical quantity. The gate now also checks the fit against EXACT
TRANSPORT: `sphericalAlbedo(alphaFromColor(C, 0)) ≈ C` via Chandrasekhar's `H`-function, and the
`g` arm against an independent random walk (§4 for the measured numbers). This is still CPU
arithmetic and still needs no GPU run — the addition is a reference to compare against, not a
change of venue.

**Risk:** essentially none. Additive, no shared code touched.

### Step 2 — absorption-based termination (the correctness blocker)

**Build:** at a medium scattering event, continue with probability `α`, weight unchanged.

**Why it is a design pass and not a patch:** our roulette is deliberately *one* generated
function used at both the surface and the medium site — a shared invariant. Absorption
termination is a **per-event** rule, whereas the current rule is a **path-throughput** rule.
Those are different in kind, and the design has to say plainly how they coexist: surfaces keep
the throughput rule, medium events get the albedo rule, and the two must not double-count. There
is also a real sub-question I do not want to answer casually: `α` is per channel, so the
continuation probability needs a single number, and the choice (maximum component? luminance? a
hero channel?) affects variance and has to be argued.

**Resolved (Aug 2026): the maximum component.** Never end a path that still carries a bright
channel — averaging would kill paths whose surviving energy sits in one channel, which is exactly
the chromatic case that matters (a dense medium whose red travels far and whose blue does not).
The cost is real and is accepted: in a chromatic medium the dim channels' throughput decays far
below the survival rate, so work continues on channels that can no longer contribute. Luminance
weighting would trade that waste for a bias in how colour noise distributes across channels, which
is the worse deal for a research renderer. **Where `α` comes from was the harder half of this
question and was answered wrong the first time — see §6.1.**

**One thing this rule gave up, deliberately, and it is not yet measured.** The medium site no
longer has any *throughput*-based termination at all. A lossless medium answers `α = 1`, so paths
in fog, haze and the furnace sphere now run to `maxBounces` where the old ceiling culled 5% per
collision. That is cost and variance, never bias. My position is that no ceiling should come back:
you cannot cull a full-throughput path without paying back exactly the variance this rule exists
to remove, and `maxBounces` is the honest terminator for a medium that never absorbs. But that is
a claim to settle with the perf witness and the `haze`/`equiangular` noise rows, not by assertion.

**Order:** before any boundary comparison, because boundary options differ precisely in how much
light they push deep, so a bounce cap biases them by *different* amounts. Comparisons run before
this measure our budget, not the models.

### Step 3 — two tests that make the rest trustworthy

**The white furnace — BUILT and PASSING (Aug 12) as the `sss-furnace` witness.** Put a lossless interior — `σ_a = 0`, any `σ_s`, any `g` — inside a
boundary, in a uniform environment of radiance `L`. Scattering conserves energy and Fresnel
refraction conserves energy, so the object must be radiometrically **invisible**: every pixel
returns exactly `L`. An exact derived number in the spirit of `furnace = 0.4`, independent of
which boundary we use, and it checks Fresnel energy conservation, the `η²` factor, total internal
reflection and the walk's weight bookkeeping all at once.

One honest caveat that makes it more useful, not less: single-scattering microfacet models
genuinely lose energy at high roughness, so a rough boundary will *not* return `L` there. The
built witness therefore uses the SMOOTH boundary, keeping 0.4 exact; measuring the rough
boundary's loss against the energy curve the rough-dielectric work characterised is worth doing
as its own witness rather than by blunting this one.

**What building it turned up, and it matters for Step 2.** Nearly every witness in the suite sets
`russianRoulette: null` as protocol, because a numeric gate wants the quietest estimator. The
interior termination rule is emitted ONLY when roulette is on — so `furnace-scatter` and `slab`,
the two absolute-value gates on scattering media, are structurally BLIND to Step 2. Nothing in
the suite asserted an absolute value on a scattering medium with roulette on. `sss-furnace`
therefore ships two arms of one scene — roulette off (the classical control) and roulette on —
and asserts 0.4 on each independently, frame-wide and over the sphere alone. Two independent
absolute gates rather than an equality between the arms: the arms have different path-length
distributions, so a χ² structure gate would not be justified, and each arm hitting the derived
number on its own is the stronger statement anyway.

**Slab albedo — REWRITTEN (Aug 2026), and the original sentence here is what went wrong.** It
read: *"A thick slab authored for colour `C` must actually measure `C`."* That is false as
written, and building it exactly as written produced a witness that failed by 5–17% with nothing
broken. `C` is a **hemispherical** albedo (§4); "measure" meant a camera, which reads a
**directional** one. The honest restatement is:

> A thick slab authored for colour `C` must have **hemispherical albedo** `C` — and separately,
> its **directional** reading at any given exit angle must be the exact plane albedo of the medium
> the inversion produced.

Those are two claims about two quantities, and they now have two gates:

- **The parameterization** → `tests/authoring/subsurface.test.ts`, on the CPU, against the exact
  spherical albedo. This is where the "authored colour means what it says" claim belongs; it is
  arithmetic plus a solver, and it needs no GPU at all.
- **The transport** → the `slab-albedo` witness, on the GPU, against the exact **plane** albedo
  `A_p(µ) = 1 − √(1−ω)·H(µ)` at a pinned exit cosine.

Making the second one exact required one change to the *instrument*: an **orthographic** camera.
A perspective camera smears a whole range of `µ` across the frame, so the expected value becomes a
frame-weighted integral nobody can state exactly; parallel rays give every pixel the same `µ` and
therefore one exact number per channel. It also removes an unforced error the first version
contained — its grazing arm pointed 27% of the frame above the horizon, reading the environment,
and would have failed for a reason unrelated to anything it claimed to measure.

The witness gained something from the rewrite too: three exit cosines instead of one, which is the
only gate in the suite on the **angular structure** of a medium's exit distribution (the reading
rises 50% from normal to `µ = 0.3` in red). And a Lambertian control at all three angles, since a
Lambertian surface must read identically at every one where the medium must not.

This still needs Step 2 to be honest — a truncated walk measures darker, and would look like a
transport error — so `maxBounces` is now *derived* in the fixture rather than chosen: truncation is
bounded by `α^n`, which puts the isotropic scene at 384 bounces and the anisotropic one at 1024.

**The anisotropic arm, and a distinction the witness system did not previously make.** Henyey–
Greenstein has no closed-form halfspace solution, so its expected value can only come from a
second, independent simulation — a CPU random walk sharing no code with the GLSL. That is worth
having, but the owner's call is that it is **not the same kind of claim** as checking a known exact
answer, and burying its statistical error inside a tolerance would let it masquerade as one. So
`kind: 'mean'` checks now declare a **tier**: `exact` (a miss is a renderer bug — reported `FAIL`)
or `cross-check` (a miss means two implementations disagree and both are suspects — reported
`DISAGREE`, counted separately, with the reference's own uncertainty stated apart from the render's
noise budget). Policy in `tests/witnesses/README.md`; it applies to the whole suite, not just here.

Note also what the anisotropic arm does *not* gate. That turning `g` holds the observed colour
fixed — §4's whole reason for choosing this inversion — is a statement about the **hemispherical**
albedo, and it is simply false of a directional reading: at `C = 0.3` the `g = 0.6` slab reads
0.218 head-on where its isotropic twin reads 0.249. That is real physics (forward scattering sends
less light straight back out; the raised `α` compensates in the hemispherical total, not
per-direction), and expecting those two to match was the *second* mistake in the original design.
The similarity claim is gated on the CPU, where it is true.

### Step 4 — boundary comparison (optional, after 1-3)

Both physically-derived candidates already exist: smooth Fresnel and rough Fresnel. So this step
needs no new occupant to start — it is a scene plus a comparison, not a build.

One confound to design around: the rough boundary lets direct lighting reach the object and the
smooth one does not, but that is caused by *our* declared shadow-ray bias
(`shadows: 'opaque-dielectrics'`), not by physics. Report the converged image (where the bias
hits both identically) separately from noise at equal sample counts (where it does not).

A third candidate exists in production — a boundary mixing diffuse and refractive transmission,
which Blender documents for Cycles although I could not confirm the weights from their source.
It is a *different interface model*, not the physically-derived one, so under 5.2's spirit it is a
future alternative and not a priority. Our material registry already anticipated it: the
`support` capability's comment names "a future translucent model [that] answers 'sphere' with
transmission FALSE".

### Step 5 — later, no committed order

- **Replace the demos' hand-chosen values with converted measurements.** The values in `sss-lab`,
  `porcelain` and `porcelain-array` were picked by eye to look plausible and to give a useful
  spread of free-path counts. They are NOT sourced, with one exception: skin's per-channel radius
  *ratio* of 1.0 : 0.35 : 0.2 is Arnold's documented suggestion. Owner is fine with this for now.
  The rigorous replacement is exact rather than another fit: Jensen et al. 2001 measured σ_s′ and
  σ_a for marble, skim milk, whole milk, skin and others, and measured coefficients map onto our
  two dials with no guessing — σ_t and α come straight out, the van de Hulst FORWARD relation
  (already implemented and unit-tested as `colorFromSimilarity` ∘ `similarityParameter`) gives the
  observed colour, and radius is 1/σ_t. That round trip is also a real test of the inversion:
  convert measurements forward to a colour, author that colour back, and the coefficients should
  return to where they started. Open question when we do it: the measured data is in mm⁻¹, so
  someone has to decide how many millimetres a scene unit is.
- **Research OpenPBR's material** as our surface-model collection grows (5.4).
- **Guided (Dwivedi) sampling.** Compatible with 5.2 — it changes only *how we sample* the same
  medium, never the medium itself, so the converged image is identical. Cycles ships it blended:
  `guided_fraction = 1 − max(0.5, |g|^0.125)`, diffusion length
  `L = 1/sqrt(1 − α^2.44294 − 0.0215813 α + 0.578637/α)`, sampled as
  `cos θ = L − (L+1)·exp(−ξ·ln((L+1)/(L−1)))`, MIS-combined with classical sampling. Note their
  *blend fraction* depends on `|g|`, which is fine, but their bounce-9 isotropic switch is
  rejected by 5.2.
- **Cross-object bleeding**: a group id so adjacent objects share an interior (§3).
- **Non-exponential free flights** (Pixar). A genuinely different transport model, not classical
  radiative transfer. Research note only — 5.2 argues for the classical answer first.

## 9. Order, and why it is that order

1. **Parameterization** (Step 1) — small, additive, unblocks authoring immediately, and its gate
   is unit tests rather than a GPU run.
2. **Termination** (Step 2) — the correctness blocker. Everything downstream is untrustworthy
   until it lands, and decision 5.2 makes it more urgent, not less.
3. **Furnace + slab tests** (Step 3) — cheap once 2 exists, and they are what let us believe 1.
   **Amended (Aug 2026): they are NOT what lets us believe 1.** Step 1's claim is about a
   hemispherical quantity that no camera can read, so believing it was always a CPU job — and
   trying to make the slab witness carry that load is exactly what produced a broken test (§8
   Step 3). The GPU tests believe the TRANSPORT. The dependency 3 → 2 is real and unchanged; the
   dependency 3 → 1 was never real.
4. **Boundary comparison** (Step 4) — needs no new code, so it can happen whenever 2 and 3 are
   done.
5. Everything in Step 5, on demand.

Steps 1 and 2 are independent of each other and could be done in either order; 1 is first only
because it is smaller and safer. Step 3 depends on 2. Step 4 depends on 2 and 3.

## 10. Explicitly rejected, so nobody re-proposes it

- Thin-shell / thin-walled surfaces (5.1).
- Runtime similarity-theory substitution: isotropic-after-N-bounces, or automatic `g` reduction
  with compensation (5.2).
- The `(1.0, 0.5, 0.25)` hidden per-channel radius default (5.3).
- Building a diffusion / dipole / BSSRDF model at all — production's own reason is in §3.
- **Any test that points a camera at a medium and expects the authored colour** (§4, §8 Step 3).
  The authored colour is hemispherical; a camera is directional; the gap is physics, not error,
  and it is largest exactly where you would reach for such a test — a dim material. If a future
  reader wants "does the colour mean what it says" on the GPU, the only honest constructions are
  a cosine-weighted quadrature over several exit angles, or an energy-balance cavity — not a
  hopeful choice of viewing angle.
- **Expecting an anisotropic medium to read the same as its similarity-matched isotropic twin in
  a single direction** (§8 Step 3). Similarity is a statement about the hemispherical total.

## 11. Sources

- OpenPBR Surface specification, ASWF — <https://academysoftwarefoundation.github.io/OpenPBR/>
- Portsmouth, *OpenPBR: Novel Features and Implementation Details* — <https://arxiv.org/pdf/2512.23696>
- Chiang, Kutz & Burley, *Practical and Controllable Subsurface Scattering for Production Path
  Tracing*, SIGGRAPH 2016 — <https://media.disneyanimation.com/uploads/production/publication_asset/153/asset/siggraph2016SSS.pdf>
- Christensen & Burley, *Approximate Reflectance Profiles for Efficient Subsurface Scattering* — <https://graphics.pixar.com/library/ApproxBSSRDF/paper.pdf>
- Wrenninge, Villemin & Hery, *Path Traced Subsurface Scattering using Anisotropic Phase
  Functions and Non-Exponential Free Flights*, Pixar 2017
- Kulla & Conty, *Revisiting Physically Based Shading at Imageworks*, SIGGRAPH 2017 course
- Arnold Standard Surface subsurface documentation, Autodesk
- Cycles `subsurface_random_walk.h` and `bssrdf.h`, Blender source — the only place I found the
  actual production formulas rather than descriptions of them
- Rombo, *Improved SSS* — <https://www.rombo.tools/2023/06/10/improved-sss/>
- d'Eon, *Zero-Variance Theory for Efficient Subsurface Scattering* — <https://eugenedeon.com/pdfs/zv2020.pdf>
- van de Hulst, *Multiple Light Scattering* — the origin of the similarity parameter and the
  semi-infinite-slab albedo relation §4 inverts

Added Aug 2026, for the correction in §4 / §6.1 / §8 Step 3:

- Chandrasekhar, *Radiative Transfer* (1950) — the `H`-function and the closed-form albedos of an
  isotropically scattering semi-infinite halfspace. `A_p(µ) = 1 − √(1−ω)H(µ)` is the exact value
  the slab witness now asserts; `tests/helpers/halfspace.ts` is the implementation.
- Kokhanovsky, *Reflection of light from semi-infinite absorbing turbid media*, Parts 1 and 2 —
  **the two quantities named apart**: Part 1 is the spherical albedo, Part 2 the plane albedo and
  the reflection function. Reading these two titles next to each other is the whole diagnosis.
- OpenPBR Surface specification, §subsurface — `E_multi = (1 − E_spec)·C` under an index-matched
  boundary, which is what fixes `C` as a hemispherical (energy) quantity rather than a
  directional one.
