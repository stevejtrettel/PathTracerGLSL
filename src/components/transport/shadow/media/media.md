# Media shadow transmittance — what it computes and why

The segment-walking form of the §6.3 contract, emitted INSTEAD of `../opaque/` when
the scene has media + NEE: the shadow ray crosses a sequence of regions, and the
surviving fraction is the product of each segment's Beer–Lambert factor.

The walk, per segment (as many as the path's remaining null-crossing budget allows, below):

- current medium from `scene_region_at(origin)` — the §4.4 containment oracle, so the
  walker is self-contained from surface points and medium event points alike;
- `scene_intersect` to the next boundary (or the light, whichever is nearer);
- if the current region has a medium: `T *= medium_transmittance(med_mat, ray,
  seg_len)` — the generated seam-2 dispatch into the volume bodies; spectral, so
  chromatic media cast chromatic shadows;
- at the boundary: **null interfaces pass** (medium handoff, `ray_spawn` re-spawn to
  the far side, then the direction re-aimed at the light point with `ambient_direction_to` —
  kept, it would run parallel to the segment it should test, one spawn offset off per
  crossing, and meet the light's own surface at a slant); EVERYTHING else — opaque and dielectric alike — returns ZERO (the
  `opaque-dielectrics` truncation, same ledger entry as the opaque form);
- **crossing budget**: the shadow ray is the last segment of a path, and
  `measurement.maxNullCrossings` limits the null crossings of the whole path. The caller passes
  what the path has not spent (`shadow_crossings_left`); a shadow ray needing more returns ZERO,
  just as the walk ends a BSDF-sampled path at the same total. Both techniques drop the same
  paths, so the budget is a declared truncation shared by every estimator, not a safety limit.

Re-spawn (not a t-windowed query) is the pinned deviation from reference §4: the
reference's `scene_intersect_from` predates the trace-loop contract — same segments,
pinned signatures only.

Witnesses: the haze light shafts (shadow_media IS the shaft structure), slab through
colored media, X-FOG.
