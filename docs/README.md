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
| [fable-module-anatomy.md](fable-module-anatomy.md) | Module anatomy & property machinery — descriptor/schema shapes for §3.3/§3.4, property pins, family taxonomy, deferred file layout, drift ledger |
| [fable-transforms.md](fable-transforms.md) | Placement design authority — Euclidean similarities (s>0, no reflections, no nonuniform scale), scene-graph groups + flatten, per-backend lowering (analytic param fold / SDF wrapper tiers / local-frame conjugation), driven-transform uniforms, staging + witness table. Supersedes design-scene-graph-transforms.md |
| [architecture-decisions.md](architecture-decisions.md) | Summary of locked architectural decisions |
| [fable-review.md](fable-review.md) | Fable's full code review (July 2026) — bugs by layer, design recommendations |
| [impl-plan-exact-linkage.md](impl-plan-exact-linkage.md) | Exact-linkage batch record (July 2026, BUILT) — wholesale component inclusion pin (contracts §2.12), seam decisions, the seam-unused diagnostic |

## Guides

| Document | Description |
|----------|-------------|
| [ui-components.md](ui-components.md) | UI component system — Panel, Folder, Slider, etc. |
| [layout-system.md](layout-system.md) | Layout system — fullscreen, centered, editor, split modes |
| [production-rendering.md](production-rendering.md) | Production rendering — tiled output, progress tracking, export |

## Archive

Old documentation from previous architectural iterations (module/recipe system, Flexible* naming era) is preserved in [archive/](archive/).
