# Analytic backend — what it computes and why

Geometry with closed-form ray intersections: `ray_sphere`, `ray_plane`, `ray_quad`
each solve their equation exactly and write the hit parameter `t` — no marching, no
epsilon tuning, exact normals. For the shapes that have closed forms this is strictly
better than the SDF path; the two backends coexist and the generated `scene_intersect`
combines whichever are present (the cornell-glass / analytic-glass twin scenes must
converge to the same image — the cross-backend witness).

Notes that matter downstream:

- `ray_quad` takes the precompiled normal (`quadNormal(edge1, edge2)` from
  `../index.ts`) — the SAME formula the quad light's descriptor uses, which is what
  makes the one-sided pin consistent: hit side and sample side agree by construction.
- Quads are **zero-thickness regions**: their containment test never claims a point,
  so the dispatcher's owner-covers-own-side shortcut is invalid for them (audit H2 —
  the fog-panel witness guards the back-face `region_from` fix), and interior-region
  logic (`scene_region_at`) skips them.
- Analytic objects still get signed-distance arms (`analyticSignedDistance`) for the
  §4.2 epsilon classification of `region_from/region_to` — classification is a
  point-containment question, not an intersection question.

Adding a primitive = its `ray_*` function here + a dispatch arm in the compiler's
intersection feature + one `PRIMITIVE_PARAMS` row.
