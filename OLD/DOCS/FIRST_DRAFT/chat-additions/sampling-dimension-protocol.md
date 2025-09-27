# Sampling Dimension Protocol

A deterministic allocation of quasi-random (or pseudorandom) **dimensions** to subsystems so that **same seed + same recipe → identical images**. This avoids interference between camera jitter, DOF, light sampling, BSDF sampling, medium events, and Russian roulette.

---

## 1) Goals

- **Determinism**: Changing one sampler’s usage doesn’t reshuffle others.
- **Extensibility**: New estimators or features can claim their own dimension ranges.
- **Simplicity**: Typical estimators have a clear, documented dimension budget.

We index dimensions from **0,1,2,…** for each pixel-sample. A *dimension* is one independent `U[0,1)` variate (or pair).

---

## 2) Global Reservation

| Range (inclusive) | Owner | Usage |
|---|---|---|
| 0–1 | **Camera** | Subpixel jitter (AA), lens/DOF (or time/MoBlur) |
| 2–31 | **Estimator (Surface segment)** | Per-bounce allocation (NEE, BSDF, RR, light pick) |
| 32–63 | **Estimator (Medium segment)** | Free-flight, phase sample, medium selection, RR |
| 64–95 | **Lights (env/area)** | Hierarchical env CDFs, portal selection |
| 96–127 | **Spare / Future** | BI-PT, MLT seeds, SPPM, spectral |
| 128+ | **Local sequences** | Estimator-defined expansions (documented per algorithm) |

**Principle**: Camera never consumes beyond dim 1. Estimator owns the rest by convention.

---

## 3) Per-Bounce Budget (Surface Transport)

For bounce index `b = 0,1,2,...` (0 = camera hit):

```
dim = 2 + 4*b
dim+0 : Light selection (discrete) for NEE
dim+1 : Light sample (2D) — position/dir on light/env
dim+2 : BSDF sample (2D) — hemisphere/sample space
dim+3 : Russian roulette (scalar)
```

- If a step is unused (e.g., direct-only), still **advance** the dimension to keep alignment.
- MIS variants may consume additional dims; document them under §6.

---

## 4) Media Budget (Participating Media)

For **each medium interaction** index `m = 0,1,2,...`:

```
base = 32 + 4*m
base+0 : Free-flight distance (inversion or delta tracking)
base+1 : Phase sample (2D)
base+2 : Medium selection / albedo jitter (if multi-medium)
base+3 : Russian roulette for medium continuation
```

- When outside media, these dims are untouched and reserved.

---

## 5) Light Hierarchies & Env Maps

- **Discrete light pick** uses the per-bounce `dim+0` slot.
- **Environment** with hierarchical CDFs uses dims in **64–95** (e.g., 64–67 for row/column picks and importance map jitter) so that changing the number of lights or the env map resolution doesn’t disturb surface/medium alignment.

Example:
```
64 : env row pick
65 : env row jitter
66 : env col pick
67 : env col jitter
```

---

## 6) Algorithm-Specific Extensions

Document any extra dimensions *without* reusing the global ranges above.

- **MIS Heuristics Experiments**: allocate a block 96–103
- **Bidirectional PT**: allocate path-endpoint connection dims 104–111
- **MLT mutations**: separate seeding in 112–127
- **Spectral sampling**: reserve a pair (e.g., 120–121) for wavelength and stratification key

When in doubt, **append** at 128+ and record the exact indices in the estimator descriptor.

---

## 7) Sampling Sequence Source

- Use a **single master seed** per frame + pixel; derive dimension streams via a stable hash:
  - `u = hash(seed, pixelID, sampleIndex, dimensionIndex)` → `U[0,1)`
- Recommended: low-discrepancy with Owen-scrambling (Sobol) or Cranley–Patterson rotation for uniform PRNG; ensure **dimension-stable** generation.

**Do not** derive later dimensions from earlier ones (no chaining).

---

## 8) Consumption Rules

- Every subsystem **consumes** its reserved dimensions in order, **even if** a step is skipped (advance pointer). This preserves alignment.
- Estimators **must not** consume from 0–1 (Camera slot) and should avoid 64–95 unless reading env hierarchies (then follow §5).

---

## 9) Versioning & Validation

- The dimension map is part of the estimator **contract** and contributes to the **Program Key**.
- A validator can spot-check: render a tiny scene, log first K dimensions consumed per pixel for regression tests.

---

## 10) Quick Cheatsheet

- **AA/DOF** → dims 0–1
- **Per-bounce (surface)** → start at 2, stride 4
- **Per-medium event** → start at 32, stride 4
- **Env hierarchies** → 64–67 (example)
- **Extras** → 96+ (document in estimator)
- **Always consume & advance**, even when a step is disabled