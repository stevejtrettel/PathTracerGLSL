# UniformBinder — Mapping Example & Diagnostics
_Making GPU state updates auditable_

This document shows a concrete mapping from **parameter paths** to **GLSL uniforms**, includes a sample runtime dump, and lists diagnostics for missing/extra bindings.

---

## Naming Rules (summary)

- All GLSL uniforms start with `u_` and include the **kind prefix**:
  - `u_c_*` (Camera), `u_e_*` (Estimator), `u_f_*` (Film), `u_d_*` (Developer),
  - `u_sc_*` (Scene), `u_m_*` (Material), `u_l_*` (Lights), `u_g_*` (Geometry).
- Engine/system uniforms:
  - `u_resolution`, `u_aspect`, `u_time`, `u_frame_index`, `u_sample_count`.
- Parameters map to uniforms via descriptor metadata; arrays use `[i]` where applicable.

---

## Example Parameter Set

```json
{
  "camera.position": [0,2,5],
  "camera.target": [0,0,0],
  "camera.fov": 45,
  "estimator.maxBounces": 5,
  "material.lambert.albedo": [0.8, 0.2, 0.2],
  "developer.exposure": 0.0
}
```

---

## Example Mapping Table

| Parameter Path | GLSL Uniform | Type | Location |
|---|---|---|---|
| `camera.position` | `u_c_pinhole_pos` | `vec3` | 5 |
| `camera.target` | `u_c_pinhole_target` | `vec3` | 6 |
| `camera.fov` | `u_c_pinhole_tan_fov` | `float` | 7 |
| `estimator.maxBounces` | `u_e_common_max_bounces` | `int` | 12 |
| `material.lambert.albedo` | `u_m_lambert_albedo` | `vec3` | 20 |
| `developer.exposure` | `u_d_exposure` | `float` | 31 |
| (engine) | `u_resolution` | `vec2` | 0 |
| (engine) | `u_aspect` | `float` | 1 |
| (engine) | `u_frame_index` | `int` | 2 |
| (engine) | `u_sample_count` | `int` | 3 |

> **Note**: `camera.fov` is compiled to `tan(fov/2)` for efficient ray gen; the binder performs this transform at set-time (documented in camera descriptor).

---

## Runtime Dump (text example)

```
ProgramKey: PT:Euclidean|SDFScene|Lambert|Env|Pinhole|Direct|SimpleAvg|ACES|A0|DProto1
UniformMap (locations cached):
  [ 0] u_resolution              vec2   ← engine
  [ 1] u_aspect                  float  ← engine
  [ 2] u_frame_index             int    ← engine
  [ 3] u_sample_count            int    ← engine
  [ 5] u_c_pinhole_pos           vec3   ← camera.position = (0,2,5)
  [ 6] u_c_pinhole_target        vec3   ← camera.target   = (0,0,0)
  [ 7] u_c_pinhole_tan_fov       float  ← camera.fov      = 45° → tan(22.5°)=0.41421
 [12] u_e_common_max_bounces     int    ← estimator.maxBounces = 5
 [20] u_m_lambert_albedo         vec3   ← material.lambert.albedo = (0.8,0.2,0.2)
 [31] u_d_exposure               float  ← developer.exposure = 0.0
```

- Locations are driver-assigned, cached per ProgramKey.
- Engine prints this dump in **dev builds** on first successful link.

---

## Batched Updates

The binder collects parameter changes during a frame and **flushes once** before draw:

```ts
const pending = [
  {path:"developer.exposure", value:0.5},
  {path:"camera.position",    value:[0,2.2,5]}
];
binder.flush(pending);
// → glUniform1f(loc[u_d_exposure], 0.5)
// → glUniform3f(loc[u_c_pinhole_pos], 0,2.2,5)
```

Transforms (like `tan(fov/2)`) are applied at set-time before upload.

---

## Diagnostics

- **Missing binding (required)** → fatal at link time (list path, expected uniform).
- **Missing binding (optional)** → warn once (dev).
- **Unused uniform** → warn (dev) with suggestion to remove or guard by defines.
- **Type mismatch** → fatal with path, expected vs found.
- **Near-miss name** → suggest closest parameter path (Levenshtein) in the warning.
- **Redundant updates** → binder coalesces identical values per frame (no GL call).

---

## Tips

- Keep a **UniformMap panel** in UI to audit live values.
- For binary search of regressions, dump the map alongside the **ProgramKey** and shader hash in logs.
- Use **stable prefixing** so diffs are readable across builds.