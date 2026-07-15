# components/ — the library of swappable research code

A renderer in this system is nothing but answers to three mathematical questions:

1. **What integral am I computing?** — the *scene* supplies the integrand (materials =
   the scattering kernel f, lights = the source term, media = the RTE terms, geometry,
   the ambient space); the *measurement* supplies the functional (camera) plus declared
   truncations (max bounces, shadow policy).
2. **How do I estimate it?** — sampling techniques, weights, RNG, accumulation.
   Changes noise, never the answer.
3. **How do I display it?** — tonemap, exposure.

This folder is the **vocabulary for answering them**: each subfolder is one category of
answer (a *family*), each occupant folder one available answer. The compiler takes your
three answers (`SceneDescription` + `RenderStrategy`) and writes the one shader that
computes exactly that and nothing else.

## Rules (each enforced or witnessed)

- **1 component = 1 folder**: `{name.glsl, name.ts (descriptor/glue), name.md (the
  mathematics — optional, encouraged), tests}`. Shared family parts (registries,
  combiner/flags, math_mis, sampler_cdf) sit at family roots.
- **Leaf layer**: components import NOTHING from app/engine/compiler except contract
  types (`import type` only) — enforced by `tests/components/purity.test.ts`.
- **THE GUARDRAIL**: a descriptor (and a math doc) states facts about ONE occupant —
  never composition, ordering, passes, or pipeline structure. Decisions live in
  compiler feature planners. (This rule is the tombstone of the previous architecture.)
- Every family root carries a `README.md` stating its taxonomy section, its kind
  (mix-many / pick-one), the occupant contract, and the add-an-occupant recipe —
  enforced by `tests/components/structure.test.ts`.
- GLSL conventions all occupants share: `Spectrum/Point/Direction/Radiance` typedefs
  (never raw `vec3` for radiometric values, §2.5), metric products via `ambient_dot`,
  bare f without cosines (§2.2), no `#ifdef`s — the compiler specializes by inclusion
  and generation, never the preprocessor.

## Authorities

`docs/fable-components.md` (this library's design + the §7 transport anatomy),
`docs/fable-strategy-taxonomy.md` (the three questions, pinned),
`docs/trace-loop-contract.md` + `docs/fable-compiler-contracts.md` (the GLSL contracts),
`docs/fable-reference-implementations.md` (normative GLSL — transcribe, don't re-derive).
