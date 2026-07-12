# Implementation Plan — Transport-Generator Split (§10.1 item 9)

**Author:** Fable (July 2026, owner-approved design discussion)
**Status:** planned — NEXT BUILD (goes BEFORE GGX, owner decision July 12 2026)
**Kind:** refactor-only batch. Zero behavior change, zero new features — the equivalence
test below is the definition of done. Don't mix anything else in.

## Why now (the owner's framing)

> "we don't need ifdef stuff everywhere if we are writing a compiler — we should be
> building the right code."

`path_trace.glsl` is the last big template pretending to be generated code. Every other
dispatcher (`scene_intersect`, `lighting_sample`, `medium_sample`, `material_of`,
`lighting_pdf`) is *built* per program; the transport loop is *toggled* by a lattice of
thirteen structural defines (`HAS_MEDIA`, `HAS_SCATTERING`, `HAS_NULL_INTERFACES`,
`HAS_TRANSMISSION`, `ENABLE_NEE`, `ENABLE_MIS`, `ENV_SAMPLABLE`, `HAS_SAMPLABLE_EMITTERS`,
`ENABLE_RUSSIAN_ROULETTE`, …) — a 2ⁿ mental state space that grew again with every build
(media, area lights, env-as-light). A preprocessor can only toggle branches in a fixed
skeleton; it cannot restructure, specialize, or deduplicate. The loop's own source carries
the IOU: *"Inline duplicate of the surface RR block until the item-9 generator split."*

Every §10.1 item except this one is done. GGX would add another feature's worth of
conditional structure to a template already on borrowed time — hence the ordering flip:
**split first, then GGX lands as generator segments + a material arm, not as defines.**

## The shape

`transport.ts` stops shipping `path_trace.glsl?raw` + defines. Instead, a generator
assembles `transport_trace` from typed segment functions, each returning GLSL lines with
its own provenance origin:

| Segment | Emitted when | Origin |
|---|---|---|
| State init (`eta_scale`, `current_medium`, `null_crossings`, `prev_was_delta`, `prev_bsdf_pdf`/`prev_p`) | each iff its feature is live | `generated:transport/init` |
| Medium segment (sample + scatter event: medium NEE, phase sample, RR, continue) | media / scattering / NEE / MIS variants | `generated:transport/medium` |
| Miss branch (env radiance with exactly the w-bookkeeping arm this strategy earns) | always; arm per samplable × NEE × MIS | `generated:transport/miss` |
| §4.4 self-heal | media | `generated:transport/self-heal` |
| Null-interface crossing | null interfaces | `generated:transport/null` |
| Emission at hits (the NEE×MIS×emitters variant, singular) | always; variant per program | `generated:transport/emission` |
| Surface NEE | NEE | `generated:transport/nee` |
| BSDF sample + throughput + prev_* bookkeeping | always | `generated:transport/bsdf` |
| Medium/eta tracking on transmission | media / transmission | `generated:transport/tracking` |
| Russian roulette — ONE generator function, emitted at both sites (cashes the IOU) | RR | `generated:transport/rr` |
| Continuation spawn | always | `generated:transport/spawn` |

Consequences:
- Generated programs contain **only the code that runs** — no dead branches in dumps,
  snapshots, or heads.
- GPU error mapping gets MORE precise: errors map to `generated:transport/<segment>`
  instead of a line in one 258-line template.
- The comments move with the code — each segment generator carries its contract citations
  (§7.2, §6.2, §4.4, reference §5/§8) so the generated output stays self-documenting.

**What stays untouched:**
- Library GLSL (`lambert/dielectric/phase_hg/light_*/env_*/shadow_*.glsl`) — the durable,
  hand-auditable math files (the archive-era lesson: GLSL contracts durable, orchestration
  churns). The split is about the LOOP only.
- Numeric constants (`MAX_BOUNCES`, `RR_START_DEPTH`, `MAX_NULL_CROSSINGS`,
  `MAX_SHADOW_SEGMENTS`) — inline as literals (the generator knows them); the boolean
  STRUCTURAL defines are what vanish. Library-file-internal defines (e.g. shadow walker's
  segment cap) may stay defines if a library file reads them.
- The trace-loop contract types (`Ray`, `Hit`, `scene_intersect`, `make_ray`, `ray_spawn`,
  `ambient_dot`) — this is a re-plumbing of who EMITS the loop, not a change to it.

## The proof (definition of done)

1. **Token-equivalence test (temporary):** the old template uses only
   `#ifdef` / `#if defined(...)` (incl. `&&`) / `#else` / `#endif` — trivially evaluable in
   TS. The test preprocesses the old template under each suite pair's define set,
   normalizes whitespace/blank lines, and asserts TOKEN IDENTITY with the new generator's
   output, for every (scene, strategy) pair in the registry (~40). Green = the refactor is
   proven byte-equivalent, not plausible. The test and the template are then deleted
   together in the same commit.
   - Comments may differ (they move into segments); normalize them out of the token stream.
2. **Standing nets:** golden snapshots re-freeze the new output (expect total churn — the
   equivalence test is what makes accepting it safe); full GPU witness sweep re-runs
   (furnace 0.4, F-ETA 0.554, slab, X-CORNELL/X-GLASS/X-FOG, fog-panel, furnace-sky ρ·L,
   X-ENV, X-CHART, W9) via the Playwright harness (`.claude/skills/verify`).

## Order of work

1. Write the equivalence test against the CURRENT template (it passes trivially — it's
   testing the preprocessor evaluator). Commit.
2. Build the segment generators in `transport.ts`, switching feature by feature while the
   equivalence test stays green (the test pins each step).
3. Delete `path_trace.glsl` + the structural defines + the equivalence test; accept
   snapshots; run the GPU sweep.
4. Update docs: CLAUDE.md current-state, contracts §7.1 cross-reference, this plan's
   status, the trace-loop contract's "read before touching the loop" pointer (the loop now
   lives in `transport.ts` segments).

## Pitfalls

- **ANGLE no-struct-ternary** (memory): the template avoids `?:` on structs — segment
  generators must preserve that discipline (the emission block's `eprops` pattern).
- **`prev_*` writes at medium AND surface events** — the MIS bookkeeping's most fragile
  invariant; the equivalence test covers it, but keep the two sites emitted from shared
  helpers where possible.
- The `boundary` variable split (`HAS_MEDIA` changes the `scene_intersect` call shape) is
  the trickiest toggle — it restructures the top of the loop, not just a branch.
- Snapshot churn is TOTAL — do not eyeball-accept without the equivalence test green first.
- Don't "improve" anything while splitting (variable names, epsilon values, comment
  wording in emitted GLSL is fine to move but not to rewrite) — equivalence first;
  cleanups are a separate commit after the template is gone.

## After this lands

GGX (reference §7, transcription-ready) arrives on generated transport — microfacet
distribution seam first, GGX as first occupant, per the modular-first principle. Further
out, this split is the door to the transport-STRATEGY axis (genuinely different loop
structures composed by the compiler), which is the research tracer's long-game.
