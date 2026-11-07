# Quotient manifolds M = X/Γ: realistic light, and the build plan

**Date:** 2026-11-07
**Status:** Proposed, not built. Model-written for the owner. Nothing in the repo was edited.
It is not yet reviewed by an independent agent. Milestone Q1 needs no curved-space work.
Milestone Q2 waits for H³ step 2 of `docs/claude-2026-11-review/curved-spaces-design.md`.

**Evidence** (all in `/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/`):
- `torus-code/notes.md`: the E³ design against this code.
- `seifert-weber/notes.md`: exact SW geometry and a float32 precision study.
- `light-theory/notes.md`: the measurement and the image-NEE theory.
- `twin/notes.md`: float64 Monte Carlo twins of both spaces.
- The survey `docs/claude-2026-11-review/survey/quotients.md` and the skeptic's section
  `quotient-light` in `survey/blackhole-quotient-challenges.md`. Every skeptic correction is
  adopted here.

**Labels:**
- [checked-code file:line]: read in source.
- [checked-num script]: measured by a script in the folder above.
- [checked-src URL]: read at that URL.
- [math]: a short argument, thought through and not checked by anyone else.
- [mem]: from memory.

Where a sibling note did the check, the label names that note's script.

---

## Part 1. The model

**What is rendered.** M is a closed 3-manifold X/Γ: the cube 3-torus E³/Z³ first, then the
Seifert–Weber space H³/Γ_SW. Rendering M from a camera at x₀ is the same as rendering the
Γ-periodic scene in X from a lift of x₀ [math: the projection X → M is a local isometry, so
geodesics of M lift to geodesics of X]. We keep one copy of the scene, inside a fundamental
domain D (the cube; the regular dodecahedron with 72° dihedral angles). A ray that leaves D
through face i continues in D after the face pairing g_i is applied. This is "teleporting".
Face exits have closed forms (E³: t = (c − n·o)/(n·d); H³: tanh t = −⟨N,p⟩/⟨N,v⟩), so there is
no marching, creeping or binary search [math; seifert-weber §2].

M has no sky and nothing escapes. Light leaves only by absorption.

**Where light comes from.** A lamp in M reaches a point x along infinitely many geodesics, one
for each image γ·L of the lamp in X. An image at distance r subtends about area/A(r), where
A(r) = r² in E³ and sinh² r in H³. The number of images per unit distance grows like A(r).
So **every distance shell contributes the same solid angle until occlusion cuts it off**
[math; seifert-weber §4]. The light really does come from far away:
- In SW, only 40% of the direct light at a surface point comes from images within distance 3
  [checked-num twin/sw_twin.ts DHIST].
- In the E³ test scene, 70% comes from within distance 3 [checked-num twin/torus.ts DHIST].

Indirect light through the pairings needs nothing extra: a bounced ray that teleports brings
back the neighbor cell's light.

**How light is sampled: partition MIS.** Fix a finite table S of group elements (the "NEE
images"). S does not depend on x.
- **E³:** the 27 translations {−1,0,1}³.
- **SW:** the identity and the 12 face pairings, 13 elements.

**NEE** picks one image j ∈ S with probability 1/|S|. It then calls the existing light sampler
for that image. The image of the lamp seen from x is the lamp seen from γ_j⁻¹x, so this is the
unchanged sampler run at a moved query point. The result is mapped back to x.

**BSDF sampling** traces its ray through the pairings and sees every image. When it hits an
emitter, the walk reports which image it hit: `hit.image` = j if that image is in S, else −1.
NEE's density for that path is (1/|S|)·p_light at the moved query point if j ≥ 0, and **0**
otherwise. The power heuristic then gives the BSDF sample weight 1 on images outside S.

**Why this is unbiased.** The MIS weights sum to 1 over the techniques with positive density
on every contributing path. BSDF sampling covers every path. This is the standard MIS
condition [math; mem: Veach 1997 §9.2]. The project already uses the same rule for a light
id it does not know: the generated `lighting_pdf` returns 0
[checked-code src/compiler/generate/features/lighting.ts:647-670].

It holds for any S, given four conditions [math, light-theory §2.3]:
- **(C1)** NEE and MIS read the same table S, through the same code.
- **(C2)** The BSDF side identifies the image exactly. Here the walk counts crossings and
  cells, which are integers.
- **(C3)** One far clip R for every segment, and every image in S within R of every x ∈ D.
  This is a Validator rule.
- **(C4)** No delta lights. BSDF rays cannot hit them, so their images outside S would be lost.

**What is declared** (the bias ledger for quotients):
1. **`maxBounces` N**, as everywhere. In a closed world it removes more than in an open one:
   ρ^{N+1} of the uniform-albedo limit, which is 13% at ρ = 0.8 and N = 8 [math]. Quotient
   scenes should use a large N with Russian roulette, which stays unbiased for that measurement.
2. **The far clip R per segment** (new measurement field `farClip`). A segment that meets
   nothing within arc length R carries 0. It is exact if the scene has a finite horizon of at
   most R. With an ambient fog of extinction σ, the error on each segment is at most
   e^{−σR}·L_sup [math]. Without fog it is a real truncation, and the twins show it is large:
   - **E³:** R = 4 cells shows only 59% of the R = 32 value. Even R = 16 is 2.6% low, and the
     tail is polynomial, about R^−2.5 [checked-num twin/results_torus.jsonl].
   - **SW:** R = 8 shows 74% of the R = 16 value. The tail is exponential [checked-num
     twin/results_sw.jsonl].
   - **Cost:** mean crossings per segment saturate at the mean free path (4.7 in E³, 4.3 in SW
     at R = 16). Only the worst case grows with R [checked-num]. So **a large R is cheap on
     average, and fog is the honest way to make the clip small and quantified.**
3. **H³ only: the per-segment crossing cap.** It is a loop bound that ends a segment as a miss.
   It has no proof in H³, unlike the E³ bound, which is a theorem. It is set far above the
   measured maximum.

**No albedo rule** is needed, because N is finite [math; the skeptic].

**Evidence from the twins** [checked-num twin/notes.md]:

| check | result |
|---|---|
| pt = pt-nee = pt-mis (both spaces, several image sets) | 46 comparisons, all within 2.2σ |
| control W1: pt-nee also drops BSDF hits outside S | wrong by −69σ to −161σ |
| control W2: NEE and MIS use different image sets | wrong by −19σ to −26σ (E³); light-theory's version: −3.4%, 6σ |
| E³ teleporting tracer against an unrolled crystal, same random numbers | 0 of 200,000 paths differ (pt, bit-identical); 0 of 100,000 (BALL2 pt-mis and pt-nee) |
| SW teleporting walk against brute force over 5,505 images | 0 of 20,000 first hits differ; max \|Δt\| 3e-11 |
| SW group data | 12 pairings in SO⁺(3,1); face to opposite face; 6 edge cycles of 5 with product I; Dirichlet at o; ball of radius 3 tiled exactly once; vol MC 11.173 ± 0.036 against 11.199 [mem] [checked-num seifert-weber/sw.ts] |
| control W3: NEE allowed past the far clip | 0.3% bias, below the noise. **So C3 must hold by construction, not by witness.** |

**Variance** (var × work against pt; lower is better) [checked-num twin §2.5, §3.6]:
- E³: uniform-27 gives 0.79. A solid-angle-weighted ball of radius 3 (BALL3w) gives 0.31.
- SW: uniform-13 gives 0.90, BALL3w gives 0.71, and the in-cell image alone gives about 1.0.

The image choice is an estimator setting. It never changes the converged picture, so it can
be improved later. **In SW, NEE helps little whatever the table.** Fog, bigger lights or more
lights are what reduce the noise.

---

## Part 2. The build

### Milestone Q1: the E³ 3-torus (no curved-space work)

**Scope.** `ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [Lx, Ly, Lz] } }`.
D = [−L/2, L/2]³ around the origin, so coordinates authored in D read as today.

There are two commits, each with its own witnesses:
- **Q1a:** vacuum.
- **Q1b:** a homogeneous ambient fog.

#### Q1.1 Contract changes (locked types; owner approval needed, decision 1)

- **`Ray`: unchanged.** In a quotient program a ray is a geodesic seed in the chart of its
  origin. In E³ the origin may lie in any cell.
- **`Hit.t`: unchanged in meaning.** It is the arc length from `ray.origin`. In a quotient it
  is summed over the cells crossed.
- **`Hit.p`, `frame`, `ng`, `uv`, `eps`** are in the chart of D: hit.p ∈ D. A non-quotient
  program has D = X, so its meaning is unchanged.
- **New field `int image;`**, with this contract comment: "the light image this hit lies on,
  relative to the chart of the ray's origin, as an index into the program's NEE image table;
  −1 when that image is not in the table; 0 in programs without a quotient." Every arm and the
  dispatcher fill it (the fill-the-whole-Hit protocol,
  [checked-code src/glsl/core/structs.glsl:24-55]).
- **No arrival-direction field in Q1.** Torus pairings are translations, so `s.ray.direction`
  is already the arrival direction in every chart [math]. Q2 adds one.

Why `hit.image` is enough for MIS in Q1 [math, torus-code §1.3]:
- Every BSDF ray starts at `ray_spawn(hit, wi)` from the previous vertex x ∈ D.
- Objects keep a margin from ∂D (Q1.4), so every surface vertex is strictly inside D and the
  cell index the walk computes is the image relative to x.
- Camera rays may start in any cell, but nothing reads `hit.image` after them, because
  `prev_was_delta` is true there [checked-code src/components/transport/combiner.ts:34].

#### Q1.2 Files

| File | Change | Est. lines |
|---|---|---|
| `src/compiler/types.ts` | `AmbientSpaceDescription.quotient?: { kind: 'torus'; size: [number, number, number] }` [checked-code types.ts:43-46]; `MeasurementDescription.farClip?: number` | +25 |
| `src/glsl/core/structs.glsl` | `Hit.image` | +5 |
| `src/glsl/core/math.glsl` | `MAX_DIST` becomes an emitted define, value `farClip` (default 1000, so E³ text is unchanged) [checked-code math.glsl:8-11] | −2 |
| `src/components/quotient/` (new family) | `README.md` (the contract), `index.ts` (registry), `torus/torus.ts` (descriptor: `size`, D's box, the 27-entry image table, reach = 2·diam(D), the cell bound formula), `torus/torus.glsl` (the walk, the image maps, `quotient_reduce`), `torus/torus.md` (math note) | +220 |
| `src/compiler/plan/…` | plan the quotient: period, farClip, cell bound, image table | +50 |
| `src/compiler/generate/features/intersection.ts` | rename today's dispatcher `scene_intersect_cell(Ray, float t_far, out Hit)` (seed `hit.t = t_far`) and the any-hit form likewise, **only in quotient programs**; fill `hit.image = 0` in every arm | +40 |
| `src/compiler/generate/features/lighting.ts` | in quotient programs, rename `lighting_sample`/`lighting_pdf` to `…_cover` and emit the two wrappers below | +40 |
| `src/components/transport/combiner.ts` | pt-nee: one extra condition in quotient programs | +4 |
| `src/compiler/analyze/Validator.ts` | the errors in Q1.4 | +120 |
| `src/components/transport/integrators/pt/pt.ts` (Q1b only) | `quotient_reduce` on the medium event point and the camera's start region | +6 |
| `demos/torusScene.ts`, `demos/index.ts` | one composed scene | +80 |
| tests and witnesses | Q1.5 | +600 |

Source is about 500 lines; tests are about 600 (torus-code §8, adjusted).

**The walk is static GLSL in the occupant** ("math is static, policy and plumbing are
generated"). The generator emits the constants, the renamed dispatcher and the lighting
wrappers. The occupant file defines `scene_intersect` and `scene_intersect_any` on top of
`scene_intersect_cell`. Exact linkage: the quotient feature *provides* `scene_intersect`,
`scene_intersect_any` and `quotient_reduce`, and *requires* `scene_intersect_cell`.

#### Q1.3 Generated GLSL, sketched

The walk is a DDA over the cells D + L∘k. It is recomputed from the fixed origin each step,
so nothing accumulates (torus-code §1.2):

```glsl
// torus.glsl — D = [-L/2, L/2]^3; cell k is D + L*k, in the chart of ray.origin.
bool scene_intersect(Ray ray, out Hit hit) {
    vec3 L = TORUS_PERIOD;
    vec3 k = floor(ray.origin / L + 0.5);                  // cell of the origin
    vec3 s = vec3(ray.direction.x >= 0.0 ? 1.0 : -1.0, …);  // step per axis
    float t_enter = 0.0;
    for (int n = 0; n < TORUS_MAX_CELLS; n++) {             // a proven bound, below
        vec3 t_next = ((k + 0.5 * s) * L - ray.origin) / ray.direction;  // ±inf on zero components
        float t_exit = min(min(t_next.x, t_next.y), t_next.z);
        // The local ray starts at this cell's entry point, so hit.p is accurate to ~|L|·eps.
        Ray local = Ray(ray.origin + ray.direction * t_enter - L * k, ray.direction, ray.wl);
        if (scene_intersect_cell(local, min(t_exit, MAX_DIST) - t_enter, hit)) {
            hit.t += t_enter;
            hit.image = all(lessThanEqual(abs(k), vec3(1.0)))
                      ? int(dot(k + 1.0, vec3(9.0, 3.0, 1.0))) : -1;
            return true;
        }
        if (t_exit >= MAX_DIST) return false;               // the declared far clip
        // cross one face: the axis of t_exit
        if (t_exit == t_next.x) k.x += s.x; else if (t_exit == t_next.y) k.y += s.y; else k.z += s.z;
        t_enter = t_exit;
    }
    return false;   // not reached: TORUS_MAX_CELLS bounds every segment of length ≤ MAX_DIST
}
// scene_intersect_any(ray, maxDist): the same walk with the any-hit cell query and maxDist.
Point quotient_reduce(Point p) { return p - TORUS_PERIOD * floor(p / TORUS_PERIOD + 0.5); }
```

**The loop bound is a theorem** [math; checked-num torus-code/dda_bound_twin.py]: a segment of
length R visits at most 4 + R·√(Σ 1/L_i²) cells. The emitted bound is
`TORUS_MAX_CELLS = 5 + ceil(farClip·sqrt(Σ 1/L_i²))`. A float32 twin over 4,000 rays (periods
0.3–3, clips 1–200, origins up to 1,000 cells away) never exceeded 0.992 of the bound.

Why one cell query clipped at t_exit finds the true nearest hit [math, torus-code §1.2]:
- Every object in D is part of the lifted scene, and every point of the lifted scene in D is
  an object of D.
- Cells are visited in order of t.
- The Q1.4 margin keeps rounding from moving a hit across a face.

**Image-aware NEE and MIS** (generated in quotient programs only; `S = 27`):

```glsl
LightSample lighting_sample(LightQuery q, vec2 xi, Wavelengths wl) {
    float u = xi.x * 27.0;  int j = min(int(u), 26);  xi.x = u - float(j);   // reuse the remainder
    LightQuery qj = q;  qj.p = q.p - QUOTIENT_SHIFT[j];    // image j of every light, seen from x
    LightSample ls = lighting_sample_cover(qj, xi, wl);    // the existing sampler, unchanged
    ls.pdf *= 1.0 / 27.0;                                  // wi, distance: translation-invariant
    return ls;
}
float lighting_pdf(LightQuery q, Direction wi, int light_id, Hit light_hit) {
    if (light_hit.image < 0) return 0.0;                   // outside S: BSDF weight 1 (C2)
    LightQuery qj = q;  qj.p = q.p - QUOTIENT_SHIFT[light_hit.image];
    return lighting_pdf_cover(qj, wi, light_id, light_hit) / 27.0;
}
```

`QUOTIENT_SHIFT[j]` is the const array L∘c for c ∈ {−1,0,1}³, in the same order as
`hit.image`.

The existing pieces need no other change:
- **pt-mis:** `power_heuristic(a, 0) = 1`, so the pt-mis body does not change
  [checked-code combiner.ts:39].
- **pt-nee:** the emitter weight is a flat 0 today, so it gets one generated condition:
  `if (lid < 0 || s.prev_was_delta || hit.image < 0) return 1.0;`
  [checked-code combiner.ts:33-41].
- **Light pdfs:** every light pdf reads the query point only through differences with the
  light point or center (quad, sphere, mesh, generic arm), so moving the query is exact
  [checked-code torus-code §3.2: quad.glsl:36-40, sphere.glsl:66-70, lighting.ts:665-668].
- **Light tree:** it takes the same `LightQuery`, so it works unchanged at the moved query
  [checked-code lighting.ts:786, 804].
- **NEE technique:** `light.glsl` builds `light_p = hit.p + wi·distance`, which is the image
  point in x's chart. The opaque shadow test then walks cells up to
  `length(light_p − origin) − SHADOW_BACKOFF`
  [checked-code src/components/transport/techniques/light/light.glsl;
  shadow/opaque/opaque.glsl]. Neither file changes.

#### Q1.4 Authoring and Validator errors

```ts
ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [1.0, 1.3, 0.8] } },
// strategy.measurement:
farClip: 8,          // required in quotient programs; ≥ 2·diam(D)
maxBounces: 24,      // with roulette: a closed world needs depth
```

**Compile errors in quotient programs** (Q1a). Each is one Validator rule:

| Feature | Rule |
|---|---|
| point, spot, directional, beam lights (`delta: true` [checked-code lights/point/point.ts:11]) | error: no BSDF technique for their images outside S (C4). Evidence: 27 images lose 1–47% in corridor scenes, and a point light's fluence in a slab-shaped torus diverges like 2π ln R [checked-num light-theory/point_light_loss.py] |
| environment ≠ `none` | error: a closed manifold has no sky |
| `farClip` absent, or < 2·diam(D) | error (C3): every NEE image must be reachable by a BSDF ray |
| any medium, null interface, GRIN or equiangular NEE | error in Q1a; Q1b allows a homogeneous `ambientMedium` only |
| plane or any unbounded primitive | error: a half-space is not lattice-invariant |
| object whose world AABB is not inside [−L/2 + m, L/2 − m] on every axis, with m = `EPS_INTERFACE` | error, with one exception: an **unrotated `box`** may instead *contain* [−L/2 − m, L/2 + m] on some axes (a wall or a beam). It is lattice-invariant along those axes, so it is exact (decision 4) |
| emitter (light or emissive object) not strictly inside D | error: an image must be one translate |
| driven `{param}` placements | error: no compile-time bound |
| `quotient` on a non-Euclidean space | error until Q2 |

**Allowed:** quad, sphere, disk, softbeam and mesh lights and emissive objects inside D;
meshes, instancing and table dispatch inside D; every surface material; the light tree, power
and uniform selection; RR, spectral, AOVs and every camera. The bounds already exist
(`primitiveBounds`, `transformAABB`, BVH/TLAS roots)
[checked-code src/compiler/sceneData.ts:145; src/compiler/analyze/Validator.ts:1545].

**Camera:** anywhere. The walk reduces any origin. Precision is fine within about 1,000 cells
[checked-num dda_bound_twin.out: entry points at most 2.4e-4 outside D].

**Q1b, fog.** A homogeneous ambient medium (`ambientMedium`) is allowed. It needs three things:
- **Medium event points are reduced.** `ms.exit_p` is computed in the origin's chart, possibly
  many cells away, and is reduced with `quotient_reduce` before NEE, phase sampling and the
  spawn [checked-code pt.ts:376-380]. This keeps every vertex in D, so C3 and `hit.image`
  hold at medium vertices.
- **The camera's start region is reduced too** [checked-code pt.ts:171].
- **The media shadow walker is unchanged.** With no null interfaces it runs one segment, and
  `h.t` is the total length [checked-code shadow/media/media.glsl:39-55].

Heterogeneous fog stays an error in Q1b. It needs the density read at reduced points along the
segment.

#### Q1.5 Verification (written before code)

**Vitest** (no GPU):
1. **Partition-MIS twin**, a TS port of `twin/torus.ts` with smaller N and independent
   streams:
   - pt, U27 pt-nee and U27 pt-mis agree within 3σ.
   - Controls W1 and W2 must **fail** by more than 10σ.
2. **Walk-bound twin** (port of `dda_bound_twin.py`): the ratio of cells visited to the bound
   stays ≤ 1, and the float32 entry error stays ≤ 1e-3.
3. **Validator diagnostics:** each row of the Q1.4 table produces its error, and a
   jungle-gym scene and a wall scene pass.
4. **glslang** compiles the torus scenes (automatic once they are in the registry).
5. **Non-quotient programs:** `npm run digest` before and after, then `--compare`. The only
   differences allowed are the `Hit.image` field and its fill lines. Also
   `npm run frames -- compare` must be **bit-exact**.

**GPU witnesses** (`tests/witnesses/scenes/torusWitness.ts`; targeted runs only, asking
first):

1. **Crystal twin (detects wrong pairings; exact).**
   - **Scene:** torus (1.0, 1.3, 0.8), so diam(D) = 1.825. Two lambert balls, one ggx ball and
     one emissive sphere light, all inside D at generic positions. Camera in D. farClip
     R = 3.65 = 2·diam(D), maxBounces N = 2, pt.
   - **Partner:** the same measurement as a non-quotient E³ scene. It holds every copy whose
     bounding sphere comes within (N+1)·R = 10.95 of the camera, built with instanced sphere
     batches, emissive ones included [checked-code Validator.ts:1187;
     witnesses/scenes/instanceLightsWitness.ts]. That is about 5,300 cells, roughly 21,000
     instances, inside instancing's documented range. Its own `farClip` is also R.
   - **Why exact** [math, twin §2.3]: a counted path has N + 1 segments of length ≤ R, so
     every vertex lies within (N+1)·R of the camera. The radius N·R + diam(D) is not a bound.
   - **Check:** `twin` with `rmse` (the identical-stream gate [checked-code
     tests/witnesses/types.ts]) at a pinned salt, plus a mean gate. In the float64 twin, 0 of
     200,000 paths differed [checked-num]. On the GPU, rounding differences in crystal
     coordinates around 10 will make a few paths diverge, so the gate is the calibrated rmse,
     not `identical`.
2. **Estimator equality.**
   - **Scene:** the light near a face, so S-membership changes across the picture. A glossy
     surface, so BSDF rays reach images outside S. One jungle gym (three spanning beams).
     maxBounces 4.
   - **Checks:** `equality` over pt, pt-nee and pt-mis, plus a fourth arm with
     `lightSelection: 'bvh'`.
3. **Noise, report only:** U27 pt-mis against pt, for comparison with the twin's 0.65.

**Q1b additions:**
4. **Fog emission, exact.**
   - **Scene:** an empty cube torus with L = 1 (so 2·diam(D) = 3.46), absorbing-only emitting
     fog with σ_a = 0.5 and Le = 1, farClip 4.
   - **Value:** every pixel reads Le·(1 − e^{−σ_a·R}) = 0.8647. The source term is σ_a·Le
     [docs/fable-volumetric-component.md §3, read by the skeptic].
   - **What it catches:** errors in the clip and in distance continuity across faces.
5. **Crystal twin with scattering fog** (σ_s = 0.3, σ_a = 0.1): the same construction as
   witness 1. Medium events count as bounces, so the (N+1)·R radius still bounds the paths
   [math].
6. **Estimator equality with fog.**

### Milestone Q2: Seifert–Weber in H³ (after H³ step 2)

**Depends on** H³ step 2 of the curved design: the hyperboloid model, mat4 isometry placements,
sphere and disk shapes, the disk light, lambert and pinhole.

Authoring: `ambientSpace: { type: 'hyperbolic', quotient: { kind: 'seifert-weber' } }`.

#### Q2.1 Group data: a built-in occupant, const arrays emitted by the compiler

`src/components/quotient/seifert-weber/seifert-weber.ts` computes the data in float64 from
closed forms [checked-num seifert-weber/sw.ts geom]:
- **Inradius:** r_in with cosh² r_in = (5+2√5)/4, so r_in = 0.99638.
- **Circumradius:** R_c with cosh R_c = (7+3√5)/4, so R_c = 1.90285.
- **Face normals:** N = (n̂ cosh r_in, sinh r_in), for n̂ over the 12 normalized directions
  (0,±1,±φ), (±1,±φ,0), (±φ,0,±1).
- **Pairings:** g_{2k} = T(−2r_in·u_k)·R(u_k, 3π/5) and g_{2k+1} = g_{2k}⁻¹. The ray exits
  face i, and g_i is applied. These match thurston-rebuild
  [checked-code thurston-rebuild/src/geometries/hyp/groups/seifert-weber/set.js:25-91].
  - The constant `halfWidth` there is right.
  - The comment above it (set.js:19-23) has a negative radicand with α = 2π/5. It needs
    α = π/5 [checked-num seifert-weber geom].

**Emitted:** `const vec4 FACE_N[12]`, `const mat4 PAIRING[12]`, rounded once to float32, 240
floats. They are const arrays, not uniforms, because Γ is fixed at compile time (the skeptic's
uniform-budget point).

**The NEE table needs no new matrices.** The cell across face f, seen from D, is g_f⁻¹D, and
g_f⁻¹ = g_{f xor 1}. So S13 = {I} ∪ {PAIRING[f]}.

The descriptor's data shape is the generic one: normals, pairings, the opposite face, r_in
and R_c. A SnapPy-exported group fits the same shape later.

#### Q2.2 Contract change (decision 1, second half)

- **New field `Direction arrival;`** on `Hit`: "the ray's unit velocity at hit.p, in hit.p's
  chart. Without a quotient it equals `ambient_flow(ray, t).direction`."
  - The walk's `wo` reads it.
  - `s.ray.direction` keeps its other meaning: the **departure** direction at the previous
    vertex, which the MIS call reads [checked-code combiner.ts:39].
  - Why it is needed [math]: SW pairings rotate. After a teleport, `ambient_flow(s.ray,
    hit.t)` from the original ray gives a velocity in the wrong chart, and at large t it
    overflows (cosh t).
- **`Ray` in H³ quotient programs: the origin must lie in D.**
  - Hits are in D, and the objects' margin is far above the 1e-5 drift, so every spawned ray
    starts in D.
  - The camera pose is reduced into D on the CPU, in the function that already computes the
    camera frame. The occupant's TS `reduce` applies g_i while some ⟨N_i, p⟩ > 0. This ends
    because D is a Dirichlet domain at o, so each step lowers d(p, o) [math].
  - The App's controls keep working in the cover, inside the curved design's working radius.
- **`hit.image`** = 0 after no crossing, 1 + f after exactly one crossing through face f, and
  −1 otherwise.
  - **This is exact** [math; checked-num twin s13HitsByCross]. SW's dihedral angle is 72° ≤
    90°, so D ∪ g_f⁻¹D is convex, and a geodesic from D into a neighbor cell crosses exactly
    one face. In the twin, all 3,052 BSDF hits on S13 images had at most 1 crossing.
  - The skeptic is right that word-length membership is wrong in general. It holds for this
    table because of the convexity.

#### Q2.3 The walk (static GLSL in the occupant)

```glsl
// seifert-weber.glsl — p in D: <FACE_N[i], p> <= 0 for all i. mdot = Minkowski form (+,+,+,-).
bool scene_intersect(Ray ray, out Hit hit) {
    Ray r = ray;  float t_acc = 0.0;  int first_face = -1;
    for (int n = 0; n <= QUOTIENT_MAX_CROSSINGS; n++) {
        float tau = 1.0;  int f = 0;                        // tanh of the exit distance
        for (int i = 0; i < 12; i++) {
            float b = mdot(FACE_N[i], r.direction);
            if (b > 0.0) { float ti = max(-mdot(FACE_N[i], r.origin) / b, 0.0);
                           if (ti < tau) { tau = ti; f = i; } }
        }
        float t_exit = atanh(tau);                          // tau ≤ tanh(2 R_c) < 1
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
    return false;                                           // crossing cap: declared truncation
}
```

`scene_intersect_any` is the same walk with `maxDist`.

The image maps for NEE and MIS have the same shape as Q1, with matrices in place of shifts:
- For j = 1 + f, the query becomes (`PAIRING[f]·q.p`, `PAIRING[f]·q.n`).
- NEE maps the sampled direction back with `PAIRING[f ^ 1]`.
- MIS moves the departure direction the same way: `PAIRING[f]·wi`.

Moved query points lie within about 4.1 of o, where coordinates are at most about 31 [math].

**`QUOTIENT_MAX_CROSSINGS = ceil(4·farClip) + 32`**, a declared truncation. The twin's maximum
was 17 crossings at R = 8 and 29 at R = 16, against caps of 64 and 96. The mean length between
crossings is 0.960, a Kac's-lemma value the simulation reproduced (0.957–0.960 measured)
[checked-num seifert-weber extra.ts and teleport; twin §3.5].

**C3 in SW:** farClip ≥ 2R_c + 2r_in = 5.80, which bounds d(x, γy) for x, y ∈ D and γ ∈ S13
[math].

**H³'s T = 10 ceiling does not apply in a quotient.** The walk never flows more than one cell
chord (≤ 2R_c = 3.81) before it renormalizes and teleports. The space's constant stays the
default for non-quotient H³ programs, and `farClip` overrides it in a quotient.

#### Q2.4 Precision argument

All of these are float32 simulated with `Math.fround`
[checked-num seifert-weber/sw.ts teleport]:
1. **Bounded coordinates.** Every ray state is in D (|p_w| ≤ cosh R_c = 3.43) before a cell
   query. Only NEE's moved query and light points leave D, and they stay within about 4.1 of o.
2. **Renormalizing every crossing is required.** The constraint ⟨p,v⟩ = 0 is unstable, with
   the defect multiplied by cosh 2t per crossing [math]. Without renormalizing, 851 of 2,000
   float64 rays failed. With it, float32 drift stays at 1.2e-5 after 100 crossings and 1.4e-5
   after 1,000, with no growth.
3. **Fixed matrices, never products.** A float32 accumulated "cellBoost" is off by 1.1 after
   10 crossings, which is why thurston's cube needs QuadRing. Here no product is formed, so
   exact Q(√5) arithmetic is not needed.
4. **Chaos is harmless for camera and BSDF rays.** The float32 ray separates from float64 like
   e^T, but stays within 0.07 of the pixel footprint at every length up to T = 14. It shadows a
   nearby true geodesic.
5. **NEE aims only at near images** (d ≤ 5.8). The table rounding gives an aim error ≤ 1.8e-6
   rad. The shadow ray's own drift is about 3e-6 at d = 4 [math].
6. **Membership is a crossing count**, an integer. No tolerance comparison is made.
7. **Caveat [mem]:** GLSL builtins (atanh, inversesqrt) and FMA contraction are not modeled. So
   drift, the cap-hit rate and zero-length runs must be re-measured in GLSL, on SwiftShader and
   on the M2. Edge and vertex passages give zero-length runs of up to 6 crossings in the
   simulation, with no stuck rays.

#### Q2.5 Validator errors (in addition to Q1's rules that carry over)

- **Objects:** each bounding ball (c, r) needs ⟨N_i, c⟩ ≤ −sinh(r + m) for every face. No
  spanning exception, no planes, and no ghost copies.
- **Lights:**
  - Delta lights and skies are errors.
  - Disk lights are NEE-sampled.
  - Emissive spheres are reached by BSDF rays only, with weight 1. This is curved-design
    choice 5, and it is still unbiased.
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
2. **SW MIS twin** (port of `twin/sw_twin.ts`): pt, S13 pt-nee and S13 pt-mis agree within 3σ,
   and control W1 fails.
3. **Float32 walk:** 2,000 rays × 100 crossings with no stuck ray, constraint drift ≤ 5e-5,
   and no cap hit.

**GPU witnesses** (`tests/witnesses/scenes/seifertWeberWitness.ts`):
1. **Patch-unrolling first-hit windows (detects wrong pairings; exact).**
   - **Scene:** three emissive spheres of different colors at generic positions in D, so no
     symmetry of D preserves the scene, and a wrong twist or face order cannot render the same
     [math, light-theory §5]. maxBounces 0, farClip 6.
   - **Reference:** the float64 TS twin casts every pixel ray of chosen windows through the
     unrolled cover. That is brute force over images, not the walk. The twin already matched
     the walk on 20,000 of 20,000 rays.
   - **Windows:** windows certified, with a one-pixel margin, as fully covered by one sphere
     image seen through 0, 1, 2 and 3 or more crossings, plus windows of misses.
   - **Check:** `mean` equals that sphere's Le (or 0). A twist of 1/10 turn in place of 3/10
     moves every image beyond 2r_in.
2. **Estimator equality:** pt = pt-nee = pt-mis with a disk light near a face (membership
   changes across the frame), lambert balls, maxBounces 3, farClip 8.
3. **No crystal in H³.** It would need about e^{2NR} cells (N(7.9) ≈ 10⁶) and an H³ TLAS.

### Later items (each its own plan)

1. **Ghost copies** (objects crossing faces), E³ first. They need region identity shared by
   several emitted objects, and per-image identity: the cell combined with the ghost's offset
   (the skeptic's point). The walk does not change.
2. **General Dirichlet domains from SnapPy.**
   - An offline exporter, run by the owner, reads `dirichlet_domain()`, `pairing_matrices()`,
     face and vertex lists, and the in/out radii [checked-src survey: SnapPy DirichletDomain
     API]. It converts SnapPy's form to this project's (w last, signature +++−) and writes a
     committed JSON asset.
   - A generic `polyhedral` occupant reads it, and the Q2.6 data checks run on it, comparing
     the volume against SnapPy's.
   - **Membership:**
     - S13-style, by "≤ 1 crossing", only when every dihedral angle is ≤ 90° (checked from the
       data).
     - Otherwise S1, "no crossing", which is exact by convexity of D [math].
     - Any larger set needs group-element identity, not word length.
3. **S³ quotients**, after S³ step 3.
   - Γ is finite.
   - When −I ∈ Γ (Q8, the binary tetrahedral and binary icosahedral groups, L(p,q) with p
     even), work in RP³ = S³/±1 with geodesics of length π and one arc per element of Γ/±1.
     This is the skeptic's correction [mem for which groups contain −I].
   - Point lights are allowed there, because there are finitely many images.
   - The far clip π (or 2π) is exact only in vacuum.
4. **Better image choice** (estimator only). The measured candidates:
   - BALL3w in E³: 0.31 var × work, against 0.79 for uniform-27.
   - BALL3w in SW: 0.71, with membership and weights from the hyperbolic law of cosines on
     local hit data [checked-num twin §3.2].
   - A light tree over the 27-patch image lights, which is not tested.
5. **Media across cells:**
   - Heterogeneous density read at reduced points (fract in E³).
   - Cell-by-cell tracking in H³.
   - Null interfaces and region state across teleports.
   - The media shadow walker carrying its destination through pairings, under the contract's
     destination rule [checked-code docs/trace-loop-contract.md:128-140].
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
| In-cell-only NEE (thurston's) as the default | gains nothing in SW (var × work ≈ 1.0) and is worse than pt per work in E³ (NEAR 1.14) |
| Position-based or law-of-cosines image identification | not needed while the walk counts crossings; kept for later item 4 |
| `Hit.cell` as an ivec3 | one `int image` serves E³ and H³ |
| An albedo < 1 rule, and a finite-horizon check | maxBounces keeps the measurement finite; a horizon cannot be checked, so the clip is declared |
| Planes, driven placements, straddling objects (Q1, Q2) | not lattice-invariant, no static bound, or need ghosts |
| A GPU crystal in H³; the crystal as a feature | exponential size; it is a witness only |
| Cusps, non-orientable quotients | unbounded tails or flipped frames; not requested |

---

## Owner decisions

1. **The `Hit` change.** Add `int image` in Q1, and `Direction arrival` in Q2, to the locked
   trace-loop type. **Recommend yes.** The walk is the only code that knows which cell it
   reached, so it should say so.
   - *Alternative for Q1:* recompute the image in the MIS code from `round((origin +
     t·dir − hit.p)/L)`. That avoids a type change, but it derives a second time what the walk
     knows, and Q2 needs a Hit change anyway.
2. **A new measurement field `farClip`**, emitted as `MAX_DIST`. It defaults to 1000 outside
   quotients, so E³ programs are unchanged, and it is **required** in quotient programs.
   **Recommend yes.** The crystal witness needs the same clip in both scenes. The right value
   depends on the scene, and the twins show it is the largest error in a quotient render.
   - For the curved design (no edit made): the space supplies the default, and the field
     overrides it.
3. **Delta lights and skies are permanent compile errors in E³ and H³ quotients.**
   **Recommend yes.** Use small sphere or disk lights.
4. **Spanning walls and beams in Q1.** Allow an unrotated box that spans whole periods, or
   allow only objects strictly inside D until ghost copies exist. **Recommend allowing it.** It
   is one Validator rule with no GLSL, and it gives rooms and the classic "jungle gym" picture.
5. **Fog in the first milestone** (Q1b, its own commit) or later. **Recommend Q1b.** Without
   fog the far clip removes 25–40% of the light at moderate R. Fog turns that into a stated
   bound e^{−σR}, and it fades the aliasing of far copies.
