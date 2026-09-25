# Exact linkage for scene data

Status: agreed with the owner (Sep 24 2026), not built. Build after the fixed-code witness
sweep and the commit of the Sep 24 fixes (see CHANGELOG.md).

## The rule

A data region exists only if some program reads it — the data counterpart of the existing
rule for code (a generated function exists only if something calls it).

## The problem it solves

The compiler compiles one strategy at a time, but all of a scene's strategies share one set
of data textures. To guarantee that every program's baked texture offsets match the uploaded
bytes without knowing its sibling strategies, `dataTenantsOf` lays out every structure ANY
strategy could read, and the App re-derives the same layout to pack the bytes. So the App
builds, for example, a CWBVH for every eligible instance cloud even though no default
strategy reads it (measured: +0.8 s at 200k instances, +2.6 s at 724k, +5.3 s at 1.4M, on top
of the binary TLAS that is actually used), and likewise the light tree under `power`
selection and the object table under `unrolled` dispatch.

## Requirements

1. Build a structure only if some renderer reads it.
2. Offsets baked into each shader match the uploaded bytes, decided in one place.
3. A scene's strategies share one upload (no per-strategy duplication of large clouds).
4. Heavy builds (BVHs over 10⁶ items) stay off the main thread; the compiler stays synchronous.

## Design

1. `compileScene(scene, strategies)` compiles a scene's strategies together.
   `compile(scene, strategy)` remains as the one-strategy case.
2. Each strategy is planned as today. A small function maps a `ProgramDescription` to the set
   of data it reads — the decisions are already there: `instanceAccel: 'cwbvh'` (CWBVH),
   `lightSelection: 'bvh'` (light tree), `objectDispatch: 'table'` (object table + region
   materials), `meshTraversal` (BLAS nodes, also needed by containment), `instanceAccel`
   `'tlas'` vs `'linear'` (TLAS nodes), NEE with mesh emitters (mesh-light tables),
   env chart/compensation (environment CDF variants).
3. The union over the scene's strategies is what gets built. `dataTenantsOf` takes that set
   and lays out only those regions — still the one layout function, called once.
4. Every program is generated against that one layout.
5. The result is the renderers plus a data plan: which structures to build and where they go
   (bases and sizes; no bytes).
6. The App compiles FIRST, then runs the plan (builds in workers) and uploads. It decides
   nothing itself.

Consequences: no unneeded builds; a bad scene fails at compile time with diagnostics before any
packing (currently packing runs first); `recompile` produces a new plan and the App
re-uploads when it changed (currently a recompile with a new scene keeps the old scene's
data); the App's separate derivation of environment-table variants from strategy fields
becomes part of the plan.

Cost: a program's baked offsets depend on which sibling strategies share its scene (adding a
`cwbvh` strategy can shift later regions). Images are unaffected. Keep the effect small by
placing optional structures after the always-needed ones in each channel.

## Staging

- **Stage 1:** `compileScene` + the reads-set; the layout takes the union; the App compiles
  before packing and skips structures not in the plan. Delivers the load-time win and fixes
  the pack-before-validate and stale-recompile bugs.
- **Stage 2:** the plan carries the packing inputs (folded records, light roster values,
  region→material ids), so the App stops re-deriving scene facts and the drift assertions
  (`light roster drift`, `region-material drift`) can be removed.
