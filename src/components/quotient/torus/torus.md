# The cube 3-torus — what it computes and why

M = E³/Γ with Γ = Lx·Z × Ly·Z × Lz·Z. The scene is one copy inside the fundamental domain
D = [−L/2, L/2]³; cell k ∈ Z³ is D + L∘k (∘ the componentwise product), and the lifted scene in
E³ is the union of the cells' copies.

## The walk

`scene_intersect` (generated) starts in the cell of the ray's origin, k = ⌊o/L + ½⌋, and visits
cells in order of arc length. In each it queries the scene copy in D with the ray translated by
−L∘k and started at the cell's entry point, clipped to the cell's exit time, so the first hit it
finds is the nearest hit of the lifted scene. Every quantity is recomputed from the fixed origin
each step (`torus_face_times`), so nothing accumulates; `t_enter = max(t_enter, t_exit)` keeps
rounding from moving an entry point backward, and a zero direction component (−0.0 included)
gets the face time `TORUS_BIG`, so it never steps that axis.

Loop bound (a theorem for this form): a segment of length R visits at most
4 + R·Σ|d_i|/L_i ≤ 4 + R·√(Σ 1/L_i²) cells — R·|d_i|/L_i full crossings per axis plus a partial
step at each end — and `TORUS_MAX_CELLS = 5 + ⌈farClip·√(Σ 1/L_i²)⌉`.

## The images

A lamp in D is seen from x along one geodesic per lattice translate. NEE samples the table
S = {L∘c : c ∈ {−1, 0, 1}³} uniformly: image j's lamp seen from x is the lamp in D seen from
x − L∘c_j, so the unchanged light sampler runs at the moved query (`quotient_image_query`, over
`quotient_image_shift`); a translation leaves the sampled direction unchanged
(`quotient_image_direction` is the identity). A BSDF ray that hits a lamp has hit the image in
the cell k where the walk found it, k in the coordinates of the ray's origin, and the walk reports
`hit.image = quotient_image_index(k)`. An image outside S has NEE density 0, so its BSDF hit keeps
weight 1 (partition MIS). The index and the shift are adjacent functions over one numbering.

`quotient_reduce(p)` is the point of D equivalent to p. In programs with fog the transport loop
calls it on each medium event point (the medium arm reports it in the chart of the ray's origin,
up to farClip away) and on the camera's position before the region lookup, so every vertex of a
path lies in D and the NEE table's images stay within 2·diam(D) of it.
