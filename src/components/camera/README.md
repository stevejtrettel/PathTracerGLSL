# camera/ — the measurement functional

**Taxonomy:** measurement (WHICH integral: the sensor response being computed).
**Kind:** pick-one.

## What an occupant supplies

One GLSL file providing:

```glsl
Ray camera_generateRay(vec2 pixel, vec2 xiPixel, vec2 xiLens);
```

returning a pure geodesic seed (`Ray` = origin + unit direction, no interval — the
trace-loop contract). Camera parameters arrive as uniforms/defines the compiler's
camera feature owns (`u_cameraPosition/Target`, `TAN_FOV` — a constant fov bakes to a
literal define; a `{param}` fov becomes a live uniform aliased through the same
define, so the GLSL is unchanged either way — the §2.8 Value<T> pattern). Model-unique
params (thin-lens `u_aperture`/`u_focusDistance`) are declared on the occupant's
descriptor (`params(cam)`) and merged in by the feature; the registry is
`camera/index.ts` and adding a camera is one folder + one line there.

## Camera randomness — two categories, two seams (owner-decided July 2026)

The two sub-samples are **Category A**: consumed *inside* `generateRay` to produce the
geometric ray, and this is the complete list — realistic multi-element lenses, polygonal
bokeh, and fisheye all still bottom out at pixel + lens:

- `xiPixel` — sub-pixel jitter (box filter over the pixel footprint; QMC-stratified —
  antialiasing is part of the measurement).
- `xiLens` — lens-disk sample (thin-lens aperture; pinhole/panoramic ignore it).

The film occupant draws both from the sampler stream and hands them in, keeping the
camera a pure, stratifiable, TS-twin-able function.

**Category B — shutter time (motion blur) and wavelength (spectral sensor) — are NOT
`generateRay` arguments.** They are seeded once at the sensor and *carried through the
whole path* (time → moving geometry in `scene_intersect`; wavelength → every downstream
IOR/throughput), so they belong as fields on the `Ray`/`PathState` seed, not as more
`xi`. Both are consciously prepared-for, not built (spectral is the reserved
`color: 'spectral'` axis; a time coordinate on the seed also serves relativistic
geodesics — `Point`→vec4). **Do not add a `xiTime`/`xiLambda` argument to
`generateRay`** when they land — that is the wrong seam.

## Status

Occupant: `pinhole/`. Known next: thin-lens (aperture + focus distance — two more
schema fields and a lens sample from `xi`; NO transport changes, defocus is part of
the measurement). Changing camera type changes the INTEGRAL — cross-camera images do
not converge to each other, by design (contrast with everything estimator-side).
