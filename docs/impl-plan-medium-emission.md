# Medium emission — implementation plan (E0 → E2)

**Author:** Fable (July 17 2026, evening session) · **Status: BUILT (same session) —
GPU-UNSWEPT.**
**Build record:** E0+E1+E2 landed; tsc clean; **965 vitest** (extended het glslang sink:
ε expression + closed-form ember + auto-derived-majorant glowmist; four new witness
scenes in the compile/snapshot suites); **byte gate verified DIRECTLY** (git-stash
round-trip: the pre-emission slab shader is byte-identical; link-map churn = the
additive `emission:false` field only); emitted GLSL reviewed via `dump:shaders`
(vec3-weighted ε splice, the P2 `m.emission *= sigma_scale` line, the folded-zero
accessor, both collection lines, the walk's gated radiance line). The two track-length
derivations are written below (VERIFIED-IN-IMPL). Witness gates are pre-calibration —
**the owner runs `npm run witness`** (new: emit, emit-swap, emit-sat, emit-scatter).
Demo: **glowblobs** (warm/cool vec3-weighted ε on the fogblobs Gaussians, glow.heat
slider, blob.sharp SHARED between the density and glow expressions).
**Authority context:** `fable-volumetric-component.md` (the seams + the §3 RTE
partition rule whose `MediumSample.radiance` field was reserved for exactly this),
`fable-heterogeneous-media.md` as amended (the null-collision arms this fills),
B2's one-radiometric-word convention (`lights/README.md`, geometry-materials target).
The tally/mis batch is DEFERRED (owner, this session) — emission does not depend on it.

The shape of the batch: one authored field, one Analyzer fact, one link-map decision,
one field in the generated lookup, one line in the walk, one accumulation line in each
jump-and-peek loop, one closed form in the analytic absorbing arm. No new seams, no
struct changes (`MediumSample.radiance` already exists), no walk restructure.

## Pinned decisions (owner, July 17 2026)

### P1 — The number is ε, the volume emission coefficient (B2's dimensional ladder)

`emission` on a medium is authored in **W·sr⁻¹·m⁻³**: radiance added per unit path
length, `dL/ds = ε(x)`. This completes the B2 pattern — the radiometric density per
steradian with respect to the source's natural measure:

| Source | Measure | `emission` means | Estimator applies |
|---|---|---|---|
| delta light | — (0-dim) | radiant intensity, W·sr⁻¹ | `/d²` |
| surface / area light | per area | radiance Le, W·sr⁻¹·m⁻² | direct (measure in the pdf) |
| **medium** | **per volume** | **ε, W·sr⁻¹·m⁻³** | **per unit length** |

Consequences (all deliberate):
- **Glow decouples from absorption.** σ_a = 0 with ε > 0 is legal (pure luminous
  gas). The blackbody/Kirchhoff coupling is authoring sugar: write `ε = σ_a·Le`
  in your own formula if you want it.
- **Saturation is the source function**: deep uniform glow converges to ε/σ_t per
  channel (the F-EMIT-SAT number). The author's number is a density, not a pixel
  value — same trade the delta-light intensity convention makes.
- pbrt authors Le and collects σ_a·Le; their σ_a·Le **is** our ε. Transcriptions
  below substitute the authored ε where pbrt writes `sigma_a * Le` — a declared
  notational mapping, not a modified estimator.

### P2 — The D1 scale applies to ε (source-function preservation)

Where the ceiling flattens a too-dense region, ε scales by the SAME proportional
factor as σ_a/σ_s. Rationale (owner-pinned): D1's scale was chosen to preserve the
albedo σ_s/σ_t; scaling ε identically preserves the source function ε/σ_t. "A
clamped region is the same medium, just thinner" then holds for glow — every
per-volume density scales together, every ratio survives. (The alternative —
clamping σ but not ε — makes flattened regions BRIGHTEN at saturation: an artifact.)

### P3 — Collection is per-tentative-collision (pbrt's shape), not lottery-branch

In the null-collision loops, emission accumulates at EVERY tentative collision,
before the lottery: with a scalar majorant, pbrt's
`pdf = sigma_maj[0]·T_maj[0]; L += beta·T_maj·(σ_a Le)/pdf` collapses exactly
(T_maj achromatic ⇒ T_maj/pdf = 1/σ̄) to

```
ms.radiance += w_run ⊙ ε(x) / σ̄        // at each tentative collision, pre-lottery
```

This works identically in BOTH loops (delta arm and ratio pass-through), so the
routing special-case from the earlier sketch is gone. The absorption branch stays a
pure terminator (its deviation-1 comment updates: emission lives at the accumulation
line now, not in the branch). The sampling handle is the majorant process — which is
why σ̄ also paces emission (Validator note below).

**VERIFIED-IN-IMPL (E1, both derivations; gated by EMIT-SWAP and F-EMIT-SAT):**

*Derivation 1 (delta arm).* Tentative collisions are a Poisson process of rate σ̄
along the segment; the tracker's weight before collision i is w_i = Π_{j<i}
σ_n(x_j)/(σ̄·P_n,j) over the prior NULL outcomes, and by the Kutz weight identity
(Eq. 15–16, w_⋆ = μ_⋆/(σ̄·P_⋆)) the expected per-collision continuation factor is
E[lottery] = P_n·(σ_n/(σ̄·P_n)) + (terminal outcomes contribute no continuation)
= σ_n/σ̄ — independent of the probability scheme, history-aware or not. So the
expected weighted collision density at depth s is, by the Poisson product identity
E[Π_i f(x_i)] = exp(σ̄∫(f−1)):

  σ̄ · E[Π_{prior} σ_n/σ̄] = σ̄ · exp(σ̄ ∫₀ˢ (σ_n/σ̄ − 1)) = σ̄ · exp(−∫₀ˢ σ_t) = σ̄·T(s)

and each visited collision contributes ε(s)/σ̄, giving E[Σᵢ wᵢ·ε(xᵢ)/σ̄] =
∫ T(s)·ε(s) ds — the RTE source term, exactly. Collection is PRE-lottery, so the
final (real) collision collects with its pre-lottery weight, as the derivation
requires (every VISITED collision counts once).

*Derivation 2 (ratio pass-through arm).* Same Poisson process; the chain never
terminates and every collision multiplies (σ̄−σ_a)/σ̄. With T_i the PRE-update
product, the same identity gives expected weighted density σ̄·exp(−∫σ_a) = σ̄·T_a(s)
⇒ E[Σᵢ Tᵢ·ε(xᵢ)/σ̄] = ∫ T_a·ε ds. (σ_a only: this arm serves absorbing-only media
— including scattering media under the `scattering:'ignored'` truncation, where
attenuating and collecting against σ_a alone IS the declared measurement.)

Both gates confirmed the algebra structurally (EMIT-SWAP twin + absolute numbers;
F-EMIT-SAT's ε/σ_a through the delta arm) — GPU confirmation rides the owner's sweep.

### P4 — Path-found glow only (no volume NEE)

Emissive media illuminate what paths touch: chance hits, phase-scattered
neighborhoods, multiple scattering spreading the glow. Sampling a glowing VOLUME as
a light source for distant surfaces (the volumetric analog of sampleAsLight) is a
real separate technique — deferred ledger. Same status as emissive SDF surfaces.

### P5 — Emissive media route by the extended heterogeneity predicate

`isHeterogeneousMedium` extends to: expression on σ_a, σ_s, **or emission**. Any
expression field routes the medium to the tracking arms (an expression ε under
constant σ still needs per-position evaluation at sampled points). Constant-ε media:
absorbing-only stays analytic (closed form below); **scattering + constant ε routes
to the tracking arms with an auto-derived majorant** (σ̄ = max-channel constant σ_t
— derivable at plan time, no authoring burden) rather than deriving a modified
channel-MIS emission form. Existing scenes have no emissive media — the byte gate
is untouched by construction.

## E0 — input language + rules (gate: tsc + vitest)

1. **`MediumDescription.emission?: SpectrumProperty`** (`compiler/types.ts`) —
   constant / `{param}` / expression-with-params; scalar broadcasts (achromatic),
   exactly like σ_s. `PlannedMedium.emission` + `resolveMedium` carry it.
2. **Analyzer**: `media.hasEmissiveMedia` (`mayBeNonzero(medium.emission)`), beside
   the existing census.
3. **Link map**: `MediaDesc.emission: boolean` — the decision gating the lookup
   field, the walk's radiance line, and the arms' accumulation lines (exact linkage:
   none of it exists in programs without emissive media).
4. **Validator**:
   - expression on `emission` joins rule 1 (requires `majorant`) via the extended
     predicate; the rule-2 inert-majorant warn updates its condition (a majorant on
     a constant-σ medium with expression ε is NOT inert — it paces emission).
   - emissive tracking-routed media: majorant > 0 already enforced; add the doc
     note that σ̄ is also the emission sampling rate (a σ̄ far above σ_t means
     finer emission sampling — cost, never bias).
   - emissive scattering media under `mis`: already rejected through the existing
     delta-tracking×mis rule (they route to tracking arms). No new rule; the tally
     batch's ledger gains the r_e note.
   - `measurement.scattering: 'ignored'` does NOT suppress emission (it is not
     scattering) — note in the rule comment, no code.
5. Kitchen-sink: the het glslang sink gains an ε expression on one medium and a
   constant-ε absorbing medium (both new arms compile forever).

## E1 — codegen + arms (gate: glslang + snapshots byte-identical for existing scenes)

1. **Lookup** (`generateMediumProperties`): `MediumProperties.emission` field emitted
   iff `media.emission`; per-medium assignment through the same `mediumPropertyExpr`
   splice (Spectrum wrap + zero floor); **the D1 scale multiplies ε too** (P2) in
   heterogeneous branches — one added line inside the existing clamp block.
2. **Delta arm** (`delta_tracking.glsl`): the accumulation line after the fetch,
   before the lottery (P3). Header deviations table row 1 updates (the branch is a
   terminator; emission collected per-collision).
3. **Ratio pass-through arm**: same line, T_run-weighted, before the null update.
4. **Seam-2 transmittance arm: NO emission** (shadow rays carry transmittance only)
   — comment stating so.
5. **Analytic absorbing arm** (`generateMediumSample`'s deterministic branch):
   `ms.radiance = ε ⊙ (1 − e^{−σ_a t}) / σ_a` with the σ_a→0 limit `ε·t`
   (per-channel; guard the divide — `mix` on a near-zero test or the expm1-style
   stable form; ANGLE-safe scalars only).
6. **Walk** (`pt.ts`): `s.radiance += s.throughput * ms.radiance;` immediately
   BEFORE `s.throughput *= ms.weight` (the partition rule: inline source terms are
   weighted relative to segment-start throughput), emitted iff `media.emission`.
7. Static-file discipline check: the arms touch only `ms.radiance` (already core to
   the seam's return type) and read `m.emission` — a generated-struct field behind
   the decision, consistent with the "every program-dependent field behind a
   generated function/struct" rule (the struct IS generated per-program).

## E2 — witnesses (owner runs the sweep)

| Witness | What it proves | Check |
|---|---|---|
| **F-EMIT** | constant emissive absorbing slab (analytic arm): center pixel = ε/σ_a·(1−e^{−σ_a·1}) + e^{−σ_a·1}·L_back — derive exact per-channel numbers in the fixture comment (chromatic ε, gray σ_a) | mean |
| **F-EMIT-SAT** | deep uniform glowing medium (optical depth ≫ 1): pixel = ε/σ_t exactly per channel — the source-function saturation invariant | mean |
| **EMIT-SWAP** | the SAME constant glowing medium authored as expression ε (+majorant → tracking arm, per-collision collection) vs plain numbers (analytic closed form) — the F-HET-CONST discipline applied to emission; gates the P3 derivations | twin |
| **EMIT-SCATTER** | glowing scattering fog: pt ≡ pt-nee convergence (emission + scattering + NEE compose; NEE never double-counts glow since volumes are never light-sampled, P4) | equality (rmse tripwire for the pt arm) |

Demo (post-sweep, churnable): **glowing blobs** — the fogblobs Gaussians with a
colored ε formula + a `glow.heat` slider; possibly emission-only (σ_s = 0) nebula
variant.

Then STOP.

## Deferred ledger (this batch's additions)

| Item | Note |
|---|---|
| Volume light sampling | NEE toward emissive media (the volumetric sampleAsLight): importance-sample ε over the volume + equiangular-style placement. The real "nebula lights the room" technique. |
| Emission under mis for tracking-routed media | Rides the deferred tally batch (pbrt's r_e rescaled probability — one more tally of the same shape). Constant absorbing-only emissive media work under mis TODAY (analytic, deterministic, no interaction). |
| Emissive scattering closed form | A derived channel-MIS emission term for constant scattering media would avoid their tracking-arm routing (P5) — a variance/perf nicety, needs a real derivation; the auto-derived-majorant routing is exact meanwhile. |
| Temperature→ε sugar | Blackbody authoring (`temperature:` → spectral ε via Planck) — authoring-layer; interests the spectral axis. |

## What this batch must NOT do

No walk restructure beyond the one gated line; no MediumSample struct change (the
field exists); no NEE machinery for volumes; no tally fields; existing scenes
byte-identical (no emissive media exist in any current fixture — enforced by the
snapshot gate); the sweep is owner-run.
