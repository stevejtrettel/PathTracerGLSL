# RenderCoordinator — State Machine
_Formal lifecycle for interactive, progressive, and production runs_

This document defines the Coordinator’s states, transitions, and responsibilities, including accumulation policy and event emission.

---

## States & Diagram

```
          ┌──────────────────────┐
          │         Idle         │
          └───┬───────────┬──────┘
              │ start()    │ start(mode=production)
              ▼            ▼
   ┌─────────────────┐  ┌────────────────────┐
   │ RunningInteractive│ │ RunningProduction │
   └─────┬────────────┘  └───────────┬───────┘
         │ mode=progressive          │ tileDone/nextTile
         ▼                           ▼
   ┌─────────────────┐        ┌──────────────┐
   │ RunningProgressive│      │   Stopping   │
   └──────────┬────────┘      └──────┬───────┘
              │ stop() / fatal        │ stopped
              ▼                       ▼
          ┌──────────────────────┐
          │         Idle         │
          └──────────────────────┘
```

---

## Transitions (summary)

- **Idle → RunningInteractive**: `start('interactive')`
- **Idle → RunningProgressive**: `start('progressive')` (resets accumulation)
- **Idle → RunningProduction**: `start('production', tiles, quota)`
- **Running* → Stopping**: `stop()` or fatal error
- **Stopping → Idle**: after in-flight frame/tiling completes
- **RunningInteractive ↔ RunningProgressive**: `setMode()` (may reset accumulation)
- **RunningProduction**: internal `nextTile()` until complete or `stop()`

---

## Responsibilities by State

### RunningInteractive
- Render **one frame per tick**, no accumulation (or a lightweight preview accumulator).
- Throttle to vsync or target FPS.
- Parameter changes: update uniforms; **no reset** (unless preview accumulator in use).

### RunningProgressive
- Reset accumulation on entry.
- Per frame: render **one sample** (or K spp), increment `sampleCount`, emit `render.progress(sampleCount)`.
- Stop on `targetSamples` or `converged(variance)`.

### RunningProduction
- Partition into tiles; per tile:
  - Reset accumulation; render until quota reached.
  - Readback tile; emit `tile.complete(index)`; proceed to next.
- On fatal: keep completed tiles; expose `canResume`.

---

## Accumulation Reset Policy

- **Reset on**: changes to `camera.*`, `estimator.*`, `scene.*`, `material.*`, `lights.*`, `geometry.*`, `analysisMode` (if bypass), and any define that changes ProgramKey.
- **Do not reset on**: `developer.*` (tone mapping), window size (if film is resolution-independent preview), UI-only toggles.
- **Tile boundaries**: progressive stats **do not carry** across tiles.

> Policy is centralized here; ParameterStore changes **do not** auto-reset — they notify Coordinator, which decides.

---

## Events

- `recipe.switched(name)`
- `render.start(mode)`
- `render.progress(samplesOrTile)`
- `render.complete()`
- `accumulation.reset()`
- `render.error(payload)`
- `tile.complete({index, rect})` (production)

---

## Pseudo-code (progressive)

```ts
async function startProgressive(targetSamples?: number) {
  this.sampleCount = 0;
  this.emit('accumulation.reset');
  this.engine.resourceManager.ensureFilm(true);
  while (this.running) {
    this.engine.uniformBinder.frameUpdate();
    this.engine.renderExecutor.drawFullScreenTriangle();
    this.sampleCount++;
    this.emit('render.progress', this.sampleCount);
    if (targetSamples && this.sampleCount >= targetSamples) break;
    await nextAnimationFrame();
  }
  this.emit('render.complete');
}
```

---

## Fatal Error Handling

- On Engine fatal: enter **Stopping**, emit `render.error`, stop after the in-flight frame/tile; if in production mode and checkpoints exist, set `canResume=true`.
- Recoverable: remain in current state, increment warning counters, surface toast/log via App.

---

## Mode Changes

- `setMode('interactive'|'progressive'|'production')` from any Running state:
  - If switching **to progressive** → call `resetAccumulation()`.
  - If switching **to production** → finalize current frame; initialize tiler; go `RunningProduction`.
  - If switching **to interactive** → stop accumulating; continue frames.

---

## Testing Checklist

- [ ] Changing `developer.exposure` does **not** reset in progressive
- [ ] Changing `camera.fov` **does** reset
- [ ] Switching analysis mode to `normals` resets; back to `off` resets again
- [ ] Production saves finished tiles on fatal and reports `canResume`
- [ ] ProgramKey change triggers recompilation and implicit reset