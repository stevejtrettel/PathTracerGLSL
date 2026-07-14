# Fisheye camera — what it computes and why

A fisheye maps the image **radially** about the optical axis (contrast the pinhole's
gnomonic `r = f·tan θ`, which blows up at 90°). For a pixel, decompose its centered,
aspect-corrected position into radius `ρ` and image azimuth; the ray is

```
dir = cos θ · forward + sin θ · (azimuth direction in the right/up plane)
```

The azimuth passes straight through; the **polar angle θ off the axis** comes from ρ via
the radial map `θ(ρ)`, normalized so `ρ = 1` at the inscribed-circle rim (where
`θ = θ_max = fov/2`). That map — and ONLY that map — distinguishes the four sub-projections:

| projection | `r(θ)` | `θ(ρ)` (what's emitted) | preserves |
|---|---|---|---|
| equidistant | `f·θ` | `ρ·θ_max` | angle (radius linear in angle) |
| equisolid | `2f·sin(θ/2)` | `2·asin(ρ·sin(θ_max/2))` | solid angle (area-true; real photographic fisheyes) |
| stereographic | `2f·tan(θ/2)` | `2·atan(ρ·tan(θ_max/2))` | angles/shapes (conformal; "little planet") |
| orthographic | `f·sin θ` | `asin(ρ·sin(θ_max))` | the hemisphere projected flat (θ ≤ 90°) |

Everything else — the look-at frame (with the pinhole degenerate-axis guard), ρ, the
azimuth, the direction assembly — is shared. All four `θ(ρ)` forms live as static functions
in `fisheye.glsl` (readable math), and the compiler aliases `FISHEYE_THETA` to the one the
`projection` sub-parameter selects — a **value #define, the same mechanism as `TAN_FOV`**
(not the structural preprocessor gating the codebase avoids). `fov` is a live uniform
(`u_fisheyeFov`, full angular field in radians; default π = 180°).

The `sin`-based maps (equisolid, orthographic) clamp their `asin` argument, so corners
outside the inscribed circle (`ρ > 1`) pin at the rim instead of NaN-ing; equidistant and
stereographic extrapolate smoothly. v1 fills the whole frame — a true circular black mask
would need a "no-contribution" channel the `Ray` contract doesn't have yet (deferred).
Changing `projection` or `fov` changes the INTEGRAL (measurement), so cross-projection
images do not converge.
