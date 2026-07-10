# Impl plan — §10.1 item 6: spectral-discipline sweep

Enforce §2.5 so `Spectrum`/`Radiance` are honored as **opaque typedefs**, not "three RGB
floats." This does NOT add spectral rendering — it removes the RGB assumptions from
transport/library GLSL so that hero-wavelength spectral becomes a later *strategy-axis swap*
(change the typedef + the formatter + the reductions) instead of a line-by-line rewrite.

**Provenance:** `fable-compiler-contracts.md` §2.5 (spectral discipline, PINNED) + `fable-review.md`
(the Rec.601/709 luminance-for-RR leak). §10.1 item 6: *"sweep library GLSL for raw radiometric
`vec3` literals; introduce `spectrum_*` helpers; route generated constants through the formatter.
(Replaces `luminance()` for RR per review note on Rec.601.)"*

---

## The three parts

### 1. RR reduction — the substantive fix (behavior change)
`path_trace.glsl` RR uses `luminance(throughput)` (Rec.709 weights) — an RGB assumption baked
into a throughput decision. Replace with a **basis-agnostic** reduction:
```glsl
float spectrum_max(Spectrum s) { return max(s.x, max(s.y, s.z)); }   // NEW in math.glsl
...
float p_survive = min(0.95, spectrum_max(throughput));               // was luminance(throughput)
```
`spectrum_max` (max component) is the standard RR choice (PBRT's `MaxComponentValue`) — it never
terminates a path carrying energy in *any* single channel, and it is well-defined in any spectral
basis. `luminance()` is then **dead** → remove it from `math.glsl` (its presence invites exactly
the misuse §2.5 forbids; if display ever needs CIE luminance, that's a display-domain helper).

**Not byte-identical** (unlike item 5): survival probability changes (max-component vs Rec.709), so
RR-enabled scenes (cornell, minimal-pathtracer) shift their noise pattern. RR is unbiased for any
valid survival probability → **same converged mean**. RR-off scenes (two-light, furnace,
minimal-direct) are byte-identical.

### 2. Radiometric-constant formatter — the swap point (byte-identical)
Today radiometric constants (`albedo`, `emission`, light `color·intensity`) and *geometric*
constants (positions, normals, halfSizes) both go through **one** `formatVec3`. Spectral mode must
change only the radiometric ones. Split them:
```ts
// glsl-format.ts
export function formatSpectrum(v: number[]): string { return formatVec3(v); }  // RGB mode == vec3;
// ^ the SINGLE point spectral mode overrides (upsampling-coefficient eval). Geometric formatVec3 untouched.
```
Route radiometric emitters through it: `materials.ts` (albedo, emission literals + the
`vec3(0.8)`/`vec3(0.0)` defaults → `Spectrum(0.8)`/`SPECTRUM_ZERO`), `lighting.ts` (intensity;
**not** position), `environment.ts` (`none` body `vec3(0.0)` → `SPECTRUM_ZERO`; constant already
uses a uniform). Output is identical today → these produce **no snapshot diff** beyond the literal
substitutions that are numerically equal.

### 3. Sweep audit — confirm the rest is clean
- `tonemap_reinhard.glsl` — **out of scope**: it's the *display* domain, operating on RGB *after*
  the Spectrum→RGB reduction. Its `vec3` literals are display values, not radiometric. (Noted, not
  touched — the Spectrum→RGB reduction is where spectral mode hands off to display.)
- `build_basis` up-vector, `raymarch` normals — geometric `vec3`, correct as-is.
- `SPECTRUM_ZERO/ONE`, `spectrum_average`, `spectrum_is_black` already carry the reductions
  (added items 1/5). Item 6 adds only `spectrum_max`.

---

## In scope (files)

1. **`math.glsl`** — add `spectrum_max`; remove `luminance`; update the Provides header.
2. **`path_trace.glsl`** — RR `luminance(throughput)` → `spectrum_max(throughput)`.
3. **`glsl-format.ts`** — add `formatSpectrum` (the documented spectral swap point).
4. **`materials.ts`** — albedo/emission literals + defaults through `formatSpectrum`/`SPECTRUM_ZERO`/`Spectrum(...)`.
5. **`lighting.ts`** — light `intensity` (radiance) through `formatSpectrum`; position stays `formatVec3`.
6. **`environment.ts`** — `none` radiance `vec3(0.0)` → `SPECTRUM_ZERO`.

No TS type changes, no Planner changes, no new uniforms, no new strategy axis.

---

## Deferred — NOT item 6

| Deferred piece | Why not now | Lands in |
|---|---|---|
| **Actual spectral mode** (typedef → hero-wavelength coefficients, upsampling in `formatSpectrum`, CIE Spectrum→RGB at display) | item 6 only installs the discipline; spectral is a future *strategy axis* (§8) | spectral-strategy item |
| **Return-type typedef sweep** (`vec3 environment_radiance` → `Radiance`, etc. across all signatures) | wider hygiene pass; item 6 targets literals + reductions, not signatures | opportunistic / later |
| **Spectral uniforms** (driven `{param}` radiometric values become >3-wide in spectral mode) | uniform-width is a runtime concern; constants first | spectral-strategy item |
| **`spectrum_max` for MIS/firefly clamps** | no readers yet | MIS / denoise items |

---

## Verification

- **Snapshot** diff: `math.glsl` (luminance→spectrum_max), the RR line, env-`none` body, material
  defaults. `formatSpectrum` substitutions are numerically identical → they show as unchanged text.
  Review, then `-u`.
- **Typecheck** clean.
- **Live GPU:** RR-off scenes (two-light, furnace) render **byte-identical**. RR-on scenes (cornell)
  converge to the **same mean** with a shifted low-spp noise pattern (RR probability changed). Confirm
  cornell still converges to ~1.216 and shows no energy shift.

Related: `fable-compiler-contracts.md` §2.5; `fable-review.md` (Rec.601 RR note).
