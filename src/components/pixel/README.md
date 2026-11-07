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
integrates and with what weight; `h_j` is a probability density on the film. This family
owns `h_j`. It is NOT the film (`film/` = the temporal accumulation + tonemap, an orthogonal
axis) and NOT the pixel *value* — it is the pixel's characteristic kernel, one factor of `W_j`.

## What an occupant supplies

One GLSL file providing:

```glsl
vec2 pixel_sample(vec2 coord, vec2 xi);   // pixel center → continuous film point (pixel units)
```

`coord` is the pixel center in global pixel coordinates (`gl_FragCoord.xy + u_pixelOffset`);
`xi` is a sub-pixel sample from the sampler stream. The film's `main()` draws `xi`, calls
`pixel_sample`, and hands the film point to `camera_generateRay(film, xiLens, wl)`.

## The rule: the kernel is the density of the warp

Every occupant draws its film point **exactly** from its kernel `h`, by warping `xi`. Then
every sample has weight 1 and the plain average the accumulator keeps is an unbiased estimate
of `∫ h(u) L(camera(c_j + u)) du` (pbrt-v4's filter importance sampling). Nothing is splatted
into neighboring pixels, so the accumulators, the variance statistic, the first-hit guides and
tiled renders need nothing filter-specific. A kernel with negative lobes (Mitchell, Lanczos)
cannot be sampled this way: it would need signed sample weights through all of those, and is
not supported. The kernel may reach past the pixel square; a film point outside the image is
still mapped to a valid ray by every camera.

## How the compiler consumes it

`measurement.pixel` names the occupant (default `'box'`); the Validator rejects any other value,
and the pixel feature (compiler/generate/features/pixel.ts) includes the occupant's file whole.
The resolved value is always recorded in `ProgramDescription.measurement` and so in export
stamps. Changing the filter changes the integral (a box footprint and a Gaussian one weight the
film differently), so it is a measurement field with the usual reset discipline.

## Status

Occupants: `box/` (the indicator of the pixel square; the default) and `gaussian/` (an
untruncated isotropic normal, σ = 0.5 px, the pbrt-v4 and Mitsuba 3 default width). A tent
filter would be one more folder and registry line.
