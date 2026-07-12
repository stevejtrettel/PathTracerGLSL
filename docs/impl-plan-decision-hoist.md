# Implementation Plan — Decision Hoist (batch 1 of the compiler cleanup)

**Author:** Fable (July 2026, owner-approved design discussion — see `fable-strategy-taxonomy.md`)
**Status:** **BUILT (July 2026)** — T1 (c32a927), T2 (1d94c22), T3 (c469682), T4 (82766b3);
all gates green (T1/T2 GLSL snapshot-identical; T3 47 pairs statically compile; T4 churn =
exactly the interfaces block + deleted env-light-decls, GPU furnace spot-check clean).
One recorded deviation: NO separate transport-flags record — the ProgramDescription
sections ARE the flags (avoids duplicated truth); the split's segment generators read
`program.measurement/estimator/media` directly. Precedes the transport split, which
consumes this batch's output shape (the §2.10-before-item-9 precedent).
**Kind:** refactor-only. Zero behavior change; generated GLSL snapshot-identical at every
step except T4 (whose churn is exactly one added header block, reviewed by diff shape).
Don't mix transport-split or descriptor-reorg work in.

**Precondition:** the env/chart-axis working-tree changes are committed (clean baseline).

---

## Why

Three gaps between the converged architecture and the code, all closable without touching
behavior:

1. **`ProgramDescription` is not a program description.** Decisions leak into Generate:
   `materials.ts` computes `scatteringLive` at emit time, `lighting.ts` discovers samplable
   emitters by filtering, `environment.ts` reads analyzer facts directly, four features emit
   the structural defines that configure a fifth. The preprocessor's global namespace papers
   over this and the transport split deletes the preprocessor — hoist first.
2. **The strategy schema predates the taxonomy.** `fable-strategy-taxonomy.md` is pinned;
   the flat `RenderStrategy` doesn't express it, and `volumeIntegrator` conflates a
   measurement truncation with an estimator axis (taxonomy §8).
3. **Two structural nets are missing:** generated GLSL is never statically compiled in CI
   (the review's "biggest untested surface"), and feature ordering is held by comments +
   hand-pushed forward declarations instead of declared seams.

## T1 — Strategy schema reshape (taxonomy §2/§7)

`compiler/types.ts`: `RenderStrategy` becomes three sections:

```typescript
measurement: {
    camera: { type: 'pinhole'; fov: Value<number> };
    response: 'radiance';                        // reserved occupants arrive with §11.3/§11.4
    maxBounces: number;                          // truncation — limit: ∞
    scattering: 'full' | 'ignored';              // truncation — volumeIntegrator's measurement half
    shadows: 'opaque-dielectrics';               // truncation — §6.3 policy, now a DECLARED bias
    color: 'rgb' | 'spectral';                   // truncation — 'spectral' Validator-rejected (§8 reserved)
};
estimator: {
    directLighting: 'none' | 'nee' | 'mis';
    lightSelection: 'uniform' | 'power';
    russianRoulette: { startDepth: number } | null;
    volumeSampling: 'analytic' | 'delta-tracking' | 'ratio-tracking';   // non-'analytic' Validator-rejected
    envSampler: { chart: 'equirect' | 'octahedral'; compensation: boolean };
    accumulation: { type: 'average' } | { type: 'exponential'; alpha: number } | { type: 'variance' };
};
view: {
    tonemap: { type: 'reinhard' | 'aces' | 'filmic' | 'none'; exposure?: number };
};
```

- **The `volumeIntegrator` split:** old `volumeIntegrator: 'none'` on a scattering scene ⇒
  new `measurement.scattering: 'ignored'`. The Planner derives
  `scatteringLive = features.media.hasScatteringMedia && measurement.scattering === 'full'`;
  `volumeSampling` is consulted only when scattering is live.
- **Validator:** reject reserved values with clear messages (reject-not-remove, the
  established pattern); `shadows` accepts its single value; existing checks carry over.
- **Scenes:** all registry strategy literals update mechanically. Owner call: the scenes
  are disposable validation carriers — rewrite freely, but every suite `expected` value
  keeps a carrier (the witness inventory is the non-negotiable part, not the literals).
- **Parameter paths stay stable** (`camera.fov`, `env.selectProb`, `display.exposure`, …) —
  the UI/app surface must not notice this batch.

**Gate:** generated GLSL snapshot-identical for every registry pair.

## T2 — Complete `ProgramDescription` (the hoist proper)

`plan/types.ts`: `ProgramDescription` mirrors the three sections and becomes the complete
link map — every decision the Generator needs, none it must re-derive:

- `measurement` / `estimator` / `view` blocks carrying the resolved strategy decisions;
- `media: { arms: 'none' | 'absorbing' | 'scattering'; nullInterfaces: boolean; shadowWalker: boolean }`;
- `emitters: { samplable: boolean; lightingPdf: boolean }` (the §6.2 facts lighting.ts
  currently rediscovers by filtering);
- `environment.samplable` resolved (no feature reads `plan.features.environment` again);
- `transport` flags record — exactly the input the split's segment generators will consume:
  `{ hasMedia, hasScattering, hasNullInterfaces, hasTransmission, nee, mis, envSamplable,
  samplableEmitters, rr, maxBounces }`.

**The rule this batch enforces, permanently:** *Generate reads `plan.program` + resolved
data tables (`materials`, `lights`, `objects`, `ambientMedium`); it never reads
`plan.features`.* Mechanical sweep of `generate/features/*.ts`; `SceneFeatures` becomes
Analyzer→Planner-internal.

**New structural test:** serialize `ProgramDescription` per registry pair into its own
snapshot file — the link map as a first-class tested artifact ("fog under pt-mis has
scattering arms + medium NEE" becomes a structural assertion, independent of GLSL text).

**Gate:** generated GLSL snapshot-identical.

## T3 — glslang harness (before T4, so it guards T4's text change)

New vitest suite: for every registry pair, assemble the fragment + vertex shaders through
the real pipeline and compile them with a WASM glslang build (candidate packages:
`@webgpu/glslang`, `glslang-validator-prebuilt`; pick whichever cleanly validates
`#version 300 es` — resolve at implementation, it's a dev-dependency choice). No GPU, runs
in `npx vitest run`.

- Closes the C4 bug class (structurally valid TS emitting GLSL that doesn't parse) for
  every pair, not just the ones a browser visit exercises.
- **Known limit — glslang is not ANGLE:** it accepts constructs ANGLE rejects (notably
  `?:` on struct operands, the media-build trap). This harness proves *parse/type*
  validity only; ANGLE dialect quirks remain the GPU witnesses' job. Do not treat T3
  green as "compiles in the browser."
- Documented slot for §11.5: when spectral lands, this harness compiles every pair under
  both color modes. Not built now — the slot is named in the test file header.

**Gate:** all pairs compile; suite green.

## T4 — provides/requires + the generated interface header

- `FeatureContribution` gains `provides: { name: string; signature: string }[]` and
  `requires: string[]` (seam names).
- ShaderBuilder emits one `generated:interfaces` block — forward declarations for every
  provided seam — after core/structs, before all feature blocks. Feature order stops
  mattering for declarations; lighting.ts's hand-pushed env forward-decls are deleted.
- `merge.ts`/Validator: every `requires` satisfied by some `provides`, duplicate provides
  are an error (mirrors the §2.10 uniform-dedupe rule). Declared-vs-emitted drift in a
  signature is caught by T3's harness (a mismatched forward declaration fails to compile).
- Side effect: every shader dump opens with a machine-generated table of contents of the
  live contract surface.

**Gate:** snapshot churn is exactly: one added `generated:interfaces` block per shader +
the deleted ad-hoc decl block. Review the diff shape; T3 green proves compilability; run
one GPU witness (F-BOX) as a sanity spot-check.

## Order & commits

T1 → T2 → T3 → T4, one commit each, snapshots asserted at every step. T1/T2 could merge
into one commit if the type churn overlaps too much to split cleanly — the gates are what
matter, not the commit count.

## Pitfalls

- **Parameter paths and `ParameterMetadata` are app-visible** — keep every dotted path
  byte-identical (T1's silent break risk).
- **`resetSalt`/accumulation semantics untouched** — reshaping `accumulation` into
  `estimator` is a *type move*, not a behavior review (taxonomy §6.2's "reset optional for
  estimator knobs" is a *future* relaxation, not this batch).
- **Forward-declaration signatures must match definitions token-for-token** (GLSL is strict
  about qualifier/type spelling) — T3 catches it, which is why T3 precedes T4.
- **Don't "improve" emitted GLSL while sweeping features** — any wording/variable cleanup
  belongs after the transport split, per its own plan's rule.

## Definition of done

All four gates green; `npx tsc --noEmit` clean; full suite snapshots re-frozen exactly once
(T4's header churn); docs updated: CLAUDE.md current-state, `fable-strategy-taxonomy.md`
§11 status flip, contracts §7.3 cross-reference annotation, `fable-module-anatomy.md` drift
ledger entry. Then the transport split starts from `program.transport` with no side-channel.
