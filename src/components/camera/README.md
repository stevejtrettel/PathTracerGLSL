# camera/ — the measurement functional

**Taxonomy:** measurement (WHICH integral: the sensor response being computed).
**Kind:** pick-one.

## What an occupant supplies

One GLSL file providing:

```glsl
Ray camera_generateRay(vec2 pixel, vec2 xi);   // xi = sub-pixel jitter
```

returning a pure geodesic seed (`Ray` = origin + unit direction, no interval — the
trace-loop contract). Camera parameters arrive as uniforms/defines the compiler's
camera feature owns (`u_cameraPosition/Target`, `TAN_FOV` — a constant fov bakes to a
literal define; a `{param}` fov becomes a live uniform aliased through the same
define, so the GLSL is unchanged either way — the §2.8 Value<T> pattern).

## Status

Occupant: `pinhole/`. Known next: thin-lens (aperture + focus distance — two more
schema fields and a lens sample from `xi`; NO transport changes, defocus is part of
the measurement). Changing camera type changes the INTEGRAL — cross-camera images do
not converge to each other, by design (contrast with everything estimator-side).
