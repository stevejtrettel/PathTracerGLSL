# camera/ — the measurement functional

**Taxonomy:** measurement (WHICH integral: the sensor response being computed).
**Kind:** pick-one.

## What an occupant supplies

One GLSL file providing:

```glsl
Ray camera_generateRay(vec2 film, vec2 xiLens);
```

where `film` is the continuous sub-pixel point (the `pixel/` family owns the footprint /
sub-pixel jitter — the camera is a pure film-point → ray map, no RNG of its own). Returns a
pure geodesic seed (`Ray` = origin + unit direction, no interval — the trace-loop contract). Camera parameters arrive as uniforms/defines the compiler's
camera feature owns (`u_cameraPosition/Target`, `TAN_FOV` — a constant fov bakes to a
literal define; a `{param}` fov becomes a live uniform aliased through the same
define, so the GLSL is unchanged either way — the §2.8 Value<T> pattern). Model-unique
params (thin-lens `u_aperture`/`u_focusDistance`) are declared on the occupant's
descriptor (`params(cam)`) and merged in by the feature; the registry is
`camera/index.ts` and adding a camera is one folder + one line there.

## Camera randomness — two categories, two seams (owner-decided July 2026)

**Category A** is the geometric randomness — the complete list, and realistic
multi-element lenses, polygonal bokeh, and fisheye all still bottom out at pixel + lens:

- the **pixel footprint** — sub-pixel placement. This is NOT a camera concern: it lives in
  the `pixel/` family (the reconstruction kernel `h_j`), which hands the camera a continuous
  `film` point. The camera never sees `xiPixel`.
- `xiLens` — lens-disk sample (thin-lens aperture; pinhole/panoramic/equirect ignore it).

The film occupant draws the samples from the stream (`pixel_sample` for the footprint,
`xiLens` for the aperture) and hands the camera a `film` point + `xiLens`, keeping the
camera a pure, stratifiable, TS-twin-able map.

**Category B — shutter time (motion blur) and wavelength (spectral sensor) — are NOT
`generateRay` arguments.** They are seeded once at the sensor and *carried through the
whole path* (time → moving geometry in `scene_intersect`; wavelength → every downstream
IOR/throughput), so they belong as fields on the `Ray`/`PathState` seed, not as more
`xi`. Both are consciously prepared-for, not built (spectral is the reserved
`color: 'spectral'` axis; a time coordinate on the seed also serves relativistic
geodesics — `Point`→vec4). **Do not add a `xiTime`/`xiLambda` argument to
`generateRay`** when they land — that is the wrong seam.

## Status

Six occupants: `pinhole/`, `thinlens/` (defocus — aperture + focusDistance, lens sample
from `xiLens`; `aperture = 0 ≡ pinhole` witness), `orthographic/` (parallel projection),
`equirect/` (360×180), `fisheye/` (one occupant, four `θ(ρ)` sub-projections behind a
`projection` sub-parameter, selected by the value `#define FISHEYE_THETA`), `cylindrical/`
(wide panorama — one `hfov` Width° dial, one focal length → square pixels, vertical follows
the window). Model-unique params come from each descriptor's `params(cam)`; model-unique
compile-time selections from `defines(cam)` (the TAN_FOV mechanism, e.g. fisheye's radial
map). Changing camera type changes the INTEGRAL — cross-camera images do not converge to
each other, by design (contrast with everything estimator-side). Deferred: realistic
multi-element lens, tilt-shift, anamorphic, polygonal bokeh, the fisheye circular mask.
