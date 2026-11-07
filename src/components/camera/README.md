# camera/ — the measurement functional

**Taxonomy:** measurement (WHICH integral: the sensor response being computed).
**Kind:** pick-one.

## What an occupant supplies

One GLSL file providing:

```glsl
Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl);
```

where `film` is the continuous sub-pixel point (the `pixel/` family owns the footprint /
sub-pixel jitter — the camera is a pure film-point → ray map, no RNG of its own). Returns a
light-propagation seed (`Ray` = origin + unit direction + current wavelengths, no interval — the trace-loop contract; the direction is normalized with `ambient_normalize` at the camera position). Camera parameters arrive as uniforms/defines the compiler's
camera feature owns (`u_cameraPosition/Target`, `TAN_FOV` — a constant fov bakes to a
literal define; a `{param}` fov becomes a live uniform aliased through the same
define, so the GLSL is unchanged either way — the §2.8 Value<T> pattern). Model-unique
params (thin-lens `u_aperture`/`u_focusDistance`) are declared on the occupant's
descriptor (`params(cam)`) and merged in by the feature; the registry is
`camera/index.ts` and adding a camera is one folder + one line there. The descriptor's `glsl`
lists the file under each ambient space it is implemented in (ambient/README.md). The frame
uniforms are `Direction`-typed: vec3 from `cameraBasis` in Euclidean space, vec4 from
`curvedCameraBasis` (the camera point exp_o(position) and a tangent frame there, the
target-centered up rule) in a curved space, so pinhole and fisheye — which only combine the frame
vectors and normalize with `ambient_normalize` — are one file listed under both spaces.

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

**Category B — shutter time and wavelength — are path coordinates, not camera random inputs.**
Their sampling belongs outside the camera. The accumulator passes the already-sampled
`Wavelengths wl` into `camera_generateRay`. Current cameras pass it to `make_ray`; a future
dispersive lens can use it during construction. RGB uses an initialized placeholder and
consumes no wavelength random draw. Shutter time, weighted/dispersive camera results and
spectral rendering remain unimplemented. Do not add `xiTime` or `xiLambda` draws to this seam.
See [spectral plan §3.2](../../../docs/claude-spectral-implementation-plan.md#32-fully-initialized-rays-including-the-camera).

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
