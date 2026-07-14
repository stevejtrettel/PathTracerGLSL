# Box pixel filter — what it computes and why

The pixel's spatial footprint kernel `h(u)` is the indicator of the pixel square: every
point of the pixel contributes equally. So `pixel_sample` places the sub-pixel sample
**uniformly** over the footprint — `coord + (xi − 0.5)`, mapping `xi ∈ [0,1)²` to the unit
square centered on the integer pixel. `xi` comes from the sampler stream, so QMC
stratifies the footprint.

This is exactly the antialiasing jitter that used to live inside every camera; hoisting it
here makes the camera a pure film-point → ray map and makes the reconstruction kernel a
swappable axis. Wider kernels are the future occupants: `tent` (linear), `gaussian`,
`mitchell` — each importance-samples its own `h(u)` (warping `xi`), and each changes what
the pixel integrates (the footprint-weighted radiance), which is why the family is a
**measurement** axis, sibling to `camera/`.
