# Photorealism batch: integration of eight plans

Date 2026-11-06. Inputs: the plan and review in each of `conductor/`, `energy-compensation/`,
`coated/`, `image-textures/`, `normal-mapping/`, `procedural-textures/`, `camera-film/`,
`small-materials/` (all in this folder). `measured-spectra/` is a download report, not a plan.
Every review's verdict was "approve with changes". This document assumes each plan has taken
its review's must-fix items, and lists only the problems that come from combining the plans.

Labels: [checked-code file:line] = read by me in the repo; [plan X] / [review X] = stated in
that document (I did not re-check it); [reasoning] = argued, not checked.

---

## 1. Conflicts between plans

### 1.1 Changes to locked or pinned contracts (owner approval needed)

| Contract | Plan(s) | Change | In the recommended order? |
|---|---|---|---|
| `Hit` struct (trace-loop contract; earlier `Hit` edits were each owner-approved [checked-code docs/trace-loop-contract.md:43-45]) | normal-mapping Stage B | `tangent` + `bitangent_sign`, written at every hit-fill site | **No.** Deferred (§4) |
| `Hit` struct | procedural Part B (the alternative the review raises, F5) | an object-local point | **No.** Deferred |
| Compiler↔engine (LOCKED) | image-textures | the engine gains a 2D-array texture and `TextureRegistry.register(name, tex, target)`. Pass inputs stay names. The contract doc never mentions the registry [checked-code grep of docs/compiler-engine-contract.md], so this is probably an engine API change, not a locked-type change. **The owner should confirm.** | Yes, step 9 |
| Strategy taxonomy (owner-pinned) | energy-compensation, camera-film A | two new measurement fields: `measurement.microfacet` and `measurement.pixel`. Each is a new bias-ledger or kernel entry | Yes, steps 2 and 7 |
| Spectrum-kind contract (`color/spectra/README`) and CLAUDE.md's "the spectral model adds only reflectance ≤ 1 and the media ceilings" | conductor | new role `optical`; new kind `measured`; RGB η/κ triples become an error in spectral programs (a third spectral limitation); a kind's `glsl` becomes a function of the values in use [review conductor must-fix 1, 8] | Yes, step 12 |
| Decision D4, "GLSL never recomputes a pure function of its own rows" [checked-code src/components/descriptors.ts:84-91] | image-textures Step 0 (and, implicitly, procedural textures) | α = max(1e-3, r²) is computed per hit in GLSL | Yes, step 6 |

Scene-schema additions that are not locked but are new author vocabulary: `scene.textures`, the
row value `{ texture }`, and the material meta-key `bump`.

### 1.2 Conflicts between the plans themselves

1. **Derived rows: three plans pull in different directions.**
   - image-textures Step 0 replaces the host `fn` with a GLSL form.
   - The coated review instead proposes a Validator rule: a row that feeds a derived field
     takes only a constant or `{param}`.
   - The plastic plan's `coat_fdr` *needs* the host form. It is a quadrature that cannot run
     per hit.
   - The procedural demo writes an expression roughness, and today that throws
     `cannot format non-finite number: NaN` [review image-textures; review coated must-fix 2].

   **Resolution:** `MaterialDerivedSpec` keeps both variants. `{ fn }` runs on the host and its
   inputs must be constant or `{param}`, which the Validator enforces (step 1 fixes the crash).
   `{ glsl }` is evaluated per hit and emitted from the struct field (step 6). ggx α,
   rough_dielectric α, rough_conductor α and sheen's `sheen_r` use `{ glsl }`. Plastic's
   `coat_fdr` uses `{ fn }`.
2. **Same row name with two types: `eta`.**
   - conductor declares `eta: Spectrum` (role `optical`).
   - The small-materials review renames thin_dielectric's index to `eta: float`.
   - `unionFields` **throws** on one name with two `glslType`s [checked-code
     src/compiler/generate/schema.ts:55-68]. Its comment says the Validator catches this first,
     but I found no such Validator rule [checked-code grep of src/compiler/analyze for
     `glslType`]. So a scene with gold and a window pane would crash the compiler.
   - **Resolution:** a registry contract test that every row name has one `glslType` across all
     models. Thin glass takes another name (owner question Q6).
3. **The `usesMicrofacet` flag: energy compensation against sheen.**
   - The energy review merges `usesMicrofacet` and `energyCompensation` into
     `microfacet?: { energy: 'conductor' | 'dielectric' }`. Then the type forces every
     microfacet model to declare a gain.
   - sheen declares `usesMicrofacet: true` only for the frame maps [plan small-materials Q5(a)],
     and has no gain.
   - **Resolution:** `microfacet?: { energy: 'conductor' | 'dielectric' | 'none' }`. sheen
     declares `'none'`, a stated fact rather than a missing one.
4. **The GGX lobe is edited by two plans.**
   - The energy plan multiplies the gain into `ggx.glsl` eval (:24) and sample (:44).
   - The conductor review requires extracting the F-free lobe into `microfacet.glsl` first, so
     that `ggx` and `rough_conductor` differ only in F.
   - **Resolution:** the gain stays in each model's wrapper, because F_avg is model-specific.
     The extraction (step 11) and the gain (step 7) touch different lines. Each is gated by
     `frames compare`.
5. **The conductor's F_avg under energy compensation.**
   - The energy plan leaves this to the conductor plan. It suggests an 8-point Gauss–Legendre
     F_avg, accurate to 4e-6 [plan energy §3].
   - In spectral programs, η and κ are per lane, so F_avg cannot be a host-derived value. It
     costs 8 Fresnel evaluations per lane per hit [reasoning].
   - The conductor plan must state this cost, or make compensated rough conductors wait.
     Recommendation: build rough_conductor single-scattering first, and add its gain in a
     follow-up commit.
6. **Two measurement fields edit the same four sites**: `MeasurementDescription`,
   `ProgramDescription.measurement`, `resolveMeasurement`, and the Validator enums. One stamping
   rule must cover both. Camera Q6 says "always record". The energy plan records through
   `resolveMeasurement`, which in effect also always records. Use one rule: always record.
   Expect a snapshot and stamp change in each of the two commits.
7. **Texture units.**
   - Today's measured maximum is 8 samplers in any suite program [plan image-textures §1,
     count-samplers.ts].
   - Energy compensation adds one `sampler2D` (RGBA32F). Image textures add one
     `sampler2DArray`, which gives a measured maximum of 10.
   - The worst case the code can produce is 16 + 2 = 18 > 16 [plan image-textures; review
     energy].
   - The budget error at Generator.ts:44-49 is itemized [checked-code src/compiler/generate/Generator.ts:36-49].
     Its regex counts only `u?sampler2D` and must learn `sampler2DArray` in the image-textures
     commit, not later.
   - No plan needs more than one unit. Nothing to resolve beyond saying so in both plans.
8. **Two routes for "a material value that varies over the surface".**
   - Procedural noise runs through GLSL-expression rows.
   - image-textures adds a `{ texture }` value form, and its review says to lower that form to
     the same `GlslExpression` binding right after its shape check.
   - Bump `height` is also an expression.
   - **Resolution:** one route. Every spatial value becomes a `GlslExpression` before Validate,
     and Perlin's include gate keys on "the program has a material-expression row or a bump
     height". That is the coarse existing notion (`materialReadsUv`, dataTenants.ts:51-56)
     [plan procedural §3.1]. Leave media expressions out [review procedural S4].
9. **Ownership of the sphere chart.**
   - image-textures must settle the sphere uv orientation, since pbrt's is rotated 180°
     [review image-textures must-fix 1].
   - normal-mapping Stage B's `sphere_tangent` must agree with whichever chart is chosen.
   - `checker` reads the same chart.
   - One decision, owner question Q4.

---

## 2. Shared prerequisites, each built once

| # | Prerequisite | Used by | Built in step |
|---|---|---|---|
| S1 | Derived rows: the `{ fn }` / `{ glsl }` split (§1.2.1) | images (roughness maps), procedural roughness, energy comp (reads α), sheen, rough_conductor, plastic | 1 (Validator rule), 6 (GLSL form) |
| S2 | Microfacet core: the F-free GGX reflection lobe in `glsl/core/microfacet.glsl`, plus the one descriptor fact `microfacet?: { energy }` | ggx, rough_dielectric, rough_conductor, sheen (frame maps), energy comp, later rough_plastic | 7 (the fact), 11 (the lobe) |
| S3 | Built-in table assets: binary file + `data.ts` (sha256) + `BUILTIN_ASSETS` + `extern:` id, uploaded by the App with a hash check [plan energy §3, citing src/components/color/spectral/assets.ts as the precedent; review energy re-checked BuiltinAssets.ts:9-30] | energy table (512 KiB); later rough_plastic t(μ) tables | 7 |
| S4 | Spatial values are expressions (§1.2.8): one lowering pass, and one include gate for `perlin.glsl` | procedural, image textures, bump | 4 (gate), 9 (lowering) |
| S5 | Measurement-field plumbing, with one stamping rule (§1.2.6) | `pixel`, `microfacet` | 2, 7 |
| S6 | Registry test: every row name has one `glslType` across models (§1.2.2) | every new occupant | 1 |
| S7 | Witness fixture "orthographic quad at a known incidence under a unit sky". Each review independently asked for this geometry: sheen fuzz-alone, conductor at 70°, the image-texture quad [reasoning: one helper in `tests/witnesses/scenes/`] | sheen, conductor, images | 5 |
| S8 | Tangent field `dpdu` on `Hit` (contract edit), and uv chart conventions | normal maps Stage B, anisotropic GGX | **deferred** (one later plan) |

The measured metal tables (conductor) do **not** use S3. They are about 1,100 floats emitted
as const arrays, generated from one `data.ts` [plan conductor C1]. The energy table is 512 KiB,
which is too large for shader text. These are two routes for two sizes. State this in both
plans so nobody merges them by reflex.

---

## 3. Build order

Ordered by photographic impact per line, each step its own commit and independently revertible.
"Digest" means `npm run digest -- .digest/<step>-before.json` before the step, the same with
`-after` after it, then `npm run digest -- --compare <before> <after>`. Witness runs are targeted
(`caffeinate -i npm run witness -- <ids>`) and never the full sweep. Every step also runs
`npx tsc --noEmit && npx vitest run`.

| Step | What | Why here | Verification (besides tsc + vitest) |
|---|---|---|---|
| 1 | **Bug fixes and guards** (S1 part 1, S6): a Validator rule that host-derived inputs must be constant or `{param}`, which fixes the NaN throw; and the one-type-per-row-name registry test | It fixes a crash that exists today, and is tiny | digest: **zero** differing scenes; the new diagnostic snapshot |
| 2 | **Camera D + A (Gaussian only)**: `thinLensFromPhoto`, and `measurement.pixel: 'box' \| 'gaussian'` | Real-lens depth of field and the soft photographic edge, in about 80 lines of source | digest: shader text identical, stamps gain `pixel`; new `filter-edge` (with the review's column fixes); smoke checks `furnace`, `spectral-furnace`, `cornell-area` (tiled) |
| 3 | **`plastic`** (smooth coat over Lambert) | Glossy plastic, glaze, lacquer and varnish are the largest material gap. No compiler change | digest **zero**; new `plastic-furnace` (center and whole frame = 1.0), `plastic-chroma`, `spectral-plastic`; `furnace-sky` as a harness check |
| 4 | **Perlin library** (procedural Part A, world `p`, material rows and bump heights only) | Stone, marble and wood albedo on SDFs and fractals: the "math scenes" goal | digest: only expression scenes gain the perlin block; `perlin.test.ts` against golden values from compiled `ref/noise.cpp`; new probe `npm run witness:textures` (part a); `expr-const`, `expr-const-ref`, `spectral-expressions` |
| 5 | **Bump Stage A** (procedural height in `p`, step required) | Surface relief on every surface, including fractals. With step 4, this is most of the "real object" look | digest **zero**; new `bump-tilt` (with the black occluder under the plane) and `bump-sides` (with light 2 moved, value ρ) |
| 6 | **Derived rows in GLSL** (S1 part 2, D4 reversal) | Unlocks roughness variation (procedural now, maps in step 9) | digest: only ggx and rough_dielectric scenes change (the arm text, and `u_alpha_*` removed); `veach-mis`, `rough-mis`, `rough-smooth-limit`, `rough-furnace` |
| 7 | **Energy compensation** (`measurement.microfacet`, default `single-scattering`; the S2 fact; the S3 asset; roughness rows constrained to [0, 1]) | Rough metal and rough glass stop losing up to ~70% of their energy (E = 0.307 at roughness 1) | `npm run frames -- record` before, with the `veach-mis` and `rough-mis` cases added, and `compare` after: **bit-identical**; new `ms-furnace` under pt, pt-nee and pt-mis (plus one sphere at ior 1.33 or 2.4, and a control with no neighbors); `rough-furnace`, `veach-mis`, `rough-mis`, `spectral-materials` |
| 8 | **`thin_dielectric`** (with the media restriction) | Windows, display cases, picture glass | digest **zero**; new `thin-pane` (emitter albedo 0, the tilted arm's reflection missing the emitter) |
| 9 | **Image textures** (color rows plus the `channel` float rows that step 6 makes useful; a sphere texture is an error until Q4 is decided; S4 lowering) | Wood tabletops and floors on quads and disks, and OBJ meshes with uvs. Poly Haven has no OBJ models [plan image-textures §3], so it pays off mainly on flat props for now | digest **zero** for existing scenes; new `image-texture` (a 4×4 image whose four quadrants all differ), `image-texture-spectral`, `image-texture-roughness` ⇄ `-ref` (R ≠ G ≠ B); `furnace`, `expr-const`, `expr-const-ref`, `spectral-expressions-constant`, `guides` |
| 10 | **`sheen`** (fuzz over Lambert) | Cloth and velvet | digest **zero**; new `sheen-furnace` (c = ρ) plus the grazing fuzz-alone orthographic quad (exact E(μ_o, r)) |
| 11 | **Microfacet lobe extraction** (S2 lobe; a refactor) | Prerequisite for step 12 | `frames compare` bit-identical on `veach-mis`, `rough-furnace`, `mirror` |
| 12 | **Measured metals** (C0 stand-in extraction, C1 `optical` + `measured`, C2 `conductor` + `rough_conductor`, single-scattering) | Correct metal color at grazing angles and true spectral metals. Placed late because it is the largest contract change, and for most metals Schlick with the right f0 is already within 0.03–0.05 (Al is the exception at 0.118) [plan conductor §1] | C0 and C1: digest **zero**; C2: only the `conductor_fresnel` lines; new `conductor-gold` with the off-normal 70° orthographic arm, `conductor-perfect` ⇄ `-ref`, `veach-metals`; `mirror`, `veach-mis`, `furnace`, `eta`, `spectral-mirror`, `spectral-materials`, `spectral-gaussian-plane`, `npm run witness:color` |
| 13 | *(optional)* Camera B (blades, compile-time rotation) and C (white balance) | Polygonal bokeh, and neutral color under tungsten-like blackbody light | B: digest zero, new `bokeh-edge` (columns 79–80 region), `thinlens-zero`; C: digest zero without WB, a vitest that parses `DISPLAY_VIEW` column-major and neutralizes `rgb_bb(2700)`, WB applied before `safe_color` |

Dependencies: 5 uses 4, but only to be useful. 7 uses the α field in GLSL and works either
before or after 6. 9 needs 6 only for its roughness maps. 12 needs 11. Every other step stands
alone.

---

## 4. Cut or defer (to keep it simple)

**Cut from the plans as written** (each review agreed):
- camera: `tent` (keep `gaussian`); the live `bladeRotation` control and its validation rule.
- energy: the witnesses `veach-mis-ms` and `rough-mis-ms` (replaced by `ms-furnace` under all
  three estimators); the `unitIntervalRows` fact and its new Validator rule (use the row
  `constraint`); two descriptor facts merged into one.
- coated: the `plastic-darkening` witness (`plastic-chroma`'s green channel is the same check).
- procedural: the `texture-estimators` witness (it cannot fail); media in the include gate.
- conductor: the ten `_lanes` wrappers (emit inline); vec3 and expression sliders on optical
  rows (constant, scalar `{param}` and `measured` only).
- image textures: the `MAX_ARRAY_TEXTURE_LAYERS` check; the HDRI-cost section (it belongs in
  the asset notes).
- small-materials: the `sheen-furnace` arm at r = 0.05 (it tests only Lambert); §0 rows 3–5
  shortened to one line each.

**Deferred to their own later plans:**
- Normal-map images (normal-mapping Stage B) together with anisotropic GGX. Both need the `Hit`
  tangent (S8) and the uv-chart decision, so they should share one plan, written after step 9.
- Object-space texture point `q` (procedural Part B). It has three open defects (tabled
  objects, a Validator rule that rejects working scenes, and the reintroduced region-keyed
  dispatch). A still photograph does not need textures that follow moving objects.
- Triplanar image projection on charts-less shapes (solid noise from step 4 covers math scenes
  first).
- `rough_plastic` (it reuses S3), coat absorption, coated conductor, Worley noise, emission on
  any model, transparent shadow rays through panes, glare, vignetting, and photographic
  exposure units.
- An energy gain for `rough_conductor` (§1.2.5).

---

## 5. Owner questions that block building

Each has a recommendation. Steps 1–5, 8 and 10 need none of these answered, except that step 2
needs Q5.

1. **Q1 (step 6). May α be computed per hit in GLSL?** That reverses D4. The host form stays
   for expensive derivations such as plastic's K. *Recommend yes:* roughness maps and
   procedural roughness need it.
2. **Q2 (step 7). Energy compensation as `measurement.microfacet`, default
   `single-scattering`, with roughness constrained to [0, 1] on ggx and rough_dielectric in
   every program.** No suite scene authors roughness > 1 [review energy]. *Recommend yes to
   both.*
3. **Q3 (step 12). Conductor: a new `optical` role and `measured` kind.**
   - RGB η/κ triples become an error in spectral programs.
   - RGB programs use the S2 stand-in. That makes gold slightly worse in RGB (worst 0.047
     against today's 0.029) and aluminium much better (0.002 against 0.118).
   - *Recommend yes.*
4. **Q4 (step 9). Textures on spheres.**
   - Option one: an error until the chart is decided.
   - Option two: flip the sphere chart to pbrt's orientation now, which changes existing
     checker-sphere images (declared, with a digest diff).
   - *Recommend the error now.*
5. **Q5 (step 2). Gaussian pixel filter.**
   - The choices are untruncated, radially truncated, or pbrt's tabulated version.
   - The field name and the stamping rule also need deciding.
   - *Recommend untruncated (weight 1, an effective 2.88 px cutoff from 24-bit ξ), the field
     name `measurement.pixel`, and always stamped.*
6. **Q6 (steps 3, 8, 12). Names and meaning of indices.**
   - Proposed names: `ior` = absolute index, region table only (dielectric). Relative scalar
     indices end in `_eta`: `coat_eta` (plastic) and `sheet_eta` (thin glass). conductor
     keeps `eta` and `k` (Spectrum).
   - All three relative indices are relative to the outside medium, documented and not
     checked (Mitsuba's and pbrt's convention). This is a known silent error for objects
     placed in water.
   - *Recommend this naming, and the documented convention.*
7. **Q7 (step 8).** Is a zero-thickness `thin_dielectric` compatible with fable-subsurface
   §5.1 ("thin shells absent")? *Recommend yes:* that rule is about scattering shells, and this
   sheet has no interior transport.
8. **Q8 (step 9).** Confirm that a 2D-array texture kind in the engine (§1.1) is not a
   change to the locked compiler↔engine types. *Recommend treating it as an engine API
   addition.*

Not asked again (already decided): license research is skipped (recent commit `af4708d`);
witnesses run targeted only, never the full sweep.

---

## 6. Size

The total is about 6,000 lines including tests, fixtures and docs, plus one 512 KiB table and
the vendored pbrt metal arrays. Approximate per step, from each plan after its review's cuts:

| Step | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lines | 60 | 300 | 500 | 350 | 650 | 100 | 850 | 360 | 650 | 500 | 120 | 1,050 | 350 |
