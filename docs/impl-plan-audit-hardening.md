# Implementation Plan — Audit Hardening (July 2026 audit closeout)

**Author:** Fable (from the four-front audit, July 11 2026)
**Status:** proposed — pending owner review
**Scope rule:** hardening only, no feature work mixed in (owner protocol). Every item is
independently committable and carries its own verification. Engine/extern work found by the
audit is **deliberately excluded** — it lands as T1 of the env-as-light build
(`impl-plan-env-as-light.md`), because patching the legacy path twice is waste.

The audit's full findings ledger: no critical bugs; MIS/NEE, channel-MIS media, dielectric,
regions, RR all verified faithful to the references; `tsc` clean, 267/267 tests green. The
items below are every latent defect and gap worth closing, ordered validator-first.

---

## H1 — Validator pack (scene-authoring correctness)

All are Validate-stage diagnostics through the DiagnosticBag (the pattern-consistent home);
generator throws stay as unreachable backstops.

1. **`sampleAsLight` requires an emitting surface model.** The registry admission
   (`Planner.ts:135-159`) checks shape + constant nonzero emission but not that the
   material's model reads `mp.emission` in `interaction_surface_emission`. A
   `dielectric`/`none` material with emission enters the NEE registry while BSDF paths see
   zero — pt vs pt-nee converge to different images (the exact mismatch the Planner's own
   invariant comment forbids). Rule: emissive + samplable requires a lambert-family model;
   otherwise error with a pointer to `sampleAsLight: false` (path-only glow is still legal).
2. **`phase_g` range.** `|g| = 1` exactly is deterministic NaN (`phase_hg.glsl` d = 0 at the
   sampled pole). Rule: require `|phase_g| <= 0.99` (error). Shipped scenes stay ≤ 0.95.
3. **Non-negative radiometry.** Light `intensity >= 0`; emission components `>= 0` (error).
   Negative emitters break the power CDF floor and diverge strategies. Also reconcile the
   emissive gate: `materials.ts:33` (`c !== 0`) vs `materials.ts:196` (`c > 0`) — change the
   gate to `c > 0` so `material_is_emissive` and the fetched emission can never disagree.
4. **Finiteness.** Every numeric reaching codegen must be finite; today a NaN position or
   Inf intensity crashes `glsl-format.ts:5-7` with a raw unmapped `Error`. One central sweep
   over the scene description in Validate (error), keeping the formatter throw as backstop.
5. **Analytic object degeneracy.** Validation currently covers explicit *lights* only.
   Analytic quad **objects** with parallel edges reach `quadNormal`'s zero-length cross →
   NaN → raw throw; near-parallel quads (area ~1e-20) pass the exact-zero test and produce
   Inf pdfs. Rule: `|e1×e2|` above an epsilon area threshold (shared between object and
   light checks); sphere `radius > 0`. (Error.)
6. **Reserve the `__light_` prefix** on user material names (error). Today a material named
   `__light_0` is silently skipped by the desugar loop's `startsWith` guard — it glows under
   pt but is absent from the NEE registry.
7. **Pipeline validation vs contract §9** (in `validateCompiledRenderer`):
   - Rule 1: exactly one `type: 'screen'` framebuffer (currently unchecked; zero → mid-frame
     "Resource not found: screen").
   - Rule 4 promoted from warning to **error**: `swap` requires exactly one `double_buffer`
     target (a misdeclared swap silently no-ops at runtime → frame 1 forever).
   - `rotate` swap: **reject at validation** with a named diagnostic until temporal-history
     queues exist (today it validates clean and throws mid-frame at
     `ResourceManager.ts:190-192`). Implementing rotate is not this batch's job.

**Verification:** unit tests per rule in `validator.test.ts` / `validateCompiledRenderer.test.ts`
(accept + reject cases); the phantom-light rule additionally gets a would-have-diverged scene
fixture asserting rejection.

## H2 — Quad back-face `region_from` fabrication

Found independently by two auditors. The generated exit branch (`intersection.ts:346-349`)
assumes "the owner covers its own side" — false for zero-thickness quads, whose SDF never
claims containment (`1.0e20`). A back-face quad hit fabricates `region_from = owner`, and the
§4.4 self-heal then sets `current_medium` to the quad's region for one segment (no fog
attenuation, no scattering). Masked today only because desugared `__light_n` quads have black
albedo.

**Fix (invariant, not patch):** the owner-covers-own-side shortcut is only valid for owners
that can contain points. For non-containing primitives (quads), classify `region_from` with
the same epsilon probe machinery used elsewhere: `scene_region_at` on the arrival side of the
hit point. Codegen knows at generation time which owners are zero-thickness, so the probe is
emitted only for those arms — no cost to solid regions.

**Verification:** a fog scene with a user-authored diffuse (nonzero-albedo) quad; back-face
bounce paths must show fog continuity. Add as a suite scene with an X-pair equality check
(pt vs pt-nee) — the mistracked segment breaks equality before the fix.

## H3 — Camera straight-down NaN

`camera_pinhole.glsl:11`: `cross(forward, vec3(0,1,0))` degenerates when forward ∥ ±Y → NaN
basis → NaN frame. Guard: when `|forward.y| > 1 - 1e-6`, substitute `vec3(0,0,1)` as the up
reference. **Verification:** straight-down orbit in the lab renders (manual GPU check);
closes the last open fable-review loop item.

## H4 — Planner diagnostics (C8) + SDF arm errors (C7, partial)

- Thread the `DiagnosticBag` into `plan()` (`Compiler.ts:22`) — validate and generate already
  receive it; plan is the odd one out.
- Convert the raw `throw new Error` for unimplemented SDF primitives (`torus`/`capsule`,
  `intersection.ts:124-126`) into planner diagnostics.
- **Deferred, unchanged:** full per-primitive parameter schemas (the `{ r: 2 }` silently
  renders a unit sphere problem) stay with the fable-module-anatomy §7 descriptor reorg —
  that's where parameter schemas get a real home; a one-off validation table here would be
  churn.

**Verification:** planner-diagnostic unit test (torus scene → diagnostic, not throw).

## H5 — Display axis honesty (audit C2 + review C5)

- `ShaderBuilder.buildDisplayBlocks()` must read the plan: `tonemap: 'none'` → passthrough
  display shader. This is not cosmetic — §11 on-screen radiance checks against
  `fable-validation-scenes.md` expected values need un-tonemapped output.
- Wire `display.exposure`: one multiply + one `PlannedUniform` in the reinhard block (it is
  already planned and carried; only the generator ignores it).
- **Delete dead surface:** `transport.samplesPerFrame` (`types.ts:231`, read nowhere) and
  `metallic` (`types.ts:156`, analyzed but never planned) come out of the types until a build
  actually consumes them. Don't describe deferred as built — and don't type it either.

**Verification:** snapshot cases for `tonemap: 'none'` and nonzero exposure; tsc catches any
stale scene usage of the deleted fields.

## H6 — Test debt from the audit

1. **`tests/compiler/lightingCdf.test.ts`** — the power-CDF math is pure TS with no invariant
   tests (snapshots freeze bytes only). Assert: select pdfs sum to 1; pbrt power formulas
   against hand-computed values (point `4π·avg`, quad `π·A·avg`, sphere `4π²r²·avg`);
   uniform-vs-power selection; single-light trivial case; the `max(1e-8,·)` floor.
2. **`tests/compiler/lightDesugar.test.ts`** — the load-bearing "scene order = light id =
   CDF order" invariant; `sampleAsLight: false` exclusion; Le equality between the desugared
   material emission and the sampler registry (both authoring routes).
3. **Snapshot coverage:** add the 5 missing (scene, strategy) pairs — `fog-area+pt-nee` first
   (a genuinely distinct define combination: medium NEE without `ENABLE_MIS`); fix the stale
   registry comment (`scenes/index.ts:7`) claiming the snapshot iterates the registry.
4. **`buildEnvironmentSampler` pdf-normalization test** (pre-work for env-as-light): assert
   `Σ pdf(i,j)·dΩ(i,j) = 1` over all texels, re-deriving the pdf from the build outputs. This
   is exactly the invariant the reference GLSL's intensity bug violates — having the test in
   place before T2/T3 land makes the transcription honest.

## H7 — Doc & comment sync

- CLAUDE.md: C4 is fixed (`Validator.ts:87-94` rejects `model: 'emissive'`) — the "C4 open"
  line is stale.
- `fable-review.md` headers: mark C4 fixed; note camera-NaN fixed once H3 lands.
- Add the metric-exemption header note to `light_quad.glsl` / `light_sphere.glsl` (raw
  `dot()` on world-space physical directions — same exemption `analytic_primitives.glsl`
  already documents). Doc-hygiene per the trace-loop contract's by-eye checkability rule.

## Explicitly NOT in this batch (and why)

| Item | Disposition |
|---|---|
| Engine F1 (legacy env machinery) + F10 (texture-unit collision) + `extern:` resolution | **T1 of env-as-light** — the sanctioned replacement, not a patch |
| A1–A4 (RendererManager cross-scene recompile leak/stale-select, ParameterStore staleness, ProductionOrchestrator toggle) | Dead paths under the page-reload pattern; ledgered in the audit memory, revisit when live scene-switching becomes real |
| C7 full per-primitive schemas | fable-module-anatomy §7 reorg trigger |
| Adaptive interface epsilon (§10.2), stall-window residual > EPS_INTERFACE on grazing exits | Documented tradeoffs from the glancing-angle work; the principled follow-ups remain queued there |
| RR start-depth off-by-one vs reference, shadow_media early-out, `u_time` unused | Efficiency/cosmetic only — not worth churn |

## Order

H1 → H2 → H3 (correctness, all independent) → H4/H5 (plumbing) → H6 (tests lock it in) →
H7 (docs last). One session's work; run `npx vitest run` + the fog-quad witness + a
straight-down orbit before calling it closed.
