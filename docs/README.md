# Path Tracer Documentation

## Reference

| Document | Description |
|----------|-------------|
| [architecture.md](architecture.md) | Full system reference — three-layer architecture, all components |
| [compiler-engine-contract.md](compiler-engine-contract.md) | Locked compiler-engine boundary contract and types |
| [fable-compiler-contracts.md](fable-compiler-contracts.md) | GLSL contracts inside the compiler — interaction, regions/media, lights, transport (geodesic stepper superseded by trace-loop-contract.md) |
| [fable-transport-verification.md](fable-transport-verification.md) | Adversarial walkthrough of the medium/transport contracts — traces, findings, resulting amendments |
| [fable-reference-implementations.md](fable-reference-implementations.md) | Normative GLSL: Lambert, dielectric (η² factor), GGX, HG phase, light samplers, shadow transmittance, the v1 transport loop, MIS diff, geodesic steppers |
| [fable-validation-scenes.md](fable-validation-scenes.md) | Concrete test scenes with derived expected values — furnace box, Beer–Lambert slab, η² witness, cross-strategy trio, trace regressions |
| [fable-volumetric-component.md](fable-volumetric-component.md) | The volumetric component contract — interface/segment separation, MediumSample seams, the RTE partition rule, chromatic sampling per pbrt-v3 (supersedes reference-implementations §5's medium lines), strategy-axis rename |
| [fable-heterogeneous-media.md](fable-heterogeneous-media.md) | Heterogeneous media design authority (owner-approved Jul 17 2026; amended at implementation kickoff: clamp-in-the-lookup, absorbing-only arm, transcribe-with-lottery) — the phantom-fog picture, ceiling-as-definition (min(σ,σ̄) IS the medium), the 2×2 dispatch behind the volumetric seams, v1 = pt/pt-nee (mis = the deferred tally batch), expression coefficients + declared sliders + required majorant, witness plan |
| [fable-module-anatomy.md](fable-module-anatomy.md) | Module anatomy & property machinery — descriptor/schema shapes for §3.3/§3.4, property pins, family taxonomy, deferred file layout, drift ledger |
| [fable-transforms.md](fable-transforms.md) | Placement design authority — Euclidean similarities (s>0, no reflections, no nonuniform scale), the three-layer boundary (SceneDescription FLAT forever; groups = authoring layer via `flattenGroups`), per-backend lowering (analytic param fold / SDF wrapper tiers / local-frame conjugation), driven placement via per-field `Value<>`, staging + witness table. Supersedes design-scene-graph-transforms.md |
| [architecture-decisions.md](architecture-decisions.md) | Summary of locked architectural decisions |
| [fable-component-system.md](fable-component-system.md) | The component system, end to end — philosophy + a REAL compiled walkthrough (authoring → SceneDescription → GLSL); the extension-cost invariant per family |
| [fable-geometry-materials-target.md](fable-geometry-materials-target.md) | Geometry/materials/lights before & after the compiler — decision tags ([BUILT]/[ASPIRATIONAL]), the sdf-slot clauses, the tier table, the as-built ledger |
| [fable-naming-audit.md](fable-naming-audit.md) | Naming-systems audit (July 16) + RESOLVED outcomes (July 17): structural ids, reserved param prefixes, symbol contracts, clobber guards |
| [fable-review.md](fable-review.md) | Fable's full code review (July 2026) — bugs by layer, design recommendations |
| [fable-expression-machinery.md](fable-expression-machinery.md) | Design authority (handoff) for a compiler symbolic-algebra layer — parse authored `GlslExpression` into an AST, analyze (free vars), transform (differentiate, reduce, interval), emit derived GLSL; the vision, the capability taxonomy, the two forks |
| [fable-variable-ior.md](fable-variable-ior.md) | Variable-IOR (GRIN) media authority (Jul 21 2026, BUILT & GPU-verified; hard-interface batch Jul 22, GPU-unswept) — the first curved-space feature: Sharma ray ODE, velocity Verlet, the deflected MediumSample outcome, the glass rule, wall-material boundary model, the interior L/n² factor |
| [impl-plan-exact-linkage.md](impl-plan-exact-linkage.md) | Exact-linkage batch record (July 2026, BUILT) — wholesale component inclusion pin (contracts §2.12), seam decisions, the seam-unused diagnostic |
| [impl-plan-heterogeneous-media.md](impl-plan-heterogeneous-media.md) | Heterogeneous media implementation plan (Jul 17 2026, BUILT — GPU-unswept) — V0 plumbing / V1 transcribed loops / V2 witnesses, the 2×2 dispatch, the transcription-and-deviations section |
| [impl-plan-medium-emission.md](impl-plan-medium-emission.md) | Medium emission plan (Jul 17 2026, BUILT — GPU-unswept) — ε convention (B2's dimensional ladder), D1 scale on ε, per-tentative-collision collection + verified track-length derivations, E0→E2 |
| [impl-plan-driven-lights.md](impl-plan-driven-lights.md) | Driven light params Stage A (Jul 17 2026, PLAN) — emission as live sliders via formatter slots + CPU-shipped CDF (the precompute-and-ship rule); geometry = Stage B, deferred |
| [impl-plan-expression-machinery.md](impl-plan-expression-machinery.md) | Symbolic-algebra compiler layer plan (Jul 21 2026, PLAN) — the conditional-worth scope decision (worth is inherited from varieties + curved-space), the A–F capability taxonomy, staged build keyed to first-customers (parser+free-var on spec; reduction/differentiation/interval pulled by real customers), the varieties stage grounded in verified research (Bernstein basis, root-isolation occupants, the singular-shading wall) |
| [impl-plan-grin-interface.md](impl-plan-grin-interface.md) | GRIN hard-interface batch (Jul 22 2026, BUILT — GPU-unswept) — ior_of(region, p) unification, walker demoted to interior-only (inside-exit handoff + t_max guard), the interior L/n² factor, grin-glass twin + grin-furnace-hard witnesses |
| [impl-plan-grin-media.md](impl-plan-grin-media.md) | GRIN emission + scattering batches (Jul 22 2026, BUILT — render-checked, sweep owner-gated) — per-step ε collection × the (n₀/n)² Kirchhoff source factor, arc-length channel-MIS scattering, the event-ray seam completion (arms report scatter position/direction), accretion + maxwell demos; per-region derived-step-knobs PLAN awaiting owner go |

## Guides

| Document | Description |
|----------|-------------|
| [ui-components.md](ui-components.md) | UI component system — Panel, Folder, Slider, etc. |
| [layout-system.md](layout-system.md) | Layout system — fullscreen, centered, editor, split modes |
| [production-rendering.md](production-rendering.md) | Production rendering — tiled output, progress tracking, export |

## Archive

Old documentation from previous architectural iterations (module/recipe system, Flexible* naming era) is preserved in [archive/](archive/).
