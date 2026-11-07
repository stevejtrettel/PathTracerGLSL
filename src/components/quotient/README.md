# quotient/ — closed manifolds M = X/Γ

**Taxonomy:** scene (part of the space the light lives in — WHAT integral; like the ambient
space, the Planner copies it into `ProgramDescription.measurement`). **Kind:**
pick-at-most-one — `scene.ambientSpace.quotient`, absent for the space X itself.

## What an occupant supplies

A descriptor (`<kind>.ts`, registered by one line in `index.ts`: the space it acts on, |S|, the
domain's diameter, its defines) and one static GLSL file, included whole after the ambient
occupant. The file is pure group math with no calls into the program:

```glsl
int   quotient_image_index(...);                 // the NEE-table index of a cell, or −1
Point quotient_image_shift(int j);               // image j's map (E³: a translation)
int   quotient_image(Point x, Direction wi, Hit h);  // the table index of the image a ray from x
                                                 // along wi hit, or −1 when it is not in the table
Point quotient_reduce(Point p);                  // the point of D equivalent to p
```

`quotient_image_index` and `quotient_image_shift` are two adjacent functions over one numbering:
NEE samples image j and MIS recovers j from a hit, and the two must name the same images.

## What the compiler generates in a quotient program

- **The walk** (intersection.ts): today's dispatcher becomes `scene_intersect_cell(Ray, float
  t_far, out Hit)` (and `scene_intersect_any_cell` where the any-hit query exists), and
  `scene_intersect`/`scene_intersect_any` walk the cells, querying the one scene copy in D.
  `hit.t` is the arc length from `ray.origin`, summed over the cells crossed; `hit.p` and the
  rest of the Hit are in D's chart.
- **Image-aware NEE/MIS** (lighting.ts): `lighting_sample` picks an image j of S uniformly with a
  fresh `random()` and runs the existing sampler (`lighting_sample_cover`) at the moved query;
  `lighting_pdf` returns 0 for a hit image outside S, so that BSDF hit keeps weight 1. pt-nee's
  emitter weight is 1 for a hit outside S too (combiner.ts).
- `MAX_DIST` is the measurement's `farClip`, required in quotients.
- **Reduced medium vertices** (pt.ts, programs with media): a medium arm reports its event point
  in the chart of the ray's origin, possibly many cells away, and the walk moves it to the
  equivalent point of D (`quotient_reduce`) before NEE, the phase sample and the next segment;
  the camera's starting region is looked up at its reduced point. So every vertex of a path lies
  in D, and every image in S stays within the far clip of it.

## The bias ledger

A quotient has no sky; light leaves only by absorption. `maxBounces` truncates as everywhere
(more in a closed world: use a large N with Russian roulette). The far clip `farClip` = R ends
every segment (camera, BSDF, phase and shadow rays): a segment that meets nothing within R
carries 0.

- **Without fog** the clip is a real truncation with no stated bound. In the plan's E³ twin scene
  R = 4 cells showed 59% of the R = 32 value and R = 8 showed 88%; the tail decays only like a
  power of R.
- **With a homogeneous ambient fog** of extinction σ = σ_a + σ_s, a clipped segment carries at
  most e^{−σR} times the radiance arriving at its end, the errors add along a path, and the
  largest N-truncated radiance is at most (N+1)·Le_max. So for every pixel, per channel (per
  wavelength in spectral programs),

  |I_N − I_{N,R}| ≤ (N+1)² · e^{−σR} · Le_max,

  where N = `maxBounces`, I_N is the image with no clip and I_{N,R} the rendered one, and Le_max
  is the largest emitted radiance: of every light and emissive surface, and the fog's own glow
  ε/σ (a fog segment's glow is ε·(1 − e^{−σt})/σ ≤ ε/σ). Choose R by this number: e.g. N = 8,
  σ = 0.5, R = 24 gives 81·e^{−12}·Le_max ≈ 5e−4·Le_max. The derivation is in
  docs/claude-2026-11-review/quotients-plan.md, Part 1, "What is declared", item 2.

## Validator rules

No delta lights (BSDF rays cannot find their images outside S), no environment, `farClip ≥
2·diam(D)` (every image in S is reachable by a BSDF ray), no unbounded primitives, no driven
placements, and every object inside D by `EPS_INTERFACE`, except an unrotated box that spans
whole periods on some axes (a wall or a beam; it is lattice-invariant along them). Emitters must
lie inside D.

Media: only a homogeneous `ambientMedium` (constant or `{param}` coefficients; absorbing,
scattering and emitting are all allowed). Its coefficients are the same at every point, so the
medium arms need no position in D, and with no medium boundary nothing about the medium has to
follow a ray across faces. A heterogeneous or GRIN ambient medium, and any material with a medium
that an object uses (null interfaces, GRIN, glass interiors), are errors: they need the density
read at reduced points along a segment, or region state carried across faces.

## Occupants

- `torus/` — the cube 3-torus E³/(Lx·Z × Ly·Z × Lz·Z), |S| = 27.

The design and its evidence (the derivations, the float64 Monte Carlo twins and the float32 walk
twin) are in docs/claude-2026-11-review/quotients-plan.md (Milestone Q1) and the folder
docs/claude-2026-11-review/quotients/; the twins the vitest suite keeps are in
tests/components/quotient/.
