# Debug / Analysis Layer Specification

A unified, opt-in system for visual diagnostics that replaces normal output without changing scene/transport semantics. This consolidates scattered debug features into a single switchboard.

---

## 1) Goals & Principles

- **Single entry point**: choose what to visualize in one place.
- **Non-invasive**: does not change transport; only affects what is written to Film/Screen.
- **Deterministic**: same seed + parameters → same analysis image.
- **Fast**: avoid triggering accumulation resets unless required by the mode.

---

## 2) Ownership & API

- **Coordinator**: owns the current `analysisMode` setting and determines whether accumulation should reset when the mode changes.
- **Developer**: implements final mapping and colorization (e.g., zebras/false color). Some modes may bypass tone mapping.
- **Estimator/Film**: expose optional hooks to supply intermediate buffers (normals, variance).

### Public surface
```ts
type AnalysisMode =
  | 'off'
  | 'normals'        // world-space or view-space
  | 'depth'          // linear or log
  | 'material_id'    // discrete palette
  | 'albedo'         // base color; no lighting
  | 'n_dot_l'        // quick diffuse with single key light
  | 'variance'       // per-pixel variance estimate
  | 'zebras'         // highlight over/under-exposure
  | 'false_color'    // tone mapping inspection
  | 'heat_pdf'       // sampling pdf diagnostics (estimator)
  | 'paths'          // coarse path length or rr stats
```

```ts
// Coordinator API
coordinator.setAnalysisMode(mode: AnalysisMode): void;
coordinator.getAnalysisMode(): AnalysisMode;
```

---

## 3) Data Sources & Minimal Contracts

- **Normals**: estimator exposes current shaded normal; or Scene recomputes from hit.
- **Depth**: estimator returns ray parameter `t` at first hit; Geometry may apply metric scaling.
- **Material ID**: Scene provides integer label; Developer maps to palette.
- **Albedo**: material base color (no lighting).
- **Variance**: Film provides incremental variance; rendered as heatmap with optional legend.
- **Zebras**: Developer thresholds in HDR linear before tone mapping (e.g., ±1 stop bands).
- **False color**: Developer applies known operator visualization (ACES curve, log luminance bands).
- **Heat PDF**: Estimator attaches last-sample pdf or MIS weight as scalar for visualization.
- **Paths**: Estimator reports per-pixel path length or rr survival rate bins.

All are **optional**; if not available, Developer falls back to `off` with a warning badge.

---

## 4) Accumulation Rules by Mode

- Modes that **must bypass accumulation** (write direct): `normals`, `material_id`, `depth`, `false_color`, `zebras`, `heat_pdf`, `paths`.
- Modes that **may accumulate**: `albedo` (stable), `variance` (drawn from Film’s variance buffer).
- Switching **to/from** bypass modes triggers `resetAccumulation()` to avoid mixing statistics.

---

## 5) Colorization Guidelines

- **Normals**: map [-1,1] to [0,1] per component; optional orientation legend.
- **Depth**: linear with near/far; or log-scale with clamp; display legend.
- **Material ID**: stable, documented palette for reproducible debugging.
- **Variance/Heat**: perceptual colormap; annotate min/max; optional percentile clamps.
- **Zebras**: alternate bands at 1 EV steps; configurable thresholds.
- **False color**: fixed palette; include tick marks for EV/scene-referred levels.

---

## 6) Performance Notes

- Prefer reading from already-available intermediates (e.g., first-hit `t`, normal) rather than re-tracing.
- Keep the path the same; only replace the final write. Avoid branching in hot loops—select mode at compile-time if possible.

---

## 7) UI/UX

- Single dropdown or hotkey cycle for `analysisMode`.
- Persistent status badge (mode name + hints).
- Optional legend overlay with units (depth meters/log base, variance scale, EV stops).