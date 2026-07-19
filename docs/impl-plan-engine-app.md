# impl-plan-engine-app — the engine/app pass (audit front 5)

**ALL BATCHES BUILT Jul 19 2026** — tsc clean, 1036 vitest, and 6/6 HEADLESS-LAB runtime
checks (SwiftShader): no prefix warnings on HDR scenes (E4), renderLdr through the shipped
ldrRecipe returns real bytes (E5), ONE reset per batched pose write (E3 — the runtime
probe caught that App's onChange also requested per-CHANGE resets inside a batch; hoisted
to per-changeset), the chroma×intensity widget renders for driven emissions (E2), no page
errors. Snapshot churn: exactly `"hdr": true` ×3 on radiometric parameter records.
Witness sweep = owner's (E6's relocation is byte-identical math — same arrays, new home).

Owner-decided Jul 19 2026, item by item (docs/fable-audit-2026-07-18.md front 5). The
theme: the app/engine layer drifted behind the architecture — this pass fixes what BROKE,
re-blinds the engine, and finishes the derived-value story's runtime half.

## Batches

**E1 — production render fix.** `App.exportAllAOVs` on an empty AOV set becomes a no-op
with a log, never a throw; the P-dialog flow completes (render → PNG → autoSave) on every
standard renderer.

**E2 — the HDR color widget (owner-picked interface: hue swatch × brightness slider).**
Radiometric parameters stop being LDR swatches: metadata distinguishes radiometric colors;
the panel renders a chroma swatch (normalized, always in-gamut, safe to touch) + an
unbounded intensity slider; the stored value is their product (chroma = v/maxc, intensity
= maxc). Touching the swatch can no longer clamp a 40 to 1.
*Ledgered follow-up (owner):* blackbody lamp authoring — a color-TEMPERATURE slider +
brightness, kelvin → chroma via the Planck locus as a DERIVED CPU precompute (the
materials/lights derived-rail pattern; no GPU trig).

**E3 — one reset per input.** OrbitControls/KeyboardControls write pose via
`ParameterStore.batch` — one onChange, one accumulation reset per tick.

**E4 — one prefix vocabulary.** `app/events.ts` imports the compiler's
`RESERVED_PARAM_PREFIXES`; the drifted private list (`developer.`/`scene.`/… missing
`env.`) dies; the spurious env.size warn dies with it. *(Owner note: the whole app-side
parameter plumbing gets a dedicated UX sweep later — this is the minimal correctness cut.)*

**E5 — the engine goes blind again (LOCKED-contract extension, owner-approved).**
`CompiledRenderer` gains an `ldr` recipe — `{ passId, inputs, output }` — emitted by the
compiler (PipelineBuilder knows its own names); `Engine.renderLdr` consumes it as data.
The four memorized names (`display-pass`/`u_radiance`/`accumulation_previous`/`ldr`)
leave the engine. docs/compiler-engine-contract.md records the extension.

**E6 — estimator math leaves the engine.** The env importance-table construction
(luminance, NEE blur, MIS compensation, per-chart Jacobian, CDFs) moves to
`components/env/` beside the chart GLSL it must mirror (the octahedral-twin precedent);
the engine loader keeps only texture upload/registration and takes extern NAMES as
arguments (the compiler/app own naming). Pure relocation of GPU-verified code — the
witness sweep is the gate.

**E7 — recompute-on-change (the scaling-cliff fix, owner: "absolutely").**
ParameterManager stops running every compute closure every frame: each binding snapshots
its input values (parameterPaths, incl. engine builtins); the per-frame pass recomputes a
closure only when an input actually changed. Cheap scalar compares replace unconditional
closure runs; camera basis/CDF/majorant closures run on pose/slider/resize changes only.

**E8 — roll deleted.** Q/E and the keyboard extension's private frame state go; pose
stays position/target. *Ledgered follow-up (owner): a real keyboard NAVIGATION system
designed fresh to complement OrbitControls.*

**E9 — recompile leak.** `RendererManager.recompile` diffs old vs new renderer ids and
unloads the stale ones (engine + GPU buffers); the 1–9 keys stay stable.

**E10 — panel order is compiler-owned.** The dead-architecture `GROUP_ORDER` list dies;
groups render in FIRST-APPEARANCE order of the compiled parameter record (the compiler's
feature order IS the ordering — no new metadata field needed).

**E11 — lint, carefully (owner: "we are building still").**
DELETE (obsolete-by-architecture): the `camera.frame` restore coercion (dropped concept);
`cycleDisplayMode` + its M-key + `RENDERER_DISPLAY_MODE` constant (AOV-era, probes params
nothing emits); `cacheUniformLocations` (duplicate of the executor's WeakMap cache); the
stale engine comments (scene.metallic, TextureRegistry bind()).
FIX: `engine/types.ts` re-exports the REAL four-state EngineState.
KEEP (future-reserved, documented as such): `engine.time` injection (motion-blur's
Category-B seed field — impl-plan-cameras deferral); unlistened public events;
`Engine.getParameter` API surface; TiledRenderer (E12).

**E12 — TiledRenderer stays (owner: KEY to the architecture — poster-scale output) and
its tiles get the reproducibility stamp** every other export path already carries
(`saveTile` threads `buildRenderStamp`).

## Gates
tsc + full vitest per batch cluster; the headless lab (verify skill) checks the app-side
fixes (P-dialog flow, panel rendering, HDR widget round-trip); owner witness sweep once
at pass end (E6 relocation is its sharpest customer — byte-identical tables expected).
