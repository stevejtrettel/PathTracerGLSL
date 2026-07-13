# Opaque shadow transmittance — what it computes and why

The §6.3 contract asks "what per-channel fraction of light survives this shadow ray?"
— a `Spectrum`. This occupant is the media-free specialization: transmittance is
exactly 0 (blocked) or 1 (clear), so the body is one line —
`scene_intersect_any(shadow_ray, maxDist) ? SPECTRUM_ZERO : SPECTRUM_ONE` — a boolean
occlusion test behind the spectral contract.

The point of keeping the spectral signature even here: the NEE call sites in
`light.glsl` / `light_medium.glsl` / `equiangular.glsl` never change when media enter
a scene — the compiler swaps THIS body for the segment-walking form (`../media/`)
and everything above the seam is untouched. `scene_intersect_any` is the boolean fast
path (early-out, no nearest-hit bookkeeping).

Declared truncation riding here: dielectric surfaces block shadows like opaque ones
(`measurement.shadows: 'opaque-dielectrics'` — glass casts glass-shaped shadows in
the bias ledger; transparent shadows are §10.2).
