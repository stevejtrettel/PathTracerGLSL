# Implementation Plan — Environment as a Samplable Light

**Author:** Fable (July 2026)
**Status:** BUILT & GPU-verified (T1–T5). Real `.hdr` loading + procedural bake, CDF
importance sampling as a NEE/MIS light, the equirect/octahedral chart axis + MIS
compensation. Witnesses: sky, sky-lamp, proc-sky, furnace-sky.
**Supersedes:** `impl-plan-tabulated-env.md`. The `reference/world/environment/hdri*.glsl`
transcription sources were folded into `components/env/` + `environment.ts` (the two pitfall
fixes in §4 applied) and then DELETED (July 2026) — the built code is the record now.
**Prerequisite:** `impl-plan-audit-hardening.md` (built).

## 0. What the renderer survey established (pbrt-v3/v4, Mitsuba, Arnold)

- Our design — equirect table weighted by luminance·sinθ, marginal/conditional CDF, pdf with
  the 1/(2π²sinθ) Jacobian — **is pbrt-v3's** (`InfiniteAreaLight`, 3ed §12.6/§14.2.4).
- **MIS on the miss branch is universal.** No surveyed renderer skips it; an HDR sun makes
  BSDF-only misses explode and NEE-only misses lose sharp reflections. Reference §8 line (3)
  is the industry-standard shape.
- **Sample↔eval consistency is the classic trap.** Bilinear radiance lookup + piecewise-
  constant pdf is fine under MIS (pdf=0 directions get BSDF weight 1) but **biased under
  NEE-only**: bilinear L > 0 in a black texel's neighborhood is never sampled and gets miss
  weight 0 → energy lost. pbrt-v3's fix: build the importance table from a slightly blurred
  luminance so support covers the interpolation footprint (3ed §14.2.4). Mitsuba samples the
  linear interpolant exactly; pbrt-v4 moved to equal-area octahedral parameterization.
- **Env selection power is a commensurability hack everywhere**: Φ_env ≈ π·r_world²·(π·L̄)
  needs a scene bounding radius (pbrt/Mitsuba); Arnold *excludes* the dome from its global
  light sampling and handles it as a dedicated technique. Production keeps the env's
  selection weight user-overridable.
- Later upgrades, all behind our seams (deferred, §5): equal-area octahedral (kills the sinθ
  term and pole waste; pdf = mapPdf/4π), MIS compensation (pbrt-v4/Mitsuba-3: table from
  max(L−L̄,0) — sound only when BSDF sampling coexists), hierarchical warping (Mitsuba 3;
  pays off with stratified streams we don't use), portals.

## 1. Design decisions

**Committed** (reasoned from the contracts; say the word to overturn):

- **D1 — Representation: equirect + 2D CDF, unchanged.** Contracts §6.2 pins "the existing
  HDRI CDF machinery"; pitfall 11 pins "carry it intact"; the CPU builder
  (`build-environment-sampler.ts`) is already unit-tested and verbatim-compatible with the
  reference GLSL. Equal-area octahedral is a strict improvement pbrt-v4 validated, but it is
  an *internal representation swap* behind `environment_radiance/sample/pdf` — nothing
  upstream would notice. It goes in the deferred table, not in v1.
- **D2 — Consistency fixes on the transcription.** Three deviations from the reference
  files, each mandatory:
  1. *Rotation inverse bug:* the reference's `direction_to_equirect` and
     `equirect_to_direction` both ADD `u_envRotation` — they are not inverses, so sample↔pdf
     and sample↔radiance disagree whenever rotation ≠ 0. One mapping subtracts. Round-trip
     unit-tested (§3, W5).
  2. *Intensity normalization bug:* the reference GPU pdf multiplies texel radiance by
     `u_env_intensity` while the CPU `totalWeight` excludes it — the pdf integrates to 1
     only at intensity 1. Pin: **intensity appears in neither** (it cancels; the pdf is a
     shape, intensity scales radiance only).
  3. *Support coverage (pbrt-v3 §14.2.4):* radiance lookups stay bilinear (REPEAT/CLAMP
     wrap, seam-correct); the CDF is built from a one-texel-blurred (3×3 tent) luminance so
     pdf > 0 wherever bilinear L > 0. Without this, `pt-nee` is biased near black↔bright
     texel boundaries; with it, all three strategies are unbiased (MIS never needed it, NEE
     does).
- **D3 — Env joins NEE through `lighting_sample`, two-stage.** The baked compile-time CDF
  cannot absorb a light whose power is known only after texture load. Structure: draw 0
  first selects env with probability `u_envSelectProb` (a uniform, parameter path
  `env.selectProb`); otherwise `cdf_rescale` the remaining mass into the existing baked
  area-light CDF, whose baked selection pdfs are multiplied at runtime by
  `(1 − u_envSelectProb)`. `lighting_pdf` arms and the miss-MIS line use the *same* uniform —
  the byte-match invariant extends across the selection stage. This deviates from reference
  §8's letter (`ENV_SELECT_PDF` as a compile-time constant) while keeping its exact
  structure; the deviation is what makes load-time-known env power usable at all. Arnold's
  dome-as-dedicated-technique is the precedent for the two-stage shape.
- **D4 — LightSample conventions:** `distance = 1e20` (contracts §6.1), radiance without
  visibility, pdf in solid-angle measure = selection × per-light. Shadow rays need nothing
  new — the walkers already take a maxDist; the `− 2·EPSILON` back-off is vacuous at 1e20.
  `light_of` untouched (env is never hit; misses have no region).
- **D5 — Miss branch:** reference §5/§8 line (3) verbatim, with the uniform in place of the
  define: NEE-only `w = (prev_was_delta || !ENV_SAMPLABLE) ? 1 : 0`; MIS swaps the 0 for
  `power_heuristic(prev_bsdf_pdf, u_envSelectProb * environment_pdf(dir))`. `prev_was_delta`
  init true (camera misses show the sky at full weight). Media ordering is already correct:
  the segment weight multiplies throughput before the miss test, so an absorbing ambient
  extinguishes the env automatically (impl-plan-media M1.4; NaN guard per volumetric §4
  already satisfied by MAX_DIST).
- **D6 — `constant` becomes samplable opt-in.** `{ type: 'constant', sampleAsLight: true }`
  → uniform-sphere `environment_sample` (pdf 1/4π), no textures. Default **false** so every
  existing witness scene keeps its current estimator behavior. This is the cheap path to the
  miss-MIS bookkeeping witnesses before any texture machinery exists (build it first in T3).
- **D7 — Procedural = recipe for a table** (pinned framing): one-shot GPU bake pass at
  renderer load (fullscreen pass rendering the formula over an equirect grid → readPixels →
  the *same* CPU CDF builder), **frozen at render start** (tabulated-env lean, confirmed);
  miss radiance **direct-evals the formula** (sharp, resolution-free; tabulated-env lean,
  confirmed) while sample/pdf use the table. The table-vs-formula mismatch this creates is
  the same class as D2.3 and is covered by the same blur, at bake resolution.
- **D8 — Naming:** the type stays `'image' | 'procedural'` as written in
  `EnvironmentDescription`; contracts §2.10's `'hdri'` reads as `'image'`. Extern names as
  pinned: `extern:env_map`, `extern:env_cdf_cond`, `extern:env_cdf_marg`. GLSL uniforms are
  `u_camelCase` per CLAUDE.md (`u_envMap`, `u_envCdfCond`, `u_envCdfMarg`, `u_envSize`,
  `u_envTotalWeight`, `u_envRotation`, `u_envIntensity`, `u_envSelectProb`) — note the
  reference GLSL (snake_case) and the legacy engine binder (camelCase) never agreed; codegen
  settles it.
- **D9 — Validator:** a samplable environment satisfies the NEE-needs-lights check
  (`Validator.ts:38` predicate gains env awareness via a new `SceneFeatures.environment`
  entry from the Analyzer); every `extern:` in the planned pipeline must trace to a scene
  declaration (§2.10's compile-time half).
- **D10 — Rotation is a live uniform** (`env.rotation`, radians, triggersReset), applied in
  the mapping — the marginal CDF is rotation-invariant (rotation shifts columns only), so no
  rebuild. With the D2.1 sign fix this is safe; the reference never actually wired it.
- **D11 — The sampler is a swappable strategy axis, factored as chart × weight policy
  (owner-confirmed).** pbrt-v3 and pbrt-v4 env sampling are one system in two charts, not
  two systems: texel weight = radiance × texel solid angle, evaluated in equirect (dΩ ∝
  sinθ — the "sinθ weighting" is just this chart's Jacobian) or equal-area octahedral
  (dΩ constant = 4π/N², Clarberg 2008). Structure:
  - **Chart interface** (per-chart GLSL, ~3 tiny functions): `env_chart_uv(dir)`,
    `env_chart_dir(uv)`, `env_chart_dOmega(uv)`. Rotation lives in the chart.
  - **One table builder** (CPU, chart-parameterized): `w = Y(texel-center dir) · dΩ(texel)`
    → blur (D2.3) → optional compensation → the existing marginal/conditional CDF build.
  - **One sampler/pdf pair** (chart-generic GLSL): binary-search inversion in chart
    coordinates; **pdf from CDF differences** — `pdf(dir) = (Δcond · Δmarg) / dΩ(uv)`, two
    texel fetches. Never recompute the weight from the radiance texture (that is exactly
    how the reference's intensity bug happened, and blur/compensation would re-break it);
    reading the tables the sampler inverts makes sample↔pdf byte-match hold *by
    construction* for every weight policy, present and future.
  - **The radiance map stays equirect for ALL samplers** — `environment_radiance` is
    sampler-independent; only the importance table lives in chart space (built by
    evaluating the equirect source at chart texel centers). pbrt-v4 resamples the image
    itself (production economy); we deliberately don't: holding the integrand bit-identical
    across samplers is what makes the cross-sampler witness (W8) a controlled experiment.
  - **Strategy axis:** `transport.envSampler?: 'equirect' | 'octahedral'` (default
    `'equirect'`, the transcription-pinned v1) and `transport.envCompensation?: boolean`
    (default false; table from `max(w − w̄, 0)`, pbrt-v4/Karlík et al. 2019). Validator
    rule: `envCompensation` requires `directLighting: 'mis'` — compensated tables have
    legitimate pdf-0 directions with L > 0, unbiased only when BSDF sampling covers them.
  - Nothing upstream notices: selection (D3), the miss branch (D5), `lighting_sample`, and
    the externs all touch only the three env functions, whose signatures don't change;
    `u_envSize` already carries the differing table dimensions.

**Flagged for the owner** (my recommendation first, but these change behavior you'll see):

- **O1 — `u_envSelectProb` default policy.** The honest position: without scene bounds,
  Φ_env = π·r²·πL̄ is uncomputable, and any pseudo-power is a guess. Recommend: default
  **0.5** when both a samplable env and samplable finite lights exist (1 if env-only, 0 if
  none), overridable per scene via `environment.selectWeight`. The bounding-radius formula
  becomes the default later, when scene bounds exist for other reasons (many-lights BVH).
  Alternative: expose no default and require the scene to say it — stricter, more annoying.
- **O2 — Blur width for D2.3.** Recommend one texel (3×3 tent), the pbrt-v3 footprint
  argument. Zero blur is defensible if we accept "pt-nee excluded from env witnesses on
  high-contrast maps" — I don't recommend that; the X-ENV witness loses its teeth.
- **O3 — Importance-table resolution for procedural bakes.** Recommend 512×256 default with
  an `environment.tableSize` override (Arnold decouples table from texture resolution for
  exactly this knob; a hard sun needs table texels smaller than the disk).

## 2. Phases (T-numbering preserved from impl-plan-tabulated-env.md)

### T1 — The `extern:` chain, end to end (foundational; fixes audit F1 + F10, review #2/#8)

Four links, of which only the first exists today (`mergeContributions` dedupes textures):

1. **Compiler:** `Generator` consumes `merged.textures` → emits `uniform sampler2D`
   declarations (ShaderBuilder) and threads them into `pass.inputs.textures` as
   `{ u_envMap: 'extern:env_map', … }` (PipelineBuilder passes through verbatim — the locked
   pipeline types already fit, `inputs.textures` is `Record<string,string>`).
2. **Engine:** `ResourceManager.getTexture`/`RenderExecutor._bindTextures` resolve the
   reserved `extern:` prefix by lookup in the demoted `TextureRegistry` (now a dumb
   `name → WebGLTexture` store; fixed-unit reservation and bind-at-load deleted). Executor
   remains the sole unit authority: framebuffer refs and extern refs bind identically to
   sequential units per pass — this is what dissolves audit F10.
3. **Delete the legacy path:** `Engine.loadEnvironmentHDR`'s binding half,
   `_bindEnvironmentTexturesToRenderer`, the hardcoded uniform names, the unit-0 reservation
   parameter. The loader/CDF-builder halves survive (T2 consumes them). This dissolves
   audit F1.
4. **Failure semantics:** missing extern at bind = hard, *named* engine error (never a
   silent unit-0 sample). Compile side: the D9 validator check.

While here (cheap, sanctioned by the old plan): cache `getUniformLocation` per
(program, name); route the display shader's `u_radiance`/`u_resolution` through the declared-
resource path (bundle i-b) so template-owned uniforms disappear.

**Verification:** all existing scenes unchanged (snapshot + suite); a unit test that a
pipeline referencing an unregistered extern fails at bind with the named error; engine-audit
findings F1/F10 closed.

### T2 — `image` environment (visible sky, not yet a light)

- `contributeEnvironment('image')`: block = equirect radiance lookup (transcribed from
  `reference/world/environment/hdri.glsl` with the D2.1 rotation fix), textures = the three
  externs, uniforms = `u_envSize`/`u_envTotalWeight`/`u_envRotation`/`u_envIntensity` on
  `env.*` parameter paths.
- App/Engine wiring: an `image` scene triggers `HDREnvironmentLoader` (existing, reused) →
  registry entries under the extern names → sets the `env.*` params. Async by design; until
  load the extern is missing and the renderer must not bind (app defers first frame — the
  named-error semantics from T1 make a premature bind loud, not wrong).
- Miss branch unchanged: full-weight `environment_radiance` (env not samplable yet — pt-only
  correctness, like the old build's BSDF route).

**Verification:** an HDRI renders as background and lights the scene through BSDF paths
under `pt`; `tsc`/vitest; a snapshot case for the new codegen.

### T3 — Environment as a samplable light (the heart)

Order within the phase: constant-env first (no textures), then tabulated.

1. `ENV_SAMPLABLE` define (set by the environment feature when the env participates);
   Analyzer gains `SceneFeatures.environment`; Validator D9.
2. Constant-samplable (D6): uniform-sphere `environment_sample`/`environment_pdf`
   (pdf = 1/(4π)); the two-stage `lighting_sample` integration (D3) with `cdf_rescale` on
   the selection draw; the miss-branch bookkeeping (D5) in both NEE and MIS forms.
   **Witnesses W1/W2 run here**, before any texture code — they isolate the transport
   bookkeeping from the CDF machinery.
3. Tabulated `environment_sample`/`environment_pdf`: the D11 chart-generic machinery
   instantiated with the **equirect chart only** — transcribe `hdri-importance.glsl`'s
   binary search and mapping (sub-texel placement via the *conditional CDF inversion
   remainder* — not the reference's crossed `fract(xi·W)` reuse, which violates pitfall 4's
   no-reuse rule) with the D2 fixes, restructured around the chart interface and the
   pdf-from-CDF-differences rule. CPU builder gains the chart parameter and the D2.3 blur,
   drops nothing else (its tests already pin the CDF invariants; H6.4's pdf-sums-to-1 test
   pins the normalization).
4. Shadow rays: nothing new (D4) — but add the env case to the shadow-walker witness list
   since 1e20-distance rays exercise the walker's exhaustion budget differently.

**Verification:** W1–W6 (§3), the χ² sample↔pdf harness, cross-strategy convergence on a
high-contrast HDRI — the discriminating test for the whole CDF/Jacobian/MIS stack.

### T4 — `procedural` environment

- `contributeEnvironment('procedural')`: formula emitted as the `environment_radiance` body
  (direct eval, live uniforms; spectral discipline §2.5 applies to the formula); CDF externs
  declared exactly as `image`.
- Bake: one-shot GPU pass at renderer load rendering the formula to an equirect RGBA32F
  target at `tableSize` (O3) → readPixels → existing CDF builder → registry under the extern
  names. Freeze-at-render-start (D7): parameter edits to formula uniforms mark the table
  stale; production/reset rebakes.
- The bake pass is an ordinary `CompiledRenderer` pipeline pass the engine executes blindly
  (run-once semantics owned by the app, not a new engine concept).

**Verification:** W7 (image/procedural equality pair) — the same formula baked to an image
file and authored as `procedural` must converge to the same picture; χ² harness re-run on
the baked table.

### T5 — The second sampler: octahedral chart + compensation toggle (the research payoff)

Deliberately AFTER T3's witnesses pass — one sampler validated end-to-end keeps a later W8
failure unambiguous (it implicates the new chart, not the shared machinery).

- Octahedral chart: the Clarberg 2008 equal-area square↔sphere mapping as a second chart
  block (~40 lines GLSL, both directions + constant `dOmega = 4π/N²`); the chart-
  parameterized builder evaluates the equirect radiance source at octahedral texel centers.
  Strategy axis `envSampler: 'octahedral'` selects the block at codegen, exactly as
  `hasMedia` selects shadow walkers.
- Compensation toggle: `envCompensation: true` subtracts the mean weight before the CDF
  build (per D11), valid for either chart; the D11 validator rule lands with it.
- No new engine or selection work — T1/D3/D5 are sampler-blind by construction.

**Verification:** W8 (X-CHART cross-sampler convergence), χ² harness per chart, W9
(compensation variance measurement on the sun-disk scene) — this phase is where the tracer
starts producing *comparative results*, which is the point of the axis.

## 3. Witness suite (fable-validation-scenes style; all derivable, none exist yet)

| ID | Scene | Expected | Catches |
|---|---|---|---|
| W1 | Open furnace: ρ=0.4 sphere under constant samplable env L=1, all three strategies | `L/(1−ρ) = 5/3` per channel on the sphere, exactly | miss-weight bookkeeping, double-count/drop |
| W2 | Same, `sampleAsLight: false` | identical image (estimator route irrelevant) | D6 flag plumbing |
| W3 | X-ENV: high-contrast HDRI (small sun), pt vs pt-nee vs pt-mis, §11.2 protocol | 3-way convergence < 1.5 % RMSE | CDF build, Jacobian, selection pdf, D2 fixes — the load-bearing witness |
| W4 | Sun-disk analytic: synthetic map = radiance L on a disk of solid angle Ω, black elsewhere; unshadowed plane | direct irradiance = L·Ω·cosθ analytic | sinθ weighting, blur bias bound (measures O2's cost) |
| W5 | Rotation round-trip (unit test + image): rotate map by δ, rotate expected image by δ | pixel-identical modulo sampling noise; `uv → dir → uv` identity in vitest | D2.1 |
| W6 | Beer–Lambert sky: bounded absorbing slab in front of constant env | `L·e^(−σ_a·d)` per channel | env × media ordering |
| W7 | Procedural ≡ image equality pair (same gradient-sky formula both routes) | 3-way × 2-route convergence | T4 bake path |
| W8 | X-CHART: same HDRI scene, `envSampler` equirect vs octahedral under pt-mis | convergence < 1.5 % RMSE (integrand bit-identical by D11 — any divergence is the chart's) | octahedral mapping, Jacobian, chart-generic pdf |
| W9 | Sun-disk (W4 scene) with `envCompensation` on vs off under pt-mis | same converged image; measured variance ratio reported (the pbrt-v4 claim, quantified on our scenes) | compensation correctness + its payoff |

## 4. Pitfalls (carried from the area-lights checklist + the reference mining + the survey)

1. **Rotation sign** — the reference's mappings are not inverses (both add). Fix + W5.
2. **Intensity in pdf but not totalWeight** — reference bug; intensity in neither (D2.2).
3. **`environment_pdf` must byte-match `environment_sample`** incl. the sinθ Jacobian and
   the blurred table (area-lights pitfall 11) — both read the same CDF textures and the same
   `u_envTotalWeight`; no re-derivation on either side.
4. **Never reuse the selection random** — `cdf_rescale` at the env/finite stage AND proper
   inversion remainders inside the 2D table (the reference's crossed `fract` reuse is the
   one part of the transcription to *not* carry).
5. **Invalid sample ⇒ pdf = 0**, never (pdf = 1, radiance = 0) — poison for MIS.
6. **pdf = 0 with L > 0 is legitimate under MIS** (weight-1-for-BSDF, not a bug) but bias
   under NEE-only — that asymmetry is exactly why D2.3 exists; if MIS compensation ever
   lands it must be gated per strategy (a compensated table under pt-nee is biased).
7. **Uniform-name schism** — reference GLSL snake_case vs legacy binder camelCase never
   matched; codegen owns the names now (D8).
8. **R32F CDFs stay NEAREST + texelFetch** (LINEAR on R32F without the float-linear
   extension makes the texture incomplete → silent zeros on some devices; interpolated CDFs
   also bias inversion). Env map: REPEAT in u (seam), CLAMP in v (poles).
9. **Async load** — extern missing at bind is a named error; the app defers, never renders
   a half-bound frame.
10. **Context loss** — env textures are not rebuilt on restore (documented); acceptable for
    v1, note in the extern registry docs.
11. **C3's ghost** — the old hardcoded sky disguised marcher false-misses as sky-colored GI;
    a bright HDRI re-amplifies any residual false-miss rate. If W3 converges but the image
    has sky-colored edge speckle, suspect the marcher, not the env.
12. **Reference code gets its own adversarial pass** (area-lights pitfall 15) — the mining
    already found two real bugs in "known-good" code; assume more until W3/χ² pass.

## 5. Deferred (explicitly not v1)

| Item | Trigger |
|---|---|
| ~~Equal-area octahedral~~ / ~~MIS compensation~~ | **promoted to T5** (D11 strategy axis) — no longer deferred |
| Hierarchical warping (Mitsuba 3) | if/when stratified or QMC sample streams land (contracts §10.2); slots in as a third inversion backend behind the D11 seams |
| Portal sampling (pbrt-v4 / Arnold portal mode) | interior scenes with windows become a real use case |
| Sun–sky decomposition, analytic solar disk (Hošek–Wilkie) | procedural sky family growth; the area-light machinery already supports the two-light split |
| Bounding-radius-based `selectProb` default (pbrt Φ convention) | scene bounds exist (many-lights BVH era) |
| Live (non-reset) rotation via `Value<T>` | the deferred `Value<T>` light-params item (area-lights table) |
| `Radiance`/`Direction` typedef sweep on env signatures | the impl-plan-item6 hygiene pass |

## 6. Ordering

T1 → T2 → T3 → T4 → T5, each independently committable. Two deliberate isolation moves in
the ordering: T3 builds constant-samplable before tabulated (transport bookkeeping witnesses
W1/W2 pass before any CDF machinery exists, so a W3 failure implicates only the table
stack), and T5's second chart lands only after T3's witnesses pass (so a W8 failure
implicates only the new chart, not the shared machinery). T4 and T5 are independent of each
other and can swap if a second sampler is wanted before procedural skies. GGX (reference §7,
transcription-ready) is the natural next build after this — env + area lights give its
highlights something to reflect, and per the modular-first principle it should arrive the
same way: the microfacet-distribution seam first, GGX as its first occupant.
