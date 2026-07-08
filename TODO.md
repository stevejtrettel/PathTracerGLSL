# TODO — PathTracerGLSL

## Next Major Milestone: Build the Real Compiler

Replace `SimpleCompiler` (hardcoded GLSL strings) with a compiler that generates shaders from scene descriptions and rendering strategies.

See [compiler-engine-contract.md](docs/compiler-engine-contract.md) for the locked architectural contract.

### Open Design Questions
- Scene description format — how to specify geometry, materials, lights
- Algorithm selection — how `RenderStrategy` references rendering algorithms
- Code generation approach — GLSL templates vs string building vs hybrid
- Multi-material SDF compilation — how to compose multiple objects with different materials
- Source maps — mapping generated GLSL back to source for error reporting

---

## Low Priority

### Layout-Aware Extension Base Class
3 extensions (ParameterPanel, ProductionPanel, StatsPanel) share identical layout detection boilerplate. Could extract a `LayoutAwareExtension` base class. Premature until more extensions are added.

### WidgetFactory Type Expansion
Currently supports: `float`, `int`, `bool`, `color`, `vec2`, `vec3`, `vec4`. Could add `string`, `file`, `enum` when needed.

---

## Completed

- [x] Fixed six output-corrupting bugs from docs/fable-review.md (July 2026): RNG values ≥ 1.0 NaN-poisoning pixels (rng.glsl, also fixes multi-light selection fallthrough); tiled-render RNG seeding with local instead of global pixel (main_accumulate.glsl); HDR export reading one frame stale post-swap (PipelineBuilder.ts); Rec.601→Rec.709 luminance (math.glsl); ResourceManager.cleanup() throwing on the 2D texture array (dispose was broken); EventBus.emit skipping listeners when once() unsubscribes mid-dispatch. Tests + typecheck pass.

- [x] Move keyboard controls from App to AppShortcutsExtension
- [x] Add 'error' state to Engine
- [x] Cache draw buffer setup in RenderExecutor
- [x] Rename Flexible* files (FlexibleApp → App, etc.)
- [x] Design and implement DiagnosticBag error system
- [x] Migrate HDR validation to use DiagnosticBag
- [x] Remove legacy error files (~1700 lines deleted)
- [x] Rename formatters/ to reporters/
- [x] Fix all 29 TypeScript errors
- [x] Add GLSL module type declarations (src/glsl.d.ts)
- [x] Add uniform location warnings
- [x] CompiledRenderer validation (structure, references, duplicates)
- [x] ResourceManager format normalization
- [x] Sort documentation — archive old module/recipe docs, write CURRENT-STATE.md
- [x] Update README.md to reflect actual current state
- [x] ParameterManager cleanup — accepts `UniformBinding[]` directly, removed `ModuleDescriptor`/`ModuleKind`/`MODULE_ORDER` from engine/types.ts
- [x] Archive old module code — extracted GLSL algorithms to `reference/`, deleted dead `src/optics/` and `src/world/` TypeScript wrappers
- [x] Unified SessionData — single definition in SessionManager.ts with production goal and tile job support
- [x] Documentation sync — fixed strategy count, gl_FragData references, ParameterManager description, SessionData interface, source file map
