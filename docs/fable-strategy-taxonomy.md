# Strategy Taxonomy — the semantics of the compiler's two input languages

**Author:** Fable (July 2026, owner-decided design discussion)
**Status:** PINNED — governs the meaning of `SceneDescription` and `RenderStrategy` and the
obligations attached to every present and future field. The schema restructuring that realizes
it lands with the decision-hoist batch (see Migration below); until then this doc is the
authority on *classification*, and the current flat schema is an implementation detail.
**Companion:** [fable-compiler-contracts.md](fable-compiler-contracts.md) governs the GLSL
contracts *inside* the generated program; this doc governs what the inputs *mean*. §7.3's
"scene = specimen; strategy = experiment" is refined, not replaced, by the decomposition below.

---

## 1. The math

A pixel's value is a pairing of a measurement functional with the equilibrium light field:

```
I_j = ⟨ W_j , L ⟩         where   L = (I − T)⁻¹ E  =  E + TE + T²E + …
```

- **T** — the transport operator: BSDFs, phase functions, geometry, visibility.
- **E** — the emission source: emitters, environment.
- **W_j** — the measurement functional of pixel j: camera ray distribution × pixel footprint
  × response (which quantity is reported).

Every field anywhere in the input languages modifies exactly one of: the world (T, E), the
question (W and which functional of L is paired against), the computation (the Monte Carlo
scheme), or the presentation (post-processing of the converged estimate).

## 2. The decomposition — PINNED

Two top-level input objects (the specimen × experiment workflow is load-bearing: the
multi-renderer harness iterates strategies over a fixed scene). The strategy is internally
structured into three sections:

```
Scene                       defines (T, E) — the world, exactly. Materials (physical or
                            not), geometry, media, lights, environment. Nothing else.

Strategy
 ├─ measurement             defines the integral: camera + response + truncations.
 │                          Scene + measurement together define the number being computed.
 ├─ estimator               defines the computation: an unbiased sampling scheme for the
 │                          measurement. directLighting, light selection, RR, env chart,
 │                          volume sampling method, accumulation.
 └─ view                    defines the presentation: tonemap, exposure, film passes.
                            Touches only the converged linear HDR quantity.
```

**Scene + measurement = the integral. Estimator = the computation. View = the display.**

## 3. The dividing line: bias vs variance — PINNED

The measurement/estimator boundary is the bias/variance line:

- **Measurement fields carry all the bias.** Changing one changes what the render converges
  *to* — deterministically, structurally, independent of sample count.
- **Estimator fields carry all the variance.** Changing one changes only how fast and how
  noisily the render converges. The estimator section is bias-free **by contract**.

Classification question for any knob: *does it change the converged image (→ measurement),
or only the convergence path (→ estimator)?* The tag follows the math, never the intent —
a knob that "feels like" sampling machinery but changes the answer (firefly clamping) is a
measurement field.

**Canonical pair:** Russian roulette vs `maxBounces`. Both terminate paths. RR terminates
randomly *with compensation* — unbiased by construction → estimator. `maxBounces` terminates
deterministically *without* compensation — biased → measurement. Same mechanism, opposite
sides of the line, and the math decides unambiguously.

## 4. Truncations: measurements with a declared exact limit

There is no structural "approximation" section (an earlier four-section draft over-divided —
owner call). An approximated problem is just a different measurement: ⟨W, Σ_{n≤8} TⁿE⟩ is as
well-defined a functional as AO or the full series. What distinguishes a *truncation* from
any other measurement field is **documentation, not structure**: a truncation field carries
an annotation naming the exact limit in which it vanishes.

The truncation fields within `measurement` are therefore the render's **bias ledger** — one
place listing every way the image differs from ground truth, each with its named limit:

| Truncation | Exact limit |
|---|---|
| `maxBounces: N` | N → ∞ |
| `maxNullCrossings: K` (default 32): paths crossing at most K null interfaces, counted along the whole path including its shadow rays, so every technique drops the same paths | K → ∞ |
| `scattering: 'ignored'`: scattering media rendered absorbing-only | `'full'` |
| `shadows: 'opaque-dielectrics'`: shadow rays treat dielectric interfaces (and GRIN regions) as opaque | transparent/spectral shadow refinement |
| `color: 'rgb'`: RGB transport is a biased surrogate of spectral (projection does not commute with multiplication) | `'spectral'` (§8; reserved, Validator-rejected) |
| path-class restrictions (future: one-shot, Whitted-style delta-only continuation) | the unrestricted path space |
| firefly/radiance clamping (future) | clamp → ∞ |
| numerical tolerances — fixed constants, not fields: the marcher's acceptance (`march_epsilon`, including its grazing rule: a ray still within 16× the acceptance of a surface when its steps run out counts as a hit), GRIN's ODE step and exit bisection, SDF refinement counts, spawn margins | tolerances → 0 |

### 4.1 Budgets describe paths; step limits describe computation — PINNED

A program has two kinds of limit, and they belong to different sections.

- **Budgets** are truncations, and a truncation must be a **predicate on paths**: a fact about
  the path itself (how many scattering events it has, how many null interfaces it crosses, how
  far it travels inside a region), never about how the path was sampled or traced. Only then
  is the truncated measurement a well-defined integral over a set of paths that every
  estimator can agree on. A budget counted per path must also be counted the same way by
  every technique that completes a path (`maxNullCrossings` gives a shadow ray what its path
  has left, for this reason).
- **Step limits** bound loops inside the machinery: ODE integrator steps, null-collision
  tracking steps, SDF march steps, traversal stack depths. They are properties of the
  computation, so they belong to the estimator side, which is bias-free by contract. A step
  limit may never decide the picture: the bias it can introduce must be bounded, by a bound
  derived from the quantities the computation already has (the tracking loops: a Poisson
  quantile of σ̄ × the segment's length, delta_tracking.glsl `tracking_cap`, reached with
  probability below 1e-10 per segment). A small probability bounds the bias only when the
  weight a stopped walk would have carried is bounded; after roulette it is not (below). Where
  no such bound exists, the limit is a known defect listed below. Never a fixed number chosen to be "big enough": such a number
  decides the picture for the scene that exceeds it. A step limit is never charged against a
  budget: refining a step size must not change which paths are in the measurement.

Test for a proposed limit: *would the set of counted paths change if the integrator's step
size, the majorant, or the sampler changed?* If yes, it is a step limit, and declaring it as
a measurement field does not make it one.

Known step limits that can still decide the picture:
- the SDF marcher's step budget (`MAX_MARCH_STEPS` or a shape's `stepBudget`) when a ray runs
  out of steps FARTHER than the grazing rule's band from a surface — it reports a miss and
  leaves the rest of the shape's interval unexplored (a ray skimming just outside a surface for
  a long way, or crawling through a fractal);
- GRIN's hard stop (`GRIN_MAX_ROUNDS` = 200 rounds of 512 steps). The walker's roulette ends
  long traversals without bias, but a traversal that survives 199 draws carries weight 0.9⁻¹⁹⁹,
  so probability × weight means the stop drops exactly the contribution of traversals longer
  than 102,400 steps: roulette changes the cost of long walks, not what a fixed stop cuts off;
- the BVH traversal stacks (binary 64, wide 24): fixed sizes past which a walk drops subtrees;
  the builders warn when a tree is deep enough to reach them;
- the wide-BVH walk's fixed 65,536-iteration guard (`components/intersection/index.ts`),
  unchecked, where a bound derived from the node count exists.

## 5. The camera lives in measurement

The camera **is** W_j — the definition of which rays pixel j averages over. Moving it changes
the numbers; it is not part of the world and cannot be estimator (estimators must not change
the answer). Scene = the system under study; camera = the instrument pointed at it;
estimator = the numerical method.

**No workflow change follows.** Camera pose and fov are frame-bound (`Value<T>` → uniforms),
so the compiled program is a *family* of measurements parameterized at runtime; orbiting is
motion through measurement-space, not a recompile. Since July 2026 the pose is also
*authored* here (`CameraPose` on `measurement.camera`: `position`/`target`, the defaults of
the always-live `camera.position`/`camera.target` parameters) — closing the gap where
(scene, strategy) did not determine the converged image without loose parameter state. The general rule: a measurement field may
bind at frame time for workflow convenience — its section records what it *means*; its
binding time records when it takes *effect*. Only compile-bound fields are baked into the
artifact's identity.

## 6. Consequences (each was implicit before; now they are rules)

1. **Cross-strategy convergence has a definition:** fix scene + measurement, vary estimator,
   converged images must agree. The X-witnesses (§11.2) are instances; any future pair must
   hold the whole measurement section fixed or it is not a valid pair.
2. **Reset discipline is a theorem, not a convention.** An accumulation buffer estimates one
   integral. Measurement-field changes mid-accumulation mix samples of *different* integrals
   → reset **mandatory** (this is why orbiting resets). Estimator-field changes leave every
   sample unbiased for the *same* integral → reset **optional** (a cleanliness choice;
   `env.selectProb`'s `triggersReset: true` is conservative, not required).
3. **Live-tunability is derivable.** Estimator knobs are provably safe as runtime uniforms —
   they cannot change the answer. Measurement knobs may be live only with mandatory reset.
4. **Testing obligations attach to sections.** Measurement fields: a witness with a derived
   expected value (+ the named limit, for truncations). Estimator fields: membership in a
   cross-convergence pair. View fields: snapshots only. Every new field declares its section;
   the section *is* its test contract.

## 7. Field remapping (current schema → sections)

| Current | Section | Note |
|---|---|---|
| `camera.*` | measurement | frame-bound residuals; workflow unchanged |
| `transport.maxBounces` | measurement (truncation) | first citizen of the bias ledger |
| `measurement.maxNullCrossings` | measurement (truncation) | the null-crossing budget, formerly a fixed walk constant (32) plus a separate shadow-ray limit (8), which made pt-nee drop light pt counted |
| `transport.russianRoulette` | estimator | unbiased by construction |
| `estimator.russianRoulette.maxSurvival` | estimator | the survival CEILING (default 0.95). The taxonomy's own line made visible: a LOSSLESS path never dims (clear glass transmits at weight exactly 1), so survival pins at this ceiling and it becomes the only thing ending the path — lower it and paths shorten with NO bias (survivors are divided by the same probability), trading noise for time. Reaching for `maxBounces` instead buys the same speed by truncating uncompensated, which is measurement-side bias. Where the two sections differ in practice. |
| `transport.directLighting` | estimator | pt/nee/mis converge identically (X-witnesses) |
| `transport.lightSelection` | estimator | |
| `transport.envSampler`, `envCompensation` | estimator | chart choice cannot change the answer |
| `estimator.mediumLightSampling` | estimator | vertex vs equiangular placement — same segment integral, §11.2 haze pair enforces (impl-plan-equiangular) |
| `transport.volumeIntegrator` | **SPLIT — see §8** | mis-factored field found by this taxonomy |
| `accumulation.*` | estimator | |
| `display.*` | view | |
| (implicit §6.3 shadow policy) | measurement (truncation) | invisible bias → declared bias |

## 8. Finding: `volumeIntegrator` conflates the two sections

`'analytic'` vs (future) `'delta-tracking' | 'ratio-tracking'` is an estimator choice — same
answer, different sampling. But `'none'` on a scene with scattering media renders them
absorbing-only — that changes the integral: a truncation. One field with values on both
sides of the bias line. **Resolution (lands with the schema reshape):** a measurement
truncation flag (scattering ignored — named limit: the flag off) + a pure estimator axis
over the sampling methods. The Validator's reject-not-remove handling of the unbuilt methods
is unchanged.

## 9. Classic renderers, classified (the framework check)

- **One-shot / direct-lighting** = measurement ⟨W, E + TE⟩. Already expressible:
  `maxBounces: 1` + NEE. For delta lights the estimator is deterministic (zero variance).
- **Whitted** = a path-class restriction (delta-only continuation, diffuse terminates at
  direct light) — measurement-side; kills diffuse interreflection *by definition*, not badly.
- **Cartoon renderer** = factors across all three: toon response curves are scene-side
  (non-physical T — nothing in the interaction contract requires reciprocity or energy
  conservation); flat one-shot structure is measurement; outlines/posterization are view.
- **AO / normal view / §11.4 repair counter / §11.3 pdf histogram** = alternative
  measurements (different W, some non-radiometric) of the same scene. First-class, not hacks.
- **Out of scope by construction:** photon mapping, radiosity, ReSTIR-style reuse — anything
  where pixel j's estimate depends on cross-pixel/cross-frame state beyond accumulation.
  The framework's boundary (per-pixel independent MC estimates of path-class integrals)
  coincides with the project's declared non-goals — both follow from "one fragment shader
  per pixel."

## 10. The measurement/view boundary — PINNED (provisional wording)

Anything that shapes **what accumulates** is measurement; anything applied to the
**converged linear HDR quantity** is view. Exposure/tonemap: view. Pixel filtering and
(future) spectral→XYZ film integration: measurement. The existing "HDR export reads
pre-tonemap accumulation" behavior is this line, already drawn.

## 11. Migration — DONE (July 2026)

Landed with the **decision-hoist batch** (`impl-plan-decision-hoist.md` T1–T2, commits
c32a927/1d94c22): `RenderStrategy` carries the three sections; `ProgramDescription` mirrors
them and is the complete link map with its own structural snapshot; the §8 `volumeIntegrator`
split is implemented (`measurement.scattering` + `estimator.volumeSampling`); `shadows` and
`color` are declared truncation fields with `'spectral'` reserved-rejected. Generated GLSL
was asserted snapshot-identical at both steps. Contracts §7.3 carries the cross-reference
annotation.
