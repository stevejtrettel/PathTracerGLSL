# pixel/ — the pixel footprint kernel

**Taxonomy:** measurement (WHICH integral: the pixel's spatial reconstruction kernel).
**Kind:** pick-one.

## What this family is (the math)

A pixel value is a measurement functional. Ignoring the lens,

```
I_j = ∫_film  h_j(u) · L(camera(u))  du
```

with two independent factors: `camera(u)` (the ray map — the `camera/` family) and
**`h_j(u)`**, the pixel's spatial **footprint kernel** — where on the film plane pixel `j`
integrates and with what weight. This family owns `h_j`. It is NOT the film (`film/` = the
temporal accumulation + tonemap, an orthogonal axis) and NOT the pixel *value* — it is the
pixel's characteristic kernel, one factor of `W_j`.

## What an occupant supplies

One GLSL file providing:

```glsl
vec2 pixel_sample(vec2 coord, vec2 xi);   // integer pixel coord → continuous film point (pixel units)
```

`coord` is the global pixel coordinate (`gl_FragCoord.xy + u_pixelOffset`); `xi` is a
sub-pixel sample from the sampler stream. The occupant importance-samples its kernel:
`box` places the sample uniformly over the footprint; `tent`/`gaussian` warp `xi` to their
weighting. The film's `main()` draws `xi`, calls `pixel_sample`, and hands the film point
to `camera_generateRay(film, xiLens)`.

## Status

Occupant: `box/` (uniform footprint — the antialiasing jitter, hoisted out of the cameras).
Sole occupant today, included unconditionally (the `sampler/` precedent); a strategy knob
arrives with the second occupant (`tent`, `gaussian`, `mitchell`). Changing the occupant
changes the INTEGRAL (a box footprint vs a Gaussian one measure different weightings), so
this is a measurement axis with the usual reset discipline.
