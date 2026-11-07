# tonemap/ — the display transfer (HDR → display)

**Taxonomy:** **view** — applied to the converged linear HDR estimate for presentation.
**Kind:** pick-one. `view.tonemap.type` selects the occupant.

The **optional transfer layer** between the estimate and its sinks (see
`docs/impl-plan-display.md`): the same curve draws to screen AND bakes into a PNG; raw
`.hdr`/`.exr` export BYPASSES it (those carry the estimate itself). This family owns only
the per-pixel tone curve — where pixels ultimately land (screen blit vs `export/` file)
is a separate, app-layer concern.

Occupants: `none/` (raw linear passthrough — what the §11 on-screen radiance probes
need; clamped only by the 8-bit target), `reinhard/` (`x/(1+x)`), and the production
roster `aces/` (Narkowicz filmic), `agx/` (Sobotka neutral — Blender default),
`khronos/` (Khronos PBR Neutral — material preview), `hable/` (Uncharted 2 filmic),
`gt/` (Gran Turismo / Uchimura). All but `none` encode to display (sRGB).

## What an occupant supplies

**GLSL** (`<id>.glsl`): one tone curve, nothing else —
```glsl
vec3 <id>_curve(vec3 x);   // HDR-linear → display-linear [0,1]
```
`none`'s curve is the identity. Everything else — exposure (`DISPLAY_EXPOSURE`),
`u_resolution`/`u_radiance`, `safe_color`, the sRGB OETF (`linear_to_srgb`), and the
composed `main()` — is shared/generated glue (`safe_color` + OETF live in the
fixed `glsl/shared/display.glsl`; the `main()` is generated per occupant).

**Descriptor** (`<id>.ts`): `type`, `glsl` (?raw), `origin`, `curveFn` (the curve's name),
and `encodesToDisplay` — `true` runs `curve → sRGB → clamp`; `false` is the raw
passthrough (identity curve, no encode, exposure forced to 1.0 — the §11 probe view).
**Registry line** in `index.ts`.

## How the compiler consumes it

`ShaderBuilder.buildDisplayBlocks` looks the occupant up in `TONEMAP_MODELS` by
`view.tonemap.type`, then assembles: generated display header → shared `display.glsl`
(safe_color + OETF) → the occupant's `curve()` → a generated `main()`
(`exposure → curve → (encode iff encodesToDisplay) → fragColor`). The registry is the gate:
`view.tonemap.type` is an open string, and the Validator rejects any type without an
occupant in `TONEMAP_MODELS` (`isTonemapSupported`), so adding one needs no other edit.
`exposure` must be finite and > 0.

## White balance

`view.tonemap.whiteBalance: <kelvin>` (in the blackbody range, 1000–40000 K) shows the white of a
Planck source at that temperature as D65 white: the Bradford adaptation, a constant 3×3 matrix on
linear sRGB (`whiteBalance.ts`; pbrt-v4's `WhiteBalance` with a Planck source white at every
temperature). A scene lit by `blackbody(T)` lights renders neutral at `whiteBalance: T`. It is a
view: a fixed linear map of each converged pixel, so it commutes with the mean. The display pass
folds exposure into it (`DISPLAY_VIEW = exposure·M`) and applies it before `safe_color`, because
the matrix has negative entries and the curves must not see a negative channel. It applies to
every picture shown through the tonemap view, the variance picture included; there the matrix
acts on per-channel variances, which is not the variance of the balanced color, so that picture
is for looking only (as exposure already scales it by k, not k²). Without `whiteBalance` the
display text is the exposure scalar alone. The raw probe path (`none`) applies no view transform:
neither exposure nor white balance. HDR exports carry the unbalanced estimate, as they carry the
unexposed one; PNG exports are drawn by the display pass and so are balanced.
