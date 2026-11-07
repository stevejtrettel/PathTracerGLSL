# Quotient manifolds M = X/Γ: realistic light, and the build plan

**Date:** 2026-11-07
**Status:** Milestone Q1 (the cube 3-torus: Q1a in vacuum, Q1b with a homogeneous fog) is built
on branch `quotient` (CHANGELOG 2026-11-07). Milestone Q2's core (Q2.1–Q2.3, Q2.5 and vitest 1–3
of Q2.6) is built on branch `sw`, with decision 1 taken at this plan's recommendation (both `Hit`
fields in Q2), provisionally; Q2.6's GPU witnesses 1–3 and a demo are built there too (CHANGELOG
2026-11-07). Model-written for the owner. This is the draft
(`quotients/plan.md`) revised after two independent reviews: `quotients/review-0.md`
(correctness: estimator, group theory, truncations) and `quotients/review-1.md` (simplicity and
fit to the code). Every must-fix item of both reviews is applied; the table at the end says
where. The owner's provisional answers (decisions.md P2) are recorded in "Owner decisions";
one of them (the `Hit` change in Q1) is now recommended differently, and the reason is given.

Milestone Q1 needs no curved-space work. It builds on the curved-space respelling commit
`4935183` ("Ambient seam: bit-identical Euclidean respelling"), which is the tip of both the
`curved` and the `quotient` branches; nothing quotient-specific is built yet. Milestone Q2 waits
for H³ step 2 of `docs/claude-2026-11-review/curved-spaces-design.md`.

**Evidence** (committed in `docs/claude-2026-11-review/quotients/`):
- `torus-code/notes.md`, `torus-code/dda_bound_twin.py`: the E³ design against this code, and the
  float32 twin of the cell walk.
- `seifert-weber/notes.md`, `seifert-weber/sw.ts`: exact SW geometry and a float32 precision study.
- `light-theory/notes.md`: the measurement and the image-NEE theory.
- `twin/notes.md`: float64 Monte Carlo twins of both spaces.
- `review-0/`: the correctness reviewer's reruns (`rerun.out`, `rerun2.out`) and its new
  crossing-count check `sw_cross.ts`.
- The survey `docs/claude-2026-11-review/survey/quotients.md` and the skeptic's section
  `quotient-light` in `survey/blackhole-quotient-challenges.md`.

**Labels:**
- [checked-code file:line]: read in source (on branch `quotient` = `curved` unless it says
  otherwise).
- [checked-num script]: measured by a script in the folder above.
- [checked-src URL]: read at that URL.
- [math]: a short argument, thought through and not checked by anyone else.
- [mem]: from memory.
- [not measured]: a prediction that a test in this plan will measure.

---

## Part 1. The model

**What is rendered.** M is a closed 3-manifold X/Γ: the cube 3-torus E³/Z³ first, then the
Seifert–Weber space H³/Γ_SW. Rendering M from a camera at x₀ is the same as rendering the
Γ-periodic scene in X from a lift of x₀ [math: the projection X → M is a local isometry, so
geodesics of M lift to geodesics of X]. We keep one copy of the scene, inside a fundamental
domain D (the box [−L/2, L/2]³; the regular dodecahedron with 72° dihedral angles). A ray that
leaves D through face i continues in D after the face pairing g_i is applied ("teleporting").
Face exits have closed forms (E³: t = (c − n·o)/(n·d); H³: tanh t = −⟨N,p⟩/⟨N,v⟩), so there is
no marching, creeping or binary search [math; seifert-weber §2].

M has no sky and nothing escapes. Light leaves only by absorption.

**Where light comes from.** A lamp in M reaches a point x along infinitely many geodesics, one
for each image γ·L of the lamp in X. An image at distance r subtends about area/A(r), where
A(r) = r² in E³ and sinh² r in H³. The number of images per unit distance grows like A(r). So
**every distance shell contributes about the same solid angle until occlusion cuts it off**
[math; seifert-weber §4]. The light really does come from far away:
- In SW, only 40% of the direct light at a surface point comes from images within distance 3
  [checked-num twin/sw_twin.ts DHIST].
- In the E³ test scene, 70% comes from within distance 3 [checked-num twin/torus.ts DHIST].

Indirect light through the pairings needs nothing extra: a bounced ray that teleports brings
back the neighbor cell's light.

**How light is sampled: partition MIS.** Fix a finite table S of group elements (the "NEE
images"). S does not depend on x.
- **E³:** the 27 translations L∘c, c ∈ {−1,0,1}³.
- **SW:** the identity and the 12 face pairings, 13 elements.

**NEE** picks one image j ∈ S with probability 1/|S|. It then calls the existing light sampler
for that image. The image of the lamp seen from x is the lamp seen from γ_j⁻¹x, so this is the
unchanged sampler run at a moved query point. The result is mapped back to x.

**BSDF sampling** traces its ray through the pairings and sees every image. When it hits an
emitter, the MIS code needs the image it hit: j if that image is in S, else −1. NEE's density for
that path is (1/|S|)·p_light at the moved query point if j ≥ 0, and **0** otherwise. The power
heuristic then gives the BSDF sample weight 1 on images outside S.

**Why this is unbiased.** The MIS weights sum to 1 over the techniques with positive density on
every contributing path, and BSDF sampling covers every path. This is the standard MIS condition
with one technique of zero density [math; mem: Veach 1997 §9.2; review-0 agrees]. The project
already uses the same rule for a light id it does not know: the generated `lighting_pdf` returns 0
[checked-code src/compiler/generate/features/lighting.ts:647-670].

It holds for any fixed S, given four conditions [math, light-theory §2.3]:
- **(C1)** NEE and MIS use the same set S: by one function, or by a proven identity. In E³ the
  image index and its shift are two adjacent functions over one numbering. In SW the two sides
  agree by a convexity theorem (Q2.2), not by shared code.
- **(C2)** The BSDF side identifies the image exactly. In E³ it rounds a vector that lies within
  a rounding error of an integer vector (Q1.1). In SW the walk counts crossings, an integer.
- **(C3)** One far clip R for every segment, and every image in S within R of every vertex x.
  This is a Validator rule.
- **(C4)** No delta lights. BSDF rays cannot hit them, so their images outside S would be lost.

**What is declared** (the bias ledger for quotients):
1. **`maxBounces` N**, as everywhere. In a closed world it removes more than in an open one:
   ρ^{N+1} of the uniform-albedo limit, which is 13% at ρ = 0.8 and N = 8 [math]. Quotient scenes
   should use a large N with Russian roulette, which stays unbiased for that measurement.
2. **The far clip R per segment** (measurement field `farClip`). A segment that meets nothing
   within arc length R carries 0. It is exact only if the scene has a finite horizon of at most
   R.
   - **With an ambient fog** of extinction σ, every clipped segment carries at most e^{−σR}
     times the radiance arriving there. The errors add up along the path. For a pixel, with
     albedo ≤ ρ̄ ≤ 1 and L_sup the largest unclipped N-truncated radiance [math, review-0 M4]:
     |I_N − I_{N,R}| ≤ e^{−σR}·L_sup·Σ_{k=0}^{N} ρ̄^k ≤ (N+1)·e^{−σR}·L_sup, and
     L_sup ≤ (N+1)·Le_max. So **|I_N − I_{N,R}| ≤ (N+1)²·e^{−σR}·Le_max**. This is the number to
     choose R by.
   - **Without fog** it is a real truncation, and the twins show it is large:
     - **E³:** R = 4 cells shows only 59% of the R = 32 value. R = 8 shows 88%. Even R = 16 is
       2.6% low, and the tail is polynomial, about R^−2.5 [checked-num
       twin/results_torus.jsonl].
     - **SW:** R = 8 shows 74% of the R = 16 value. The tail is exponential [checked-num
       twin/results_sw.jsonl].
   - **Cost:** mean crossings per segment saturate at the mean free path (4.7 in E³, 4.3 in SW
     at R = 16). Only the worst case grows with R [checked-num]. So **a large R is cheap on
     average, and fog is the honest way to make the clip small and quantified.**
3. **H³ only: the per-segment crossing cap.** It is a loop bound that ends a segment. It has no
   proof in H³, unlike the E³ bound, which is a theorem. It is set far above the measured
   maximum. A capped BSDF segment is a miss and a capped shadow ray is occluded, so the cap only
   ever removes light (Q2.3).

**No albedo rule** is needed, because N is finite [math; the skeptic].

**Evidence from the twins** [checked-num twin/notes.md; review-0/rerun.out, rerun2.out]:

| check | result |
|---|---|
| pt = pt-nee = pt-mis (both spaces, several image sets) | 46 comparisons, all within 2.2σ. Some SW rows compare the in-cell set S1 at a point where its NEE never fires (review-0 §1); those rows test nothing |
| the same, rerun with fresh seeds (E³, Q1) | U27 pt-mis z = +0.63, U27 pt-nee z = −0.12 |
| SW direct-only offset left open in the twin (+1.5σ, +2.0σ) | resolved: S13 pt-mis against pt over 10M paths each, z = −0.68 |
| control W1: pt-nee also drops BSDF hits outside S | wrong by −69σ to −161σ (fresh rerun at 200k paths: ≈ −110σ) |
| control W2: NEE and MIS use different image sets | wrong by −19σ to −26σ (E³; fresh rerun at 200k: ≈ −24σ); light-theory's version: −3.4%, 6σ |
| E³ teleporting tracer against an unrolled crystal, same random numbers | 0 of 200,000 paths differ (pt, bit-identical); 0 of 100,000 (BALL2 pt-mis and pt-nee); rerun 0 of 30,000 |
| SW teleporting walk against brute force over 5,505 images | 0 of 20,000 first hits differ; max \|Δt\| 3e-11 (rerun with a new seed: the same) |
| SW crossing count into a neighbor cell | 1 for all 40,000 pairs, half within 1e-3 of an edge, in float64 and in simulated float32 (review-0/sw_cross.ts) |
| SW group data | 12 pairings in SO⁺(3,1); face to opposite face; 6 edge cycles of 5 with product I; Dirichlet at o; ball of radius 3 tiled exactly once; vol MC 11.173 ± 0.036 against 11.199 [mem] [checked-num seifert-weber/sw.ts] |
| control W3: NEE allowed past the far clip | 0.3% bias, below the noise. **So C3 must hold by construction, not by witness.** |

**Variance** (var × work against pt; lower is better) [checked-num twin §2.5, §3.6]:
- E³: uniform-27 gives 0.79. A solid-angle-weighted ball of radius 3 (BALL3w) gives 0.31. The
  nearest image alone (NEAR) gives 1.14. The in-cell image alone was not measured in E³.
- SW: uniform-13 gives 0.90 and BALL3w gives 0.71. The in-cell image alone (S1) has
  var/var(pt) 0.96–0.97 at the camera-average point Q0; at the fixed-ray point Q1 its NEE never
  fires, so the Q1 figure measures nothing (review-0 §1).

The image choice is an estimator setting. It never changes the converged picture, so it can be
improved later. On the one SW scene measured, at two points, NEE helped little whatever the
table; fog, bigger lights or more lights reduced the noise more. That is one scene, not a law.

---

## Part 2. The build

### Milestone Q1: the E³ 3-torus (no curved-space work)

**Scope.** `ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [Lx, Ly, Lz] } }`.
D = [−L/2, L/2]³ around the origin, so coordinates authored in D read as today.

There are two commits, each with its own witnesses:
- **Q1a:** vacuum.
- **Q1b:** a homogeneous ambient fog.

#### Q1.1 Contracts: no change to the locked types in Q1

- **`Ray`: unchanged.** In a quotient program a ray is a geodesic seed in the chart of its
  origin. In E³ the origin may lie in any cell.
- **`Hit.t`: unchanged in meaning.** It is the arc length from `ray.origin`. In a quotient it is
  summed over the cells crossed.
- **`Hit.p`, `frame`, `ng`, `uv`, `eps`** are in the chart of the cell the hit was found in,
  translated to D's coordinates: hit.p lies in D up to rounding. A non-quotient program has
  D = X, so its meaning is unchanged.
- **No new `Hit` field in Q1.** The MIS code computes the image a BSDF ray hit from data it
  already has. One occupant function answers it (Q1.3):

  `j = quotient_image(x, wi, hit) = image_index(round((x + wi·hit.t − hit.p) / L))`

  where x is the ray's start point and wi its direction.
- **No arrival-direction field in Q1.** Torus pairings are translations, so the arrival
  direction `ambient_flow(s.ray, hit.t).direction` (the respelling in `4935183`) is
  `s.ray.direction` in every chart [math].

**Why this identifies the image exactly** [math, review-0 M5 and review-1 M6.3]:
- The walk reports `hit.p` as the hit point of the unrolled ray minus L∘k, where k is the
  *absolute* cell index, in the coordinates of the ray's origin, of the cell where the hit was
  found. So x + wi·hit.t − hit.p equals L∘k up to rounding, wherever x and hit.p lie. Nothing
  here needs x ∈ D or hit.p strictly inside D.
- The errors are the spawn offset (x is the previous vertex, the ray starts at
  `ray_spawn(hit, wi)` near it) and the float32 error of points at distance ≤ farClip, about
  farClip·1e-7. Both are far below L/2, so the rounding returns k [math; a float32 check of it
  is vitest 2].
- NEE's shift for index j names the image c_L + L∘c_j in the chart of x. MIS's index names the
  image c_L + L∘k in the same chart. So the two agree for any x, including a hit on a spanning
  wall that lies on ∂D or a rounding error outside it, and Q1b's reduced medium points.
- Camera rays may start in any cell, but nothing reads the image after them, because
  `path_state_init` sets `prev_was_delta = true` [checked-code
  src/components/transport/techniques/kernel/kernel.ts:33].

**The weighed alternative: a `Hit.image` field filled by the walk** (the draft's recommendation,
and P2's provisional answer). review-1 S1 proposed the formula above instead. The honest
comparison:

| | `Hit.image` field (draft) | recompute in the MIS code (this plan) |
|---|---|---|
| locked type | `Hit` changes in Q1, and again in Q2 for `arrival` | unchanged in Q1; Q2 adds `image` and `arrival` in one change |
| non-quotient programs | gain a `hit.image = 0;` line in the dispatcher (every program's text changes) | unchanged |
| exactness | an integer passed along, exact by construction | rounding of a near-integer vector; needs the error bound above and a float32 check |
| one answer per fact | yes: the walk computes the index once | yes: `quotient_image` is the only code that names the hit image; the walk's k is its traversal state and is never reported |
| later cost | none | at Q2, the torus walk writes the new field too and the torus `quotient_image` body becomes `return hit.image;` (about 5 lines), so the field has one meaning in every quotient program |

**Recommendation: recompute in Q1.** It has fewer parts (no locked-type change, no line in every
non-quotient program, no digest difference to review), it is still one answer per fact, and the
locked-type decision moves to Q2, where it is needed anyway. Its one extra demand, the rounding
argument, is short and gets a float32 test. If the owner prefers the field (P2's answer), the
draft's version is a 5-line change: the field, one line in the non-quotient dispatcher, one line
in the walk, and `quotient_image` returning it.

#### Q1.2 The far clip: building on the moved `MAX_DIST`

Commit `4935183` already moved `#define MAX_DIST 1000.0` from `glsl/core/math.glsl` into the
Euclidean ambient occupant [checked-code src/components/ambient/euclidean/euclidean.glsl on
branch `curved`]. Q1 builds on that and gives the fact one home:
- The space's default far clip becomes a descriptor field, `farClip: 1000` on the Euclidean
  ambient descriptor (`src/components/ambient/index.ts`). H³ step 2 declares its own (10) there.
- The define leaves `euclidean.glsl`. `core.ts` emits `#define MAX_DIST <value>` just before the
  occupant's block, where value = `measurement.farClip` if given, else the space's default.
- `tests/witnesses/scenes/shaderConstants.ts` reads the value from the descriptor instead of
  the file.
- Non-quotient programs keep MAX_DIST = 1000. Their text differs only in where that one define
  line sits.

#### Q1.3 Files

| File | Change | Est. lines |
|---|---|---|
| `src/compiler/types.ts` | `AmbientSpaceDescription.quotient?: { kind: 'torus'; size: [number, number, number] }` [checked-code types.ts:43-46]; `MeasurementDescription.farClip?: number` | +25 |
| `src/components/ambient/index.ts`, `euclidean/euclidean.glsl`, `src/compiler/generate/features/core.ts` | the `farClip` default as a descriptor field; the define emitted (Q1.2) | +12 −2 |
| `src/components/quotient/` (new family; see decision 6) | `README.md` (the contract), `index.ts` (registry), `torus/torus.ts` (descriptor: `size`, D's box, |S| = 27, the cell-bound formula), `torus/torus.glsl` (static math only: below), `torus/torus.md` (math note) | +180 |
| `src/compiler/plan/…` | plan the quotient: period, farClip, cell bound | +50 |
| `src/compiler/generate/features/intersection.ts` | in quotient programs only: rename today's dispatcher to `scene_intersect_cell(Ray, float t_far, out Hit)` (seed `hit.t = t_far`) and the any-hit form to `scene_intersect_any_cell`, and **generate the walks** `scene_intersect` and, under the same `anyQuery` gate as today, `scene_intersect_any` | +90 |
| `src/compiler/generate/features/lighting.ts` | in quotient programs, rename `lighting_sample`/`lighting_pdf` to `…_cover` and emit the two wrappers below | +40 |
| `src/components/transport/combiner.ts` | pt-nee: one extra condition in quotient programs | +4 |
| `src/compiler/analyze/Validator.ts` | the errors in Q1.5, including **new** world-AABB code for meshes (from `positions` × placement) and instance batches (`placements` × the prototype's box) | +160 |
| `src/components/transport/integrators/pt/pt.ts` (Q1b only) | two generated lines in quotient programs: `quotient_reduce` on the medium event point and on the camera's start region | +6 |
| `tests/witnesses/scenes/shaderConstants.ts` | read MAX_DIST from the descriptor | ±3 |
| `demos/torusScene.ts`, `demos/index.ts` | one composed scene | +80 |
| tests and witnesses | Q1.6 | +650 |

Source is about 570 lines; tests are about 650.

**What is static and what is generated** (review-1 M1). Static files are included whole, so a
static file must not call a function that exists only in some programs. `scene_intersect_any_cell`
exists only where the any-hit query is planned, `anyQuery: lighting !== null &&
!features.media.hasMedia` [checked-code src/compiler/plan/Planner.ts:617;
generate/features/intersection.ts:218, 385]. So pt programs (the crystal witness) and every Q1b
program have none. Therefore:
- **Generated by `intersection.ts`** in quotient programs: the two walks, `scene_intersect` always
  and `scene_intersect_any` only under `anyQuery`, exactly as today's `scene_intersect_any` is
  gated. They are short loops over the occupant's helpers.
- **Static in `torus/torus.glsl`**, pure math with no calls into the program: the cell of a point,
  the face times, `quotient_image_index(k)`, `quotient_image_shift(j)`, `quotient_image(x, wi,
  hit)` and `quotient_reduce(p)`. The occupant names its functions with the seam names, as the
  ambient occupant does (`ambient_flow`, …).
- The ambient occupant's functions are a whole-included block with no `provides` entries
  [checked-code src/compiler/generate/features/core.ts:105-107, 127-130], and some of them have
  no caller (`ambient_parallel_transport`). The quotient occupant's block works the same way, so
  `quotient_reduce` sitting uncalled in a Q1a program is not a provided-but-unrequired seam and
  raises no warning. pt.ts calls it through generated lines that exist only in quotient programs
  with media.

#### Q1.4 GLSL, sketched

**The image numbering: one answer** (review-1 M4). The index and the shift are two adjacent
functions over one numbering, and there is no emitted table:

```glsl
// torus.glsl — D = [-L/2, L/2]^3; cell k is D + L∘k. S = {L∘c : c in {-1,0,1}^3}, |S| = 27.
// Image j <-> c = (j/9, (j/3)%3, j%3) - 1. Index and shift are this one numbering.
int quotient_image_index(vec3 k) {          // the image of cell k, or -1 when k is not in S
    return all(lessThanEqual(abs(k), vec3(1.0))) ? int(dot(k + 1.0, vec3(9.0, 3.0, 1.0))) : -1;
}
Point quotient_image_shift(int j) {         // L∘c_j
    return TORUS_PERIOD * (vec3(float(j / 9), float((j / 3) % 3), float(j % 3)) - 1.0);
}
// The image a ray from x along wi hit (Q1.1): the walk reported hit.p = (x + wi·t) - L∘k.
int quotient_image(Point x, Direction wi, Hit h) {
    return quotient_image_index(round((x + wi * h.t - h.p) / TORUS_PERIOD));
}
Point quotient_reduce(Point p) { return p - TORUS_PERIOD * floor(p / TORUS_PERIOD + 0.5); }
// Exit times of cell k across its three exit faces; BIG on a zero component (-0.0 included).
vec3 torus_face_times(Ray r, vec3 k, vec3 s) {
    vec3 c = (k + 0.5 * s) * TORUS_PERIOD - r.origin;
    return vec3(r.direction.x != 0.0 ? c.x / r.direction.x : TORUS_BIG,
                r.direction.y != 0.0 ? c.y / r.direction.y : TORUS_BIG,
                r.direction.z != 0.0 ? c.z / r.direction.z : TORUS_BIG);
}
```

**The walk is a transcription of the measured twin** `torus-code/dda_bound_twin.py:17-41`
(review-0 M1, review-1 M2). It keeps the twin's two guards:
- **Zero direction components.** The twin sets the face time to `big` where `d == 0`. The test
  `d != 0.0` is false for −0.0 as well, so a −0.0 component (a mirror reflection off an
  axis-aligned wall makes one) never steps that axis. The draft relied on ±∞ from a division by
  zero. For −0.0 that gives s = +1 and t = −∞, then t_enter = −∞ and a NaN origin, and the ray
  is lost. GLSL ES does not promise IEEE infinities either [mem].
- **Monotone `t_enter = max(t_enter, t_exit)`**, so rounding never moves the entry point
  backward.

It is recomputed from the fixed origin each step, so nothing accumulates (torus-code §1.2):

```glsl
// Generated by intersection.ts in torus programs (scene_intersect_any: the same loop with the
// any-hit cell query and maxDist in place of MAX_DIST; emitted only under anyQuery).
bool scene_intersect(Ray ray, out Hit hit) {
    vec3 L = TORUS_PERIOD;
    vec3 k = floor(ray.origin / L + 0.5);                          // cell of the origin
    vec3 s = vec3(ray.direction.x >= 0.0 ? 1.0 : -1.0,
                  ray.direction.y >= 0.0 ? 1.0 : -1.0,
                  ray.direction.z >= 0.0 ? 1.0 : -1.0);            // the twin's step
    float t_enter = 0.0;
    for (int n = 0; n < TORUS_MAX_CELLS; n++) {                    // a proven bound, below
        vec3 t_next = torus_face_times(ray, k, s);
        float t_exit = min(min(t_next.x, t_next.y), t_next.z);
        // The local ray starts at this cell's entry point, so hit.p is accurate to ~|L|·eps.
        Ray local = Ray(ray.origin + ray.direction * t_enter - L * k, ray.direction, ray.wl);
        if (scene_intersect_cell(local, min(t_exit, MAX_DIST) - t_enter, hit)) {
            hit.t += t_enter;
            return true;
        }
        if (t_exit >= MAX_DIST) return false;                      // the declared far clip
        // cross one face: the first axis attaining t_exit (the twin's argmin order x, y, z)
        if (t_exit == t_next.x) k.x += s.x; else if (t_exit == t_next.y) k.y += s.y; else k.z += s.z;
        t_enter = max(t_enter, t_exit);
    }
    return false;   // not reached: TORUS_MAX_CELLS bounds every segment of length <= MAX_DIST
}
```

**The loop bound is a theorem, for this form** [math; checked-num torus-code/dda_bound_twin.out]:
a segment of length R visits at most 4 + R·Σ|d_i|/L_i ≤ 4 + R·√(Σ 1/L_i²) cells. The emitted
bound is `TORUS_MAX_CELLS = 5 + ceil(farClip·sqrt(Σ 1/L_i²))`. The float32 twin of exactly this
walk (zero guard, monotone t_enter) over 4,000 rays (periods 0.3–3, clips 1–200, origins up to
1,000 cells away) never exceeded 0.992 of the bound; its cell sequence matched float64 on 3,993
of 4,000 rays, and the 7 others differed only at edge or vertex passages, where two exits tie
within rounding and the zero-length cell between them differs (harmless under the Q1.5 margin:
no object lies in such a piece; torus-code/notes.md §1.2); local entry points were at most
2.4e-4 outside D. Its near-axis rays carry 1e-7 noise,
so it never had an exact zero component; vitest 2 adds exact ±0.0 directions.

Why one cell query clipped at t_exit finds the true nearest hit [math, torus-code §1.2]:
- Every object in D is part of the lifted scene, and every point of the lifted scene in D is an
  object of D (objects inside D, or spanning boxes; Q1.5).
- Cells are visited in order of t.
- The Q1.5 margin keeps rounding from moving a hit across a face, except in one case: where a
  spanning wall's surface crosses a face, a hit rounded just past `t_exit` reappears at local
  t ≈ 0 in the next cell, and an arm with a positive t_min would miss it. This affects a band
  about 1e-7·L wide [math, review-1 M6.3; not measured]. It is stated here and not guarded.

**Image-aware NEE and MIS** (generated in quotient programs only; |S| = 27). The image is drawn
with a fresh `random()`, the light tree's own convention [checked-code lighting.ts:841], so `xi`
reaches the sampler untouched (review-0 S1):

```glsl
LightSample lighting_sample(LightQuery q, vec2 xi, Wavelengths wl) {
    int j = min(int(random() * 27.0), 26);                 // one image of S, uniformly
    LightQuery qj = q;  qj.p = q.p - quotient_image_shift(j);   // image j of every light, seen from x
    LightSample ls = lighting_sample_cover(qj, xi, wl);    // the existing sampler, unchanged
    ls.pdf *= 1.0 / 27.0;                                  // wi, distance: translation-invariant
    return ls;
}
float lighting_pdf(LightQuery q, Direction wi, int light_id, Hit light_hit) {
    int j = quotient_image(q.p, wi, light_hit);
    if (j < 0) return 0.0;                                 // outside S: BSDF weight 1 (C2)
    LightQuery qj = q;  qj.p = q.p - quotient_image_shift(j);
    return lighting_pdf_cover(qj, wi, light_id, light_hit) / 27.0;
}
```

The MIS side replays the stored query `s.prev_query` [checked-code combiner.ts:39;
kernel.ts:51], and the recovered j is the j NEE drew for that image, so `qj` is the same bits on
both sides.

The existing pieces need no other change:
- **pt-mis:** `power_heuristic(a, 0) = 1`, so the pt-mis body does not change
  [checked-code combiner.ts:39].
- **pt-nee:** the emitter weight is a flat 0 today, so it gets one generated condition. A pt-nee
  program has no `prev_query` (it is stored only under MIS [checked-code kernel.ts:21-27]), so
  the condition reads the ray itself:
  `if (lid < 0 || s.prev_was_delta || quotient_image(s.ray.origin, s.ray.direction, hit) < 0) return 1.0;`
  [checked-code combiner.ts:33-41]. Each program has exactly one site that decides membership on
  the BSDF side.
- **Light pdfs:** every light pdf reads the query point only through differences with the light
  point or center (disk, softbeam, quad, sphere, mesh, the generic arm), so moving the query is
  exact [checked-code lighting.ts:663-668; lights/{disk,softbeam,sphere,quad}/*.glsl; review-0].
- **Light tree:** it takes the same `LightQuery`, so it runs unchanged at the moved query
  [checked-code lighting.ts:786, 804]. That it then gives the right pick and pmf is [math] only;
  witness 2's `bvh` arm tests it.
- **NEE technique:** `LightSample` carries no point [checked-code structs.glsl:89-96].
  `light.glsl` rebuilds `light_p = hit.p + wi·distance`, the image point in x's chart, and aims
  the shadow ray with `ambient_aim` [checked-code techniques/light/light.glsl]. The opaque shadow
  test walks cells up to that length minus `SHADOW_BACKOFF` [checked-code
  shadow/opaque/opaque.glsl]. Neither file changes.

#### Q1.5 Authoring and Validator errors

```ts
ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [1.0, 1.3, 0.8] } },
ambientMedium: fog,   // Q1b: makes the clip a stated bound, (N+1)²·e^{−σR}·Le_max
// strategy.measurement:
farClip: 8,           // required in quotient programs; ≥ 2·diam(D). Without fog this is a
                      // truncation: R = 8 showed 88% of the R = 32 value in the E³ twin scene.
maxBounces: 24,       // with roulette: a closed world needs depth
```

**Compile errors in quotient programs** (Q1a). Each is one Validator rule:

| Feature | Rule |
|---|---|
| point, spot, directional, beam lights (`delta: true` [checked-code lights/point/point.ts:11]) | error: no BSDF technique for their images outside S (C4). Evidence: 27 images lose 1–47% in corridor scenes, and a point light's fluence in a slab-shaped torus diverges like 2π ln R [checked-num light-theory/point_light_loss.py] |
| environment ≠ `none` | error: a closed manifold has no sky |
| `farClip` absent, or < 2·diam(D) | error (C3): every NEE image must be reachable by a BSDF ray. With emitters inside D by m and vertices within δ ≪ m of D, every image in S lies within 2·diam(D) − m + δ < farClip [math, review-0 M5] |
| any medium, null interface or GRIN | error in Q1a; Q1b allows a homogeneous `ambientMedium` only. (Equiangular NEE is already rejected with area emitters by the existing pin [checked-code Validator.ts:507-529], and quotients have no delta lights) |
| plane or any unbounded primitive | error: a half-space is not lattice-invariant |
| object whose world AABB is not inside [−L/2 + m, L/2 − m] on every axis, with m = `EPS_INTERFACE` | error, with one exception: an **unrotated `box`** may instead *contain* [−L/2 − m, L/2 + m] on some axes (a wall or a beam). It is lattice-invariant along those axes, so it is exact (decision 4) |
| emitter (light or emissive object) not inside D by m | error: an image must be one translate |
| driven `{param}` placements | error: no compile-time bound |
| `quotient` on a non-Euclidean space | error until Q2 |

**The AABBs are new Validator code** (review-1 M6.1). The Validator runs before the App builds any
BVH, and the scene-data plan hands mesh boxes to the App as `{ geometry: leaf.ref }`
[checked-code src/compiler/sceneData.ts:140], so no BVH or TLAS root exists to read. The
Validator computes:
- primitives: `primitiveBounds` under the placement, as `sceneData.ts:145` already does with
  `transformAABB` [checked-code src/compiler/analyze/Validator.ts:1545; sceneData.ts:145];
- meshes: the box of `positions` [checked-code types.ts:136-137] under the object's placement;
- instance batches: each of `placements` [checked-code types.ts:178] applied to the prototype's
  box.

**Allowed:** quad, sphere, disk, softbeam and mesh lights and emissive objects inside D; meshes,
instancing and table dispatch inside D; every surface material; the light tree, power and uniform
selection; RR, spectral, AOVs and every camera.

**Camera:** anywhere. The walk reduces any origin. Precision is fine within about 1,000 cells
[checked-num dda_bound_twin.out: entry points at most 2.4e-4 outside D].

**Q1b, fog.** A homogeneous ambient medium (`ambientMedium`) is allowed. It needs three things:
- **Medium event points are reduced.** `ms.exit_p` is computed in the origin's chart, possibly
  many cells away. In quotient programs the generated line becomes
  `Point p_evt = quotient_reduce(ms.exit_p);`, before NEE, phase sampling and the spawn
  [checked-code pt.ts:376-380]. This keeps every vertex in D, so C3 holds at medium vertices.
- **The camera's start region is reduced too:** `scene_region_at(quotient_reduce(ray.origin))`
  in quotient programs [checked-code pt.ts:171].
- **The media shadow walker is unchanged.** With no null interfaces it runs one segment, aimed at
  the light point in x's chart, and `h.t` is the total length [checked-code
  shadow/media/media.glsl]. It calls the full `scene_intersect`, but the shadow ray stops at the
  light just past `remaining`, so it does not walk to farClip [math, review-1].

Heterogeneous fog stays an error in Q1b. It needs the density read at reduced points along the
segment.

#### Q1.6 Verification (written before code)

**Vitest** (no GPU):
1. **Partition-MIS twin**, a TS port of `twin/torus.ts`, at the fixed-ray point Q1 with
   maxBounces 4, R = 4, **fixed seeds**, independent streams per estimator, and **200,000 paths
   per estimator** (review-0 M6). The reviewer's rerun took 3.6–4.0 s per 200k-path estimator
   [checked-num review-0/rerun.out].
   - pt, U27 pt-nee and U27 pt-mis agree within 3σ.
   - Controls W1 and W2 must **fail** by more than 10σ. At 200k paths the rerun measured
     W1 ≈ −110σ and W2 ≈ −24σ, so the controls have the power to fail [checked-num]. With fixed
     seeds the test is deterministic and cannot flake.
2. **Walk twin** (port of `dda_bound_twin.py`, of the transcribed walk):
   - cells visited / bound ≤ 1; float32 entry error ≤ 1e-3; t_enter non-decreasing;
   - new cases: directions with exact +0.0 and −0.0 components, which must visit the same cells
     as float64;
   - new check of Q1.1's rounding: at random hit distances t in each visited cell, with
     hit.p formed as the walk forms it in float32 and x offset from the origin by a spawn
     offset, `round((x + d·t − hit.p)/L)` equals the walk's k on every sample [not measured].
3. **Validator diagnostics:** each row of the Q1.5 table produces its error, and a jungle-gym
   scene and a wall scene pass. Includes a mesh and an instance batch that cross a face (the new
   AABB code).
4. **glslang** compiles the torus scenes (automatic once they are in the registry). The registry
   holds a **pt** torus scene and a **fog** torus scene, the two program shapes without
   `scene_intersect_any_cell`.
5. **Non-quotient programs:** `npm run digest` before and after, then `--compare`. The only
   difference allowed is the `#define MAX_DIST 1000.0` line moving out of the Euclidean
   occupant's block into the emitted line before it (Q1.2). `npm run frames -- compare` must be
   **bit-exact**; that is the real gate.

**GPU witnesses** (`tests/witnesses/scenes/torusWitness.ts`; targeted runs only, asking first):

1. **Crystal twin (detects wrong pairings; exact).**
   - **Scene:** torus (1.0, 1.3, 0.8), so diam(D) = 1.825. Two lambert balls, one ggx ball and one
     emissive sphere light, all inside D at generic positions. Camera in D. farClip
     R = 3.65 = 2·diam(D), maxBounces N = 2, pt.
   - **Partner:** the same measurement as a non-quotient E³ scene. It holds every copy whose
     bounding sphere comes within (N+1)·R = 10.95 of the camera, built with instanced sphere
     batches, emissive ones included [checked-code Validator.ts:1187;
     witnesses/scenes/instanceLightsWitness.ts]. That is about 5,300 cells, roughly 21,000
     instances, inside instancing's documented range. Its own `farClip` is also R.
   - **Why exact** [math, twin §2.3; review-0 rechecked]: a counted path has N + 1 segments of
     length ≤ R, so every vertex lies within (N+1)·R of the camera. The radius N·R + diam(D) is
     not a bound.
   - **Check:** the `twin` kind with `meanTol` and `rmse` [checked-code
     tests/witnesses/types.ts:106-113]. In the float64 twin, 0 of 200,000 paths differed
     [checked-num]. On the GPU, rounding differences in crystal coordinates around 10 will make
     a few paths diverge, so the gate is a calibrated rmse, not `identical`. Whether the `twin`
     kind renders both scenes at one pinned salt is not checked (review-0 §4); it is read in the
     runner before the witness is written, and without a shared salt the rmse is calibrated to
     the independent-stream noise floor.
2. **Estimator equality, with a light tree that has something to choose** (review-0 M3).
   - **Scene:** **two lights of different power at different depths**: a sphere light near a
     face, so S-membership changes across the picture, and a disk light of about 4× its power
     deeper in D. A glossy surface, so BSDF rays reach images outside S. One jungle gym (three
     spanning beams). maxBounces 4.
   - **Arms:** pt, pt-nee, pt-mis with power selection, and pt-mis with `lightSelection: 'bvh'`.
   - **Gates:** `meanTol` on every pair; `rmse` for pairs with the pt arm (χ² is documented as
     invalid for chance-hit pt arms [checked-code tests/witnesses/types.ts:72-83]); χ² for the
     nee/mis pairs.
3. **Noise, report only:** U27 pt-mis against pt, for comparison with the twin's 0.65.

**The witnesses' power, shown once by hand** (review-0 S8): with `quotient_image` forced to
return the in-cell index 13 (a W1-like error), and separately with the shift's sign flipped in
`lighting_pdf` (W2-like), witness 2 must fail. The margins are recorded in the commit message.

**Q1b additions:**
4. **Fog emission with a black occluder, exact** (review-0 M2).
   - **Scene:** a cube torus with L = 1 (2·diam(D) = 3.46), absorbing-only emitting fog with
     σ_a = 0.5 and Le = 1, farClip 4, and one black (albedo 0) sphere of radius 0.25 at a generic
     point in D. Camera in D.
   - **Value:** a pixel whose ray hits the occluder at summed distance t reads
     Le·(1 − e^{−σ_a·t}); a pixel that misses reads Le·(1 − e^{−σ_a·R}) = 0.8647. The source
     term is σ_a·Le [docs/fable-volumetric-component.md §3, read by the skeptic].
   - **Reference:** a float64 TS twin certifies windows, with a one-pixel margin, as fully
     covered by one occluder image seen through 0, 1, and 2 or more face crossings, plus miss
     windows, and integrates each window's expected mean over its pixel footprints.
   - **Check:** `mean` per window against the twin.
   - **What it catches:** the clip, and distance continuity across faces: a wrong
     `hit.t += t_enter` changes t on every occluder window seen across a face. (The draft's empty
     scene could not catch that: its value depends only on the clip, and a non-quotient scene
     passes it too.)
5. **Crystal twin with scattering fog** (σ_s = 0.3, σ_a = 0.1): the same construction as
   witness 1. Medium events count as bounces, so the (N+1)·R radius still bounds the paths
   [math].
6. **Estimator equality with fog**, with witness 2's two lights.

### Milestone Q2: Seifert–Weber in H³ (after H³ step 2)

**Depends on** H³ step 2 of the curved design: the hyperboloid model, mat4 isometry placements,
sphere and disk shapes, the disk light, lambert and pinhole.

Authoring: `ambientSpace: { type: 'hyperbolic', quotient: { kind: 'seifert-weber' } }`.

#### Q2.1 Group data: a built-in occupant, const arrays emitted by the compiler

`src/components/quotient/seifert-weber/seifert-weber.ts` computes the data in float64 from closed
forms [checked-num seifert-weber/sw.ts geom; review-0 rechecked the constants by hand]:
- **Inradius:** r_in with cosh² r_in = (5+2√5)/4, so r_in = 0.99638.
- **Circumradius:** R_c with cosh R_c = (7+3√5)/4, so R_c = 1.90285.
- **Face normals:** N = (n̂ cosh r_in, sinh r_in), for n̂ over the 12 normalized directions
  (0,±1,±φ), (±1,±φ,0), (±φ,0,±1).
- **Pairings:** g_{2k} = T(−2r_in·u_k)·R(u_k, 3π/5) and g_{2k+1} = g_{2k}⁻¹. The ray exits face i,
  and g_i is applied. These match thurston-rebuild
  [checked-code thurston-rebuild/src/geometries/hyp/groups/seifert-weber/set.js:25-91].
  - The constant `halfWidth` there is right.
  - The comment above it (set.js:19-23) has a negative radicand with α = 2π/5. It needs α = π/5
    [checked-num seifert-weber geom].

**Emitted:** `const vec4 FACE_N[12]`, `const mat4 PAIRING[12]`, rounded once to float32, 240
floats. They are const arrays, not uniforms, because Γ is fixed at compile time (the skeptic's
uniform-budget point).

**The NEE table needs no new matrices.** The cell across face f, seen from D, is g_f⁻¹D, and
g_f⁻¹ = g_{f xor 1}. So S13 = {I} ∪ {PAIRING[f]}. Index and map are again two adjacent occupant
functions over one numbering (j = 0 is I, j = 1 + f is face f), as in Q1.4.

The descriptor's data shape is the generic one: normals, pairings, the opposite face, r_in and
R_c. A SnapPy-exported group fits the same shape later.

#### Q2.2 Contract change (decision 1)

Q2 changes the locked `Hit` once, with both fields:
- **New field `int image;`**: "the image of the hit, relative to the chart of the ray's origin,
  as an index into the program's NEE image table; −1 when it is not in the table; 0 in programs
  without a quotient."
  - **Set once by the dispatcher and once by the walk** (review-1 M3), not in every arm:
    `hit.image = 0;` in the non-quotient dispatcher and in the cell dispatcher, and the walk's
    assignment. The image is a fact about the dispatch, not a shape, as `region_from` and
    `region_to` are [checked-code intersection.ts:1689-1708].
  - SW: 0 after no crossing, 1 + f after exactly one crossing through face f, −1 otherwise.
  - The torus walk writes it too (`quotient_image_index(k)`), and the torus `quotient_image`
    becomes `return h.image;`. The rounding formula of Q1 is then deleted, so the field has one
    meaning in every program.
  - **Exact in exact arithmetic** [math; checked-num twin s13HitsByCross; review-0/sw_cross.ts].
    SW's dihedral angle is 72° ≤ 90°, so D ∪ g_f⁻¹D is convex (its edge angles are 144° and its
    vertex links convex; in the Klein model H³-convexity is Euclidean convexity, so
    Tietze–Nakajima applies), and a geodesic from D into a neighbor cell crosses exactly one
    face. In the twin, all 3,052 BSDF hits on S13 images had at most 1 crossing. In review-0's
    check, 0 of 40,000 crossing counts differed from 1, in float64 and in simulated float32,
    half of them within 1e-3 of the shared face's edges. GLSL builtins remain unmodeled (Q2.4
    item 7).
  - **C1 holds by this identity, not by shared code** (review-0 S7): NEE indexes 13 matrices,
    MIS reads a crossing count, and convexity proves they name the same images. The skeptic is
    right that word-length membership is wrong in general; it holds for this table because of
    the convexity.
- **New field `Direction arrival;`**: "the ray's unit velocity at hit.p, in hit.p's chart.
  Without a quotient it equals `ambient_flow(ray, t).direction`."
  - **It replaces exactly one reader** (review-1 S4): the walk's `wo`, which `4935183` spells
    `-ambient_flow(s.ray, hit.t).direction` [checked-code pt.ts on branch `curved`]. After a
    teleport that flow is in the wrong chart, and at large t it overflows (cosh t) [math].
  - The other readers the respelling routed through `ambient_flow` are safe as they are: the
    dispatcher's side test sees the local ray of the current cell; the null re-spawn in pt.ts,
    the analytic medium arm and the media shadow walker are compile errors in Q2 (no media).
  - `s.ray.direction` keeps its other meaning: the **departure** direction at the previous
    vertex, which the MIS call reads [checked-code combiner.ts:39].
- **`Ray` in H³ quotient programs: the origin must lie in D.**
  - Hits are in D, and the objects' margin is far above the 1e-5 drift, so every spawned ray
    starts in D.
  - The camera pose is reduced into D on the CPU, in the function that already computes the
    camera frame. The occupant's TS `reduce` applies g_i while some ⟨N_i, p⟩ > 0. This ends
    because D is a Dirichlet domain at o: face i bisects o and g_i⁻¹o, so each step lowers
    d(p, o), and orbit distances are discrete [math; review-0 rechecked].
  - The App's controls keep working in the cover, inside the curved design's working radius.

#### Q2.3 The walk

As in Q1, the walks are generated by `intersection.ts` (the any-hit one only under `anyQuery`),
over static math in `seifert-weber.glsl`: the face-exit search, the renormalized step to the
face, the re-chart by `PAIRING[f]`, and the image functions. The loop, sketched:

```glsl
// p in D: <FACE_N[i], p> <= 0 for all i. mdot = Minkowski form (+,+,+,-).
bool scene_intersect(Ray ray, out Hit hit) {
    Ray r = ray;  float t_acc = 0.0;  int first_face = -1;
    for (int n = 0; n <= QUOTIENT_MAX_CROSSINGS; n++) {
        float tau = 1.0;  int f = 0;                        // tanh of the exit distance
        for (int i = 0; i < 12; i++) {
            float b = mdot(FACE_N[i], r.direction);
            if (b > 0.0) { float ti = max(-mdot(FACE_N[i], r.origin) / b, 0.0);
                           if (ti < tau) { tau = ti; f = i; } }
        }
        float t_exit = atanh(tau);                          // tau <= tanh(2 R_c) < 1
        if (scene_intersect_cell(r, min(t_exit, MAX_DIST - t_acc), hit)) {
            hit.arrival = ambient_flow(r, hit.t).direction; // local: in D's chart
            hit.t += t_acc;
            hit.image = n == 0 ? 0 : (n == 1 ? 1 + first_face : -1);
            return true;
        }
        t_acc += t_exit;
        if (t_acc >= MAX_DIST) return false;                // declared far clip
        Point q = r.origin + tau * r.direction;             // on face f (linear in tau)
        Direction w = r.direction + tau * r.origin;
        Point p = q * inversesqrt(-mdot(q, q));             // = cosh t·p + sinh t·v, renormalized
        Direction v = w + mdot(w, p) * p;  v *= inversesqrt(mdot(v, v));
        r = Ray(PAIRING[f] * p, PAIRING[f] * v, r.wl);     // one fixed matrix; no products kept
        if (n == 0) first_face = f;
    }
    return false;                                           // crossing cap: a miss
}
```

**`scene_intersect_any` returns `true` (occluded) on the crossing cap** (review-0 S2), so that a
cap only ever removes light, as the ledger says. For S13 shadow rays the cap is unreachable
anyway: at most 1 face crossing plus edge runs of at most 6, against a cap ≥ 32 [math;
checked-num review-0/rerun.out: shadowMaxCross 1].

The image maps for NEE and MIS have the same shape as Q1, with matrices in place of shifts:
- For j = 1 + f, the query becomes (`PAIRING[f]·q.p`, `PAIRING[f]·q.n`).
- NEE maps the sampled direction back with `PAIRING[f ^ 1]`.
- MIS moves only the query. It reads no departure direction at q.p: the cover's pdf takes the
  light point and `wo` at the emitter (the reversed `hit.arrival`), both already in D's chart, so
  the moved query and the emitter hit give NEE's density for image j. (An earlier draft of this
  line moved the departure direction by `PAIRING[f]·wi`; the build found it unnecessary, since
  the H³ pdfs read `wo` at the emitter.)

Moved query points lie within about 4.1 of o, where coordinates are at most about 31 [math].

**`QUOTIENT_MAX_CROSSINGS = ceil(4·farClip) + 32`**, a declared truncation. The twin's maximum
was 17 crossings at R = 8 and 29 at R = 16, against caps of 64 and 96. The mean length between
crossings is 0.960, a Kac's-lemma value the simulation reproduced (0.957–0.960 measured)
[checked-num seifert-weber extra.ts and teleport; twin §3.5].

**C3 in SW:** farClip ≥ 2R_c + 2r_in = 5.80, which bounds d(x, γy) for x, y ∈ D and γ ∈ S13
[math; review-0 rechecked: R_c + 2r_in + R_c = 5.798].

**The far clip in a quotient.** H³ step 2 declares the space's default far clip (T = 10) as the
H³ descriptor's `farClip` field (Q1.2). A quotient requires `measurement.farClip`, which
overrides it. The default does not bind in a quotient: the walk never flows more than one cell
chord (≤ 2R_c = 3.81) before it renormalizes and teleports.

#### Q2.4 Precision argument

All of these are float32 simulated with `Math.fround`
[checked-num seifert-weber/sw.ts teleport]:
1. **Bounded coordinates.** Every ray state is in D (|p_w| ≤ cosh R_c = 3.43) before a cell
   query. Only NEE's moved query and light points leave D, and they stay within about 4.1 of o.
2. **Renormalizing every crossing is required.** The constraint ⟨p,v⟩ = 0 is unstable, with the
   defect multiplied by cosh 2t per crossing [math]. Without renormalizing, 851 of 2,000 float64
   rays failed. With it, float32 drift stays at 1.2e-5 after 100 crossings and 1.4e-5 after
   1,000, with no growth.
3. **Fixed matrices, never products.** A float32 accumulated "cellBoost" is off by 1.1 after 10
   crossings, which is why thurston's cube needs QuadRing. Here no product is formed, so exact
   Q(√5) arithmetic is not needed.
4. **Chaos is harmless for camera and BSDF rays.** The float32 ray separates from float64 like
   e^T, but stays within 0.07 of the pixel footprint at every length up to T = 14. It shadows a
   nearby true geodesic.
5. **NEE aims only at near images** (d ≤ 5.8). The table rounding gives an aim error ≤ 1.8e-6
   rad. The shadow ray's own drift is about 3e-6 at d = 4 [math].
6. **Membership is a crossing count**, an integer. No tolerance comparison is made.
7. **Caveat [mem]:** GLSL builtins (atanh, inversesqrt) and FMA contraction are not modeled. So
   drift, the cap-hit rate and zero-length runs must be re-measured in GLSL, on SwiftShader and on
   the M2. Edge and vertex passages give zero-length runs of up to 6 crossings in the
   simulation, with no stuck rays.

#### Q2.5 Validator errors (in addition to Q1's rules that carry over)

- **Objects:** each bounding ball (c, r) needs ⟨N_i, c⟩ ≤ −sinh(r + m) for every face. No
  spanning exception, no planes, and no ghost copies.
- **Lights:**
  - Delta lights and skies are errors.
  - Disk lights are NEE-sampled.
  - Emissive spheres are reached by BSDF rays only, with weight 1. This is curved-design choice
    5, and it is still unbiased.
  - If the H³ sphere light exists by then, use it.
- **Media:** all media are errors in Q2. Fog in SW is a later item.
- **Settings:** `farClip` < 5.80 is an error, and so is a `quotient` with a non-SW kind.

#### Q2.6 Verification

**Vitest:**
1. **Group data** (port of `sw.ts geom` and `tile`):
   - g_i ∈ SO⁺(3,1) to 1e-12.
   - g_i maps face i's 5 vertices onto face i xor 1.
   - g_i N_i = −N_{i xor 1}.
   - 6 edge classes of 5, each with angle sum 2π and cycle product I.
   - One vertex class.
   - 20,000 points of the ball of radius 3, each in exactly one cell.
   - The mean crossing length is 0.960 ± 0.01 (Kac).

   This tests the data, which no render can test.
2. **SW MIS twin** (port of `twin/sw_twin.ts`), with fixed seeds:
   - pt, S13 pt-nee and S13 pt-mis agree within 3σ.
   - Control W1 (pt-nee drops every BSDF light hit) must fail; it measured −81σ to −161σ.
   - **A membership control** (review-0 M7) must fail: NEE samples S13, while MIS counts only
     0-crossing hits as members. The twin's own "WRONG? W2" (membership "≤ 1 crossing") is the
     *correct* rule for S13, so it cannot serve. The new control's size is [not measured]: N is
     chosen from one measured run so that it fails by more than 10σ, and if no affordable N
     reaches that, the plan stops and asks.
3. **Float32 walk:** 2,000 rays × 100 crossings with no stuck ray, constraint drift ≤ 5e-5, and
   no cap hit.

**GPU witnesses** (`tests/witnesses/scenes/seifertWeberWitness.ts`):
1. **Patch-unrolling first-hit windows (detects wrong pairings; exact).**
   - **Scene:** three emissive spheres of different colors at generic positions in D, so no
     symmetry of D preserves the scene, and a wrong twist or face order cannot render the same
     [math, light-theory §5]. maxBounces 0, farClip 6.
   - **Reference:** the float64 TS twin casts every pixel ray of chosen windows through the
     unrolled cover. That is brute force over images, not the walk. The twin already matched the
     walk on 20,000 of 20,000 rays.
   - **Windows:** windows certified, with a one-pixel margin, as fully covered by one sphere image
     seen through 0, 1, 2 and 3 or more crossings, plus windows of misses.
   - **Check:** `mean` equals that sphere's Le (or 0). A twist of 1/10 turn in place of 3/10
     changes most windows seen across a face, not every one: the two twists differ by a 1/5 turn,
     a symmetry of D, so along some face paths the wrong walk meets the same image (measured on
     the built witness: 6 of 11 windows fail).
2. **Estimator equality:** pt = pt-nee = pt-mis with a disk light near a face (membership
   changes across the frame), lambert balls, maxBounces 3, farClip 8. Gates as Q1 witness 2.
3. **Cap counter, report only** (review-0 S3): a debug count of capped segments on the GPU, since
   the TS simulation does not model GLSL builtins.
4. **No crystal in H³.** It would need about e^{2NR} cells (N(7.9) ≈ 10⁶) and an H³ TLAS.

### Later items (each its own plan)

1. **Ghost copies** (objects crossing faces), E³ first. They need region identity shared by
   several emitted objects, and per-image identity: the cell combined with the ghost's offset
   (the skeptic's point). The walk does not change.
2. **General Dirichlet domains from SnapPy.**
   - An offline exporter, run by the owner, reads `dirichlet_domain()`, `pairing_matrices()`,
     face and vertex lists, and the in/out radii [checked-src survey: SnapPy DirichletDomain
     API]. It converts SnapPy's form to this project's (w last, signature +++−) and writes a
     committed JSON asset.
   - A generic `polyhedral` occupant reads it, and the Q2.6 data checks run on it, comparing the
     volume against SnapPy's.
   - **Membership:**
     - S13-style, by "≤ 1 crossing", only when every dihedral angle is ≤ 90° (checked from the
       data).
     - Otherwise S1, "no crossing", which is exact by convexity of D [math].
     - Any larger set needs group-element identity, not word length.
3. **S³ quotients**, after S³ step 3.
   - Γ is finite.
   - When −I ∈ Γ (Q8, the binary tetrahedral and binary icosahedral groups, L(p,q) with p even),
     work in RP³ = S³/±1 with geodesics of length π and one arc per element of Γ/±1. This is the
     skeptic's correction [mem for which groups contain −I].
   - Point lights are allowed there, because there are finitely many images.
   - The far clip π (or 2π) is exact only in vacuum.
4. **Better image choice** (estimator only). The measured candidates:
   - BALL3w in E³: 0.31 var × work, against 0.79 for uniform-27.
   - BALL3w in SW: 0.71, with membership and weights from the hyperbolic law of cosines on local
     hit data [checked-num twin §3.2].
   - A light tree over the 27-patch image lights, which is not tested.
5. **Media across cells:**
   - Heterogeneous density read at reduced points (fract in E³).
   - Cell-by-cell tracking in H³.
   - Null interfaces and region state across teleports.
   - The media shadow walker carrying its destination through pairings, under the contract's
     destination rule [checked-code docs/trace-loop-contract.md].
   - Fog in SW.
6. **The other orientable flat manifolds.** Their screw pairings rotate, so they use the Q2
   machinery (`hit.arrival`, matrix tables).
7. **H²×R quotients.** They have polynomial tails like E³, not like H³ (the skeptic).
8. **Performance on the M2** (report-only `--perf` rows). Each crossing re-runs a full scene
   query, and the cost is unmeasured.

### What is cut, and why

| Cut | Why |
|---|---|
| Delta lights and skies in E³/H³ quotients (permanent) | no BSDF fallback; lost 1–47% or divergent [checked-num]; a small sphere or disk light looks the same |
| Summing all images per NEE | one image sampled has the same expectation for one shadow ray |
| thurston-rebuild's creeping, binary search and nearest-neighbor SDFs | exact closed-form exits plus objects inside D |
| A runtime group-element product ("cellBoost"), and QuadRing/Q(√5) arithmetic | not needed: no products formed; float32 product drift measured at 1.1 after 10 crossings |
| In-cell-only NEE (thurston's) as the default | in SW it gains little (var/var(pt) 0.96–0.97 at Q0). In E³ it was not measured; the nearest image alone (NEAR, a different set) was worse than pt per work (1.14) |
| Law-of-cosines image identification | not needed while the E³ MIS rounds an exact near-integer and the SW walk counts crossings; kept for later item 4 |
| A `Hit` field in Q1 | the MIS code recomputes the E³ image from data it has (Q1.1); the field comes in Q2 with `arrival` |
| An emitted image-shift table | the shift is computed from the index by one function beside the index function (Q1.4) |
| `Hit.cell` as an ivec3 | one `int image` serves E³ and H³ (Q2) |
| An albedo < 1 rule, and a finite-horizon check | maxBounces keeps the measurement finite; a horizon cannot be checked, so the clip is declared |
| Planes, driven placements, straddling objects (Q1, Q2) | not lattice-invariant, no static bound, or need ghosts |
| A GPU crystal in H³; the crystal as a feature | exponential size; it is a witness only |
| Cusps, non-orientable quotients | unbounded tails or flipped frames; not requested |

---

## Owner decisions

The owner's provisional answers (decisions.md P2, taken by the model at the draft's
recommendations so the 3-torus could be tried overnight; undo: the `quotient` branch's commits,
of which there are none yet) are listed with each question. Each still needs the owner's
confirmation.

1. **The `Hit` change.**
   - *P2 (provisional):* Hit gains an image identifier in Q1 and an arrival direction in Q2.
   - *This revision recommends:* **no `Hit` change in Q1; `int image` and `Direction arrival`
     together in Q2**, to the locked trace-loop type. Q1's MIS recomputes the image in one
     occupant function (Q1.1, with the comparison table there). It removes a locked-type change
     and a line in every non-quotient program from Q1, and stays one answer per fact. SW needs
     both fields: the walk is the only code that knows its crossing count and its chart. If the
     owner keeps P2's answer, Q1 adds the field in about 5 lines.
2. **A measurement field `farClip`**, emitted as `MAX_DIST`.
   - *P2:* yes; default unchanged outside quotients, required in quotients.
   - *Recommend yes, built on `4935183`:* the space's default becomes its ambient descriptor's
     `farClip` (Euclidean 1000; H³ 10 in step 2), and `measurement.farClip` overrides it (Q1.2).
     The crystal witness needs the same clip in both scenes, the right value depends on the
     scene, and the twins show it is the largest error in a quotient render.
3. **Delta lights and skies are permanent compile errors in E³ and H³ quotients.**
   - *P2:* yes. *Recommend yes.* Use small sphere or disk lights.
4. **Spanning walls and beams in Q1.** Allow an unrotated box that spans whole periods, or allow
   only objects strictly inside D until ghost copies exist.
   - *P2:* allowed. *Recommend allowing it.* It is one Validator rule with no GLSL, and it gives
     rooms and the classic "jungle gym" picture. Q1.1's image argument now covers hits on such
     walls explicitly.
5. **Fog in the first milestone** (Q1b, its own commit) or later.
   - *P2:* Q1b. *Recommend Q1b.* Without fog the far clip removes 12–41% of the light at R = 4–8
     in the E³ twin scene. Fog turns that into the stated bound (N+1)²·e^{−σR}·Le_max, and it
     fades the aliasing of far copies.
6. **Where the occupant lives** (new question from review-1 S3). A new family
   `src/components/quotient/` (README contract, registry, an entry in
   `tests/components/structure.test.ts` FAMILIES) or a folder inside `src/components/ambient/`,
   since the quotient is a property of the space. The plan is written with the new family,
   because the quotient is a separate choice from the space (the 3-torus and other flat
   manifolds share E³; SW and SnapPy groups share H³). Either is defensible; no recommendation.

A lighter Q1 witness was also proposed by review-1 (S2): a room of three spanning walls that
straddles D's faces, whose crystal is one closed box room in plain E³ (no 21,000 instances, no
`farClip` outside quotients), plus a first-hit window check against a TS twin. It was thought
through by the reviewer and not checked, and it does not test long multi-bounce paths across many
cells as the open crystal does. It is recorded here as an option, not recommended.

---

## Review items and where they are applied

| Item | Applied in |
|---|---|
| review-0 M1, review-1 M2: zero-direction guard and monotone t_enter, transcribed from `dda_bound_twin.py` | Q1.4 walk; vitest 2 adds exact ±0.0 directions |
| review-0 M2: fog witness could not see continuity | Q1 witness 4: black occluder, per-window twin values |
| review-0 M3: `bvh` arm vacuous with one light | Q1 witness 2: two lights of different power at different depths |
| review-0 M4: fog bound per segment only | Part 1 ledger item 2: (N+1)²·e^{−σR}·Le_max per pixel |
| review-0 M5, review-1 M6.3: false margin justification | Q1.1: absolute cell index in the ray origin's coordinates; Q1.5 C3 row |
| review-0 M6: vitest controls without power | Q1.6 vitest 1: fixed seeds, 200k paths, measured W1 ≈ −110σ, W2 ≈ −24σ |
| review-0 M7: no SW membership control | Q2.6 vitest 2: NEE on S13, MIS with 0-crossing membership |
| review-1 M1: static walk calls functions absent in pt and fog programs | Q1.3: walks generated and gated like `scene_intersect_any`; only pure math static |
| review-1 M3: `hit.image` in every arm | Q2.2: set once in the dispatcher and once in the walk (Q1 has no field) |
| review-1 M4: image numbering written twice | Q1.4: `quotient_image_index` and `quotient_image_shift` adjacent; no emitted table |
| review-1 M5, review-0 S4: digest rule and two homes for `MAX_DIST` | Q1.2: built on `4935183`; descriptor default plus measurement override; Q1.6 vitest 5 lists the moved define |
| review-1 M6.1: bounds "already exist" | Q1.5: new Validator AABB code from `positions` and `placements`; Q1.3 estimate +160 |
| review-1 M6.2: NEAR is not in-cell | Part 1 variance; "What is cut" row |
| review-1 S1: no `Hit` change in Q1 | Q1.1 comparison; adopted; decision 1 |
| review-0 S1, review-1 S5: reuse of `xi.x` | Q1.4: fresh `random()` |
| review-0 S2: cap semantics of the any-hit walk | Q2.3: occluded on the cap; ledger item 3 |
| review-0 S3: cap hits on the GPU | Q2.6 witness 3 |
| review-0 S5: evidence wording | Part 1 evidence table and variance |
| review-0 S6, S7: "exact"; C1 in Q2 | Q2.2; Part 1 C1 |
| review-0 S8: witness power | Q1.6, by hand once |
| review-0 S9: `farClip: 8` without fog | Q1.5 authoring example |
| review-1 S4: which readers `arrival` replaces | Q2.2 |
| review-1 S5: equiangular row | Q1.5 table, folded into the medium row |
| review-1 S2, S3 | Owner decisions: the room witness as an option; decision 6 |
