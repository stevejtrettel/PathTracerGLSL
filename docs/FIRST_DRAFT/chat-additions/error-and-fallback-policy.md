# Error & Fallback Policy

This document defines how errors are classified, surfaced, and handled across **Engine**, **RenderCoordinator**, and **App**, plus GPU capability fallbacks. It aims for predictable behavior during research and production.

---

## 1) Classification

### Fatal
- **Examples**: Shader compile/link failure; missing required module function; invalid film manifest; out-of-memory; unsupported essential extension.
- **Behavior**: Abort the current render; emit error event; preserve diagnostic artifacts (shader sources, logs).

### Recoverable
- **Examples**: Unknown parameter path (ignored); missing optional uniform; parameter value out of range (clamped); module version mismatch with compatible fallback; mild texture format mismatch with acceptable substitute.
- **Behavior**: Log warning (rate-limited); substitute default/fallback; continue rendering.

### Research
- **Examples**: NaN/INF radiance, negative PDF, invalid BRDF value from experimental code.
- **Behavior**: Sanitize sample to black; increment counters; optionally paint a debug overlay in analysis mode; continue.

---

## 2) Propagation & Surfacing

1. **Engine** detects → constructs structured error/warning with context:
   - `phase`: `compile|link|resource|render|readback`
   - `module`: kind/name (if applicable)
   - `message`, `glError`/`lines`, `suggestions`
2. **RenderCoordinator** receives:
   - Fatal → stops run, emits `render.error` event, sets `canResume` if checkpoints exist.
   - Recoverable/Research → increments counters, may trigger `render.warning`.
3. **App / Extensions**:
   - Subscribe to events; display toast/log panel; attach artifacts (shader source, uniform map, film manifest).

**Guideline**: Never throw raw strings; always structured payloads with phase + actionable suggestions.

---

## 3) GPU Capability Fallbacks

Order of preference (try next when unavailable):

- **HDR color**: `RGBA16F` → `RGBA11F`/`RGB10A2` → `RGBA8` (LDR)
- **Linear filtering for float**: `EXT_color_buffer_float` + `OES_texture_float_linear` → nearest only → LDR
- **Storage size pressure**: full-res persistent film → half-res (with upscale) → interactive-only (no persistence)
- **MSAA**: enabled → disabled (prefer accumulation over MSAA)
- **Compute**: if future backends differ, prefer fragment path tracer fallback

**Policy**: Log a single **capability report** at startup with chosen formats and any fallbacks.

---

## 4) Defaults & Clamping

- Parameters with metadata are clamped at **ParameterStore** boundary. On violation:
  - Clamp to nearest valid value
  - Record the clamp in a diagnostic log (path, from→to, first occurrence only)
- Unknown parameters: log once; ignore silently afterward (until next session/dev build).

---

## 5) Research Error Counters

- **NaN/INF radiance** count
- **Negative/zero PDF used** count
- **Invalid BSDF/phase value** count
- **Shadow ray self-intersections** count

Expose counters via Coordinator stats and Analysis overlays.

---

## 6) Resume & Checkpoints (Production)

- On fatal during **tiled production**, if tile N has a saved checkpoint, set `canResume=true` and expose `resumeFrom(tileN)` to the App/Extension.
- Partial outputs are retained; final stitching requires all tiles complete.

---

## 7) Examples (Behavior Cheatsheet)

| Scenario | Class | Action |
|---|---|---|
| GLSL syntax error in Material | Fatal | Abort, show compiler log, dump offending source with line maps |
| Missing `sample_light` in Lights | Fatal | Abort, show module descriptor + required functions |
| Unknown param `camera.fvv` | Recoverable | Warn once, ignore path |
| `camera.fov = 220` | Recoverable | Clamp to 170, note clamp |
| `pdf_light = 0` while contributing | Research | Sanitize, increment counter, show analysis overlay marker |
| No `EXT_color_buffer_float` | Recoverable | Switch to `RGBA8` LDR, log capability fallback |