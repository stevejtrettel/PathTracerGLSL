# Media shadow transmittance — what it computes and why

The segment-walking form of the §6.3 contract, emitted INSTEAD of `../opaque/` when
the scene has media + NEE: the shadow ray crosses a sequence of regions, and the
surviving fraction is the product of each segment's Beer–Lambert factor.

The walk, per segment (up to `MAX_SHADOW_SEGMENTS`, pinned 8):

- current medium from `scene_region_at(origin)` — the §4.4 containment oracle, so the
  walker is self-contained from surface points and medium event points alike;
- `scene_intersect` to the next boundary (or the light, whichever is nearer);
- if the current region has a medium: `T *= medium_transmittance(med_mat, ray,
  seg_len)` — the generated seam-2 dispatch into the volume bodies; spectral, so
  chromatic media cast chromatic shadows;
- at the boundary: **null interfaces pass** (medium handoff, `ray_spawn` re-spawn to
  the far side); EVERYTHING else — opaque and dielectric alike — returns ZERO (the
  `opaque-dielectrics` truncation, same ledger entry as the opaque form);
- segment budget exhaustion is conservative: ZERO, never a light leak.

Re-spawn (not a t-windowed query) is the pinned deviation from reference §4: the
reference's `scene_intersect_from` predates the trace-loop contract — same segments,
pinned signatures only.

Witnesses: the haze light shafts (shadow_media IS the shaft structure), slab through
colored media, X-FOG.
