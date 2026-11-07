# App UI, extensions, layout, pages — area map

Read-only survey, 2026-11-06, branch `claudeapp` (HEAD 8a101b6). Every claim below was read in
code unless marked *inferred*. Line numbers are at that commit.

## 1. What is in the area (line counts)

| Path | Lines | What it is |
|---|---|---|
| `index.html` | 12 | Loads `pages/suite.ts` (the scene gallery, landing page). |
| `lab.html` | 11 | Loads `pages/scene-lab.ts` (renders one suite scene). |
| `pages/registry.ts` | 28 | Merges `witnessSuite` (tests/witnesses) + `demoSuite` (demos/) for display; throws on id collision; `DEFAULT_SCENE='two-light'`. |
| `pages/sections.ts` | 204 | Gallery taxonomy: every registry id filed in one section; guard throws if an id is missing/duplicated. |
| `pages/suite.ts` | 157 | Static gallery page (inline CSS, `<details>` rows linking `lab.html?scene=<id>`). |
| `pages/scene-lab.ts` | 118 | The only real "program": `App.create` → `initialize` → `app.use(...6 extensions)` → `start`; exposes `window.app`, registries, and `__witnessDigest` for tools/witness.mjs; `?witness` skips `start()`. |
| `src/app/extensions/index.ts` | 11 | Barrel. |
| `src/app/extensions/UIExtension.ts` | 166 | Abstract base for DOM extensions: region mount (or body + `.standalone` class without a layout), show/hide/toggle via a `hidden` class, auto-unsubscribed bus listeners. |
| `src/app/extensions/OrbitControls.ts` | 235 | Mouse/touch orbit; private spherical state (distance/azimuth/elevation/target); writes `camera.position`+`camera.target` in one batch; emits `camera.moved`; save/restore state. |
| `src/app/extensions/KeyboardControls.ts` | 386 | 6-DOF fly camera (arrows, WASD, G, Shift/Ctrl); private position+Frame; own rAF loop. **Not installed by any page.** |
| `src/app/extensions/AppShortcutsExtension.ts` | 164 | Window keydown: 1-9 renderer, r reset, Space start/stop, `\` pause, p → emits `production.dialogRequested`, Esc stop, x/X save, m picture cycle, j/o session save/load. |
| `src/app/extensions/StatsPanel.ts` | 150 | region-left; 100 ms `setInterval` polling `app.getStats()`; own `i` key; hides on production start. |
| `src/app/extensions/ParameterPanelExtension.ts` | 312 | region-right slide-in panel; widgets built from `app.getParameterMetadata()` via WidgetFactory, grouped by `meta.group`; own Tab key (capture phase on window); 16 ms throttled `setParameter`; rebuilds on `renderer.switched`; disabled during production. |
| `src/app/extensions/RenderControlsExtension.ts` | 223 | Hidden placeholder root in region-overlay; shows the production setup Modal (on `production.dialogRequested`) and a "Render Complete" Modal (on `render.complete`). |
| `src/app/extensions/ProductionPanelExtension.ts` | 405 | region-statusbar progress bar, ETA, tile grid, Pause/Resume/Cancel, Export PNG/HDR/Close on completion. |
| `src/app/layout/AppLayout.ts` | 186 | Creates 6 region divs (`canvas-container`, `region-left/right/toolbar/statusbar/overlay`), sets `data-layout` on the root, CSS variables. |
| `src/app/layout/index.ts` | 47 | Barrel + usage doc. |
| `src/app/layout/layouts.css` | 328 | 4 modes: fullscreen, centered, editor, split; global reset under `[data-layout]`. |
| `src/app/ui/` (core 3 + containers 4 + inputs 9 + WidgetFactory + ErrorOverlay + index) | ~1,900 TS | A small retained-mode widget toolkit (UIComponent → Container/Input; Panel, Folder, Window, Modal; Slider, Checkbox, NumberInput, ColorPicker, HdrColorInput, VectorInput, Dropdown, Button, TextInput). `WidgetFactory.createWidget(meta, {value,onChange})` maps compiler `ParameterMetadata` to a widget. |
| `src/app/ui/ErrorOverlay.ts` | 282 | Full-screen diagnostic overlay; App constructs it on `document.body`. |
| `src/app/ui/styles/*.css` | theme 108, components 727, extensions 471 | `components.css` `@import`s theme.css AND extensions.css (styles of the App extensions). |

Neighbours used: `App.ts` (968 lines; `use/unuse/getExtension` 869–906, layout 909–929, `create` 145–161),
`app/types.ts` (Extension interface 81–92, SessionData 109–120), `app/events.ts` (event names, the
`shouldResetAccumulation` fallback), `app/EventBus.ts`, `ProductionOrchestrator.ts` (switches layout
mode to `centered` during production, 198–210), `utils/dom.ts` (`isTypingInInput`),
`utils/EventManager.ts`, `compiler/types.ts` (`ParameterMetadata` 823–846, reserved paths 815),
`compiler/generate/features/camera.ts` (declares `camera.position/target` parameters, 129–130),
`components/camera/basis.ts` (look-at frame on the CPU).

## 2. What an "extension" is

`Extension` (src/app/types.ts:81-92):

```ts
interface Extension { name; version?; description?; dependencies?: string[];
  install(app: App, bus: EventBus): void; uninstall?(): void;
  saveState?(): unknown; restoreState?(state: unknown): void; }
```

Registration: `app.use(ext)` (App.ts:869-891) — refuses a duplicate name (warn), throws if a
declared dependency isn't installed, calls `install(this, eventBus)`, stores it in a
`Map<name, Extension>`, logs, emits `extension.installed`. `unuse(name)` calls `uninstall` and emits
`extension.uninstalled`. `dispose()` uninstalls all. Sessions: `_buildSessionState` collects
`saveState()` of every extension under `session.extensions[name]`; `restoreSession` restores
parameters, then the renderer, then each extension's `restoreState`.

What an extension can touch: everything. It receives the full App facade (~90 public methods:
parameters, renderer selection, start/stop, production, tiled, save, session, layout regions, canvas)
plus the raw EventBus, and in practice also `window`/`document` (window keydown listeners, `document.body`
mounts). There is no narrower interface.

Who uses the plugin features (full-repo greps):
- `dependencies`: no extension declares any.
- `version`/`description`: only logged.
- `unuse`, `getExtension`, `getExtensionNames`, `getEventBus`: no callers outside App
  (docs/production-rendering.md:247 shows `getExtension` as an example).
- `extension.installed` / `extension.uninstalled` events: emitted, no listeners.
- `saveState/restoreState`: only OrbitControls and KeyboardControls (camera pose copies).
- `camera.moved`: emitted by both camera controls, no listeners.

So the "extension system" is effectively: six UI/input modules that one page installs together,
communicating through App calls and four bus events (`render.*`, `renderer.switched`,
`production.dialogRequested`, `tiledJob.*`).

## 3. How each concern is wired

**Panels.** UIExtension subclasses choose a `region`; `mount()` appends root to
`app.getRegion(region)` if the App has a layout, else to `document.body` with class `standalone`.
ParameterPanel overrides mount (adds `param-panel-region` to the region; open/close via `.open` on the
region). Visibility = a `hidden` class; only `.production-panel.hidden` has a CSS rule.

**Controls (parameter panel).** Compiler → `CompiledRenderer.parameters` (`ParameterMetadata`:
type, default, range/step/values/options, name/group/unit/help, hdr, triggersReset) →
`RendererManager.getParameterMetadata()` → panel groups by `meta.group` in first-appearance order →
`WidgetFactory.createWidget` → `onChange` → throttled `app.setParameter` → ParameterStore.onChange
(App.ts:97) → engine.setParameter + `parameter.changed` + one accumulation reset per changeset
(reset decided by `meta.triggersReset`, else the prefix fallback `shouldResetAccumulation`).
The panel reads values only at build time; it rebuilds on `renderer.switched` only.

**Shortcuts / keyboard.** Five independent window/document keydown listeners:
AppShortcuts (1-9 r Space \ p Esc x X m j o), StatsPanel (i), ParameterPanel (Tab, capture phase,
stopPropagation), KeyboardControls (codes: arrows, numpad, Quote, Slash, KeyW/A/S/D/G, Shift, Ctrl),
ErrorOverlay (Escape, document). Each filters typing via `isTypingInInput` (except ParameterPanel and
ErrorOverlay). No central keymap; collisions are undetected (Escape both stops the render and closes
the error overlay).

**Orbit.** OrbitControls reads `camera.target/position` once at install (App.getParameter falls back to
compiled metadata default), keeps spherical coords around a target in R³, clamps elevation to ±(π/2−0.1),
writes both params in one `setParameters` batch per input tick. It never listens for outside pose changes.

**Production flow** (five pieces cooperating via events): `p` key → AppShortcuts emits
`production.dialogRequested` → RenderControls Modal (samples, resolution preset/custom, tiles) →
`app.renderProduction(..., save:[radiance png], autoSave:true)` or `app.renderTiled(...)` →
ProductionOrchestrator locks params, switches layout to `centered`, resizes → ProductionPanel shows
progress (status bar); StatsPanel hides; ParameterPanel disables → on complete ProductionPanel offers
Export PNG/HDR/Close AND RenderControls opens a "Render Complete" Modal (Return to Interactive / Extend).

**Errors.** App constructor builds an ErrorOverlay on `document.body`; App shows it on compile/runtime
errors itself (not an extension).

## 4. How a standalone program (for the website) is assembled today

There is no build target for it: `vite.config.ts` builds only `index.html` and `lab.html`
(`rollupOptions.input: { suite, lab }`). The recipe is the README / scene-lab pattern:

```ts
const app = App.create(document.body, { layout: 'fullscreen' });
await app.initialize({ scene, strategies, initialParameters });
app.use(new OrbitControls()); app.use(new StatsPanel()); app.use(new ParameterPanelExtension());
app.use(new ProductionPanelExtension()); app.use(new RenderControlsExtension()); app.use(new AppShortcutsExtension());
app.start();
```

What that program would carry today (consequences for embedding, mostly *inferred* from code/CSS):
- `AppLayout` sets `data-layout` on the container and `layouts.css` applies a margin/padding reset to
  every descendant of `[data-layout]`, `overflow:hidden; min-height:100vh`, and fullscreen mode uses
  `position: fixed; inset: 0` for the canvas: it takes over the page; it cannot sit inside an article.
- Window-level keys: Space `preventDefault` (page scroll), Tab captured on window (page focus
  navigation) — host-page keyboard is hijacked.
- The canvas pixel size is set once (App constructor `clientWidth || innerWidth`); nothing listens for
  window resize (`resizeToWindow` exists, no caller).
- ErrorOverlay always mounts on `document.body`.
- All test-only wiring (`window.app`, `__witnessDigest`, registry) lives in scene-lab.ts, so a
  program copies 10 lines, not the lab.
The goal of "independent programs that keep their own code version" (docs/claude-app-decisions.md)
has no mechanism yet (in-progress).

## 5. Findings (summary — full evidence in the structured result)

Defects (read, not run):
1. StatsPanel `hide()` adds `hidden`, but no CSS rule hides `.stats-panel.hidden` (only
   `.production-panel.hidden`, extensions.css:94). `updateDisplay` returns when hidden
   (StatsPanel.ts:92) → `i` and production start freeze the panel instead of hiding it.
2. KeyboardControls: ArrowUp sets `move[2] -= 1` (line 237); `localToWorld` maps local z to
   `frame.forward` (358-360), and `forward` is the view direction (target = position + 5·forward,
   291-295) → "↑ forward" moves backward. Extension not installed anywhere; owner planned a fresh
   navigation design (impl-plan-engine-app E8).
3. Parameter panel never refreshes widget values after construction (no `parameter.changed`
   subscription) → after an orbit drag the Camera Position/Target fields show stale numbers; same after
   session restore unless the renderer switches.
4. Camera pose has three owners: ParameterStore (`camera.position/target`), OrbitControls' spherical
   state, KeyboardControls' frame. Orbit never re-reads params, so a value typed in the panel is
   overwritten on the next drag; the session stores the pose twice and `restoreSession` applies the
   orbit copy last (App.ts:600-618), so a typed pose saved to a session restores as the stale orbit pose.
5. Two completion UIs for one production render (ProductionPanel export buttons + RenderControls modal).
6. Production's `centered` layout shows the canvas in a CSS box with `aspect-ratio: var(--layout-canvas-aspect, 16/9)`
   (layouts.css:137) and canvas `width/height:100%` (44-45); nothing sets the variable → non-16:9
   renders are displayed stretched (*inferred*; saved files unaffected).

Tangles / complexity:
- Plugin machinery (name/version/dependencies/unuse/events/getExtension) with no consumers; six
  modules installed together by one page.
- Two mount paths per UI extension (region vs `.standalone`), duplicated CSS for each. The no-layout
  `new App(canvas)` path is planned for the OIDN test page (docs/claude-oidn-test-plan.md:200) —
  in-progress, not dead.
- Production presentation decided inside the app core (ProductionOrchestrator switches layout mode).
- Keymap scattered across five listeners.
- UI toolkit claims to be standalone but `components.css` imports `extensions.css` (App extension styles).
- ~110 lines of `.render-controls-toolbar` CSS style an element nothing creates; RenderControls'
  header (lines 1-13) still describes a toolbar.
- `sortGroups` is an identity function kept with a comment (ParameterPanel 235-246).
- Hard-coded picture name `'radiance'` in x/X/Export HDR/dialog save lists while App exposes
  `getPictures()[0]` as the main picture.

Guesses (owner forbids):
- `shouldResetAccumulation` prefix fallback for metadata-less paths (events.ts:63-67; App.ts:406-412);
  unknown paths default to "reset".
- HdrColorInput intensity ceiling `max(4×initial, 1)` when the compiler declares no range (HdrColorInput.ts:36).
- WidgetFactory `default:` falls back to NumberInput with a warning (WidgetFactory.ts:156-163).
- ParameterPanel adapts a scalar value for a `color`-typed parameter (247-258): the declared type doesn't
  fix the value shape.

Euclidean assumptions (block curved spaces):
- The App-side camera contract is position + target with world-up; Orbit = spherical coords in R³;
  Keyboard = vector addition; `components/camera/basis.ts` cross products. The ambient registry is
  GLSL-only (`AmbientDescriptor { type, glsl }`), so there is no CPU-side geometry for controls to call.

In-progress / scaffolding (keep):
- KeyboardControls (fresh nav system planned), `Window`, `TextInput`, layout modes `editor`/`split`,
  `showRegion/hideRegion/setVariables`, the no-layout path, `ParameterMetadata.unit/help` (unit set only
  by blackbody Kelvin, never displayed), `camera.frame` reservation (comment in compiler/types.ts:809-811
  still describes a ParameterStore coercion that was deleted — doc mismatch).

Docs vs code:
- README says App is "~400 lines" (968). RenderControls header describes a toolbar. compiler/types.ts
  comment on camera.frame coercion. docs/production-rendering.md / layout-system.md describe the plugin
  and layout surface as the intended API (worth re-reading before any change).

## 6. Witness/tool coupling

tools/witness*.mjs drive `window.app` only through App methods (readExport, stop, selectRendererByStrategy,
pinResetSalt, resize, renderProduction, renderTiled, save, capture, initialize, getPictures, getStats,
saveSession/restoreSession, setParameters...). No tool touches an extension. `?witness` skips `start()`.
So reworking the extension/UI layer does not affect the numeric gate, as long as lab.html still exposes
`window.app` before `start()` and `__witnessDigest`.
