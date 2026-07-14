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
compiler-owned `generate/glsl/display.glsl`; the `main()` is generated per occupant).

**Descriptor** (`<id>.ts`): `type`, `glsl` (?raw), `origin`, `curveFn` (the curve's name),
and `encodesToDisplay` — `true` runs `curve → sRGB → clamp`; `false` is the raw
passthrough (identity curve, no encode, exposure forced to 1.0 — the §11 probe view).
**Registry line** in `index.ts`.

## How the compiler consumes it

`ShaderBuilder.buildDisplayBlocks` looks the occupant up in `TONEMAP_MODELS` by
`view.tonemap.type`, then assembles: generated display header → shared `display.glsl`
(safe_color + OETF) → the occupant's `curve()` → a generated `main()`
(`exposure → curve → (encode iff encodesToDisplay) → fragColor`). The `TonemapDesc` union
in `src/compiler/plan/types.ts` enumerates the legal types; `Validator.ts` rejects any
type without a live occupant (keep that allowlist in sync when adding one).
