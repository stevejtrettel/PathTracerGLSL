# Box pixel filter — what it computes and why

The pixel's spatial footprint kernel `h(u)` is the indicator of the pixel square: every
point of the pixel contributes equally. So `pixel_sample` places the sub-pixel sample
**uniformly** over the footprint — `coord + (xi − 0.5)`, mapping `xi ∈ [0,1)²` to the unit
square centered on the integer pixel. `xi` comes from the sampler stream, so QMC
stratifies the footprint.

The camera stays a pure film-point → ray map; the kernel is the swappable `measurement.pixel`
axis. A wider kernel (`gaussian/`) importance-samples its own `h(u)` by warping `xi` and changes
what the pixel integrates, which is why the family is a **measurement** axis, sibling to
`camera/`.
