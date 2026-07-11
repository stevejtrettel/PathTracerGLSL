# Impl plan — area lights: quad + sphere emitters, NEE first, MIS second

> **STATUS: DONE (July 2026).** Both phases landed and owner-GPU-verified: pt / pt-nee / pt-mis
> converge on all three witnesses (cornell-area, cornell-area-glass, fog-area — X-FOG passing
> retires the media plan's deferred haze-equality item). One bug found at bring-up, now fixed
> and documented at the call sites: area lights self-shadowed surfaces facing them (`ray_spawn`'s
> normal offset vs the `maxDist` back-off — widened to 2·EPSILON at both NEE sites; the 2×
> couples to the spawn offset). §6.2's "two-sided thin quads" aside is annotated in the
> contracts: quads are ONE-SIDED as pinned below. The deferred table stands.

Samplable area lights on the region machinery: the §6.2 unified registry (`light_of`), quad +
sphere samplers in solid-angle measure, the emission double-count bookkeeping, then MIS as the
three-line diff. Two phases with a convergence wall between them; every generated branch gets a
scene that summons it (module-anatomy §4 discipline).

**Provenance:** contracts §6.1 (LightSample, measure conventions — verified originally in the
archive's MULTI_LIGHT_SAMPLING work), §6.2 (registry, `light_of` on REGIONS not materials,
`region_to` side convention, the w-bookkeeping — traced through all six delta/diffuse × strategy
combinations in fable-transport-verification), §6.4 (power heuristic β=2), §1.1 V1-C2 (samplable
lights analytic only); reference-implementations §6 (quad sampler, VISIBLE-CONE sphere sampler,
CDF dispatcher with `cdf_rescale`, `lighting_pdf` signature) and §8 (the MIS diff — exactly three
lines change from NEE-only); validation-scenes §4 (X-CORNELL / X-FOG / X-GLASS, the §11.2
cross-strategy protocol); module-anatomy §5 (lights are a mix-many family) + §7 staging (build on
today's hand-written plumbing; descriptors arrive with the deferred reorg). Renderer comparison
(July 2026): this architecture is pbrt's, compile-time-specialized — power selection = pbrt-v4
`PowerLightSampler` (`Φ = π·A·Le`), one-sided default matches pbrt/Mitsuba, region-keyed identity
reconstructs their per-shape emitter invariant.

**Owner decisions (July 2026 discussion):**
1. Quads AND spheres in Phase A (both reference samplers are audited transcription targets).
2. `'quad'` becomes a real analytic-backend shape (hittability is non-negotiable — §6.2: every
   hittable light is a region; panels must appear in reflections).
3. Both authoring routes, one planned representation: explicit `scene.lights` entries desugar to
   synthesized region + emissive material + registry entry; `sampleAsLight` on an emissive
   material over an analytic quad/sphere object is the same registry entry without synthesis.
4. Staging: Phase A = NEE-on-areas with the FULL §6.2 w-bookkeeping (MIS branch stubbed to 0.0);
   Phase B = MIS. `directLighting: 'mis'` is Validator-REJECTED in Phase A (today it silently
   compiles as plain NEE — a trap) and implemented in Phase B.
5. Authoring shapes mirror point lights: `{kind:'quad', corner, edge1, edge2, intensity, color?}`,
   `{kind:'sphere', position, radius, intensity, color?}`; radiance = color·intensity.

**Pinned deviation:** quads are **ONE-SIDED**, both ways at once — the sampler returns `pdf = 0`
behind the emitter (reference §6.1) AND the hit side keys emission on `region_to`, which for a
back-face hit of a zero-thickness quad is the region *behind* it, not the quad. Sampler and
hit-side agree; §6.2's "naturally two-sided for thin synthesized quads" aside does not survive
our entering/exiting classifier — annotate §6.2 when implementing. (pbrt's `DiffuseAreaLight` is
one-sided by default too; a `twoSided` flag is deferred.)

---

## The pitfall checklist (mined from reference/ + archive, July 2026 — review against ALL of these)

1. **No 1/d² in area-light radiance** — the falloff IS the `d²/(A·cosθ)` pdf ("classic
   double-falloff bug"). Only delta lights fold falloff into radiance.
2. **Back-face samples return `pdf = 0`, never `pdf = 1, radiance = 0`** (the old GLSL's form —
   harmless for NEE, poison for MIS).
3. **Sphere lights sample the VISIBLE CONE** (`pdf = 1/(2π(1−cos_max))`, directly solid-angle) —
   not the whole surface (old `sphere-light.glsl` wasted half its samples). Inside-the-sphere:
   `pdf = 0` punt in v1 (pbrt falls back to uniform-area sampling — deferred).
4. **Never reuse the selection random for surface sampling** — `cdf_rescale` recovers a fresh
   stratified coordinate from the selection draw (the MULTI_LIGHT_SAMPLING xi-reuse bug).
5. **CDF selection has no fallthrough** — the final `else` arm closes it (the old
   `return NUM_SAMPLABLE-1` fallback masked an uninitialized-LightSample bug).
6. **Selection power is area-aware**: quad `π·A·avg(Le)`, sphere `π·4πr²·avg(Le)`, point
   `4π·avg(I)` — luminance-only weighting mis-prioritizes a big dim panel vs a tiny bright one.
7. **Cosine exactly once, applied by transport, surfaces only** (bare-f §2.2; the old code folded
   it into shade — mixing conventions silently biases every NEE estimate).
8. **Emitter double-count**: the §6.2 w-bookkeeping (below) — old pt + old NEE combined would
   have double-counted every emitter.
9. **Light identity on regions** (`light_of(region_id)`), never materials — two panels sharing
   one emissive material are two lights; material-keying makes `lighting_pdf` ambiguous.
10. **Emission keys on `region_to`** (audit-fixed; owner-keying leaks emission at exits).
11. (env, deferred item) `environment_pdf` must byte-match `environment_sample` incl. the sinθ
    Jacobian — the old `hdri-importance.glsl` machinery is correct, carry it intact.
12. **Delta lights are excluded from BSDF-side MIS entirely** (never hittable; `lighting_pdf`
    never queried for them; their NEE weight is 1).
13. Const-vs-uniform light storage hides behind the accessor pattern when `Value<T>` light params
    arrive (archive needed two code paths without it).
14. **Emissive SDFs stay path-only** (`sampleAsLight: true` on SDF = Validator error) — nobody
    analytically samples emissive implicits; even production meshes them. Weight 1, they glow.
15. **Reference code gets its own adversarial pass** — paper audits reduce bugs, the §11
    harnesses (cross-strategy convergence) are ground truth.

---

## Phase A — NEE on area lights

**A0. Types / Analyzer / Validator.**
- `types.ts`: `QuadLight {kind:'quad', corner: Vec3, edge1: Vec3, edge2: Vec3, intensity, color?}`,
  `SphereLight {kind:'sphere', position, radius, intensity, color?}` join `LightDescription`;
  `MaterialDescription.sampleAsLight?: boolean` (§6.2 — default true for emissive materials on
  analytic quad/sphere objects, false otherwise; no current scene changes behavior).
- Analyzer: `lighting.areaLightCount`, `hasSamplableAreaLights` (explicit area lights ∪
  emissive+samplable analytic regions).
- Validator: degenerate geometry errors (`|edge1 × edge2| > 0`, `radius > 0`); V1-C2:
  `sampleAsLight: true` on a non-analytic (SDF) object = error, on quad/sphere = fine;
  **`directLighting: 'mis'` rejected-not-removed** ("MIS lands in phase B" — closes the
  silent-NEE hole); directional lights stay rejected.

**A1. The quad analytic primitive** (`StandardAnalytic` gains `'quad'`): `ray_quad(Ray, corner,
edge1, edge2, out t)` in analytic_primitives.glsl (plane test + parametric inside test) + the four
intersection.ts arms (test / normal `normalize(cross(edge1, edge2))` / signed distance — a thin
quad is never `< 0`, so it never claims containment: correct) . Quads become authorable geometry
generally (walls, panels) — a bonus, not the goal.

**A2. Planner — the desugar + registry.**
- Explicit quad/sphere lights → append a synthesized `PlannedAnalyticObject` (region id from the
  same `objectIndex` counter, AFTER user objects) + a synthesized emissive material
  (`__light_<n>`, lambert, albedo 0, emission = color·intensity) + a
  `PlannedSamplableLight {lightId, regionId, kind, geometry, radiance}` registry entry.
- `sampleAsLight` route: emissive material + analytic quad/sphere object → registry entry only.
- Point lights join the registry as delta entries (no region). `RenderPlan.samplableLights`
  replaces the bare `lights` list as codegen input; light ids are registry order.

**A3. Codegen.**
- `glsl/light_quad.glsl` + `glsl/light_sphere.glsl` — TRANSCRIBE reference §6.1/§6.2 exactly:
  quad `pdf = d²/(A·cos_l)`, back-face `pdf = 0`; sphere visible-cone, inside-punt `pdf = 0`;
  both `flags = 0u` (non-delta), `radiance = Le` (no falloff).
- lighting.ts dispatcher: per-kind `sampleCall` arms; CDF over registry with area-aware power
  (pitfall 6); `cdf_rescale` (pitfall 4); no fallthrough (pitfall 5); `ls.pdf *= select_pdf`;
  `ls.light_id = <registry id>`.
- intersection.ts: generated **`light_of(int region)`** table (§2.3 family, beside material_of /
  ior_of) — samplable-light id per region, −1 default. Emitted only when samplable area lights
  exist (media-free/area-free scenes byte-identical modulo nothing).
- Shadow query: unchanged — `ls.distance - EPSILON` stops the shadow ray short of the sampled
  point ON the emitter; the emitter is real geometry in `scene_intersect_any`/shadow_media
  (correct: panels block other lights' shadow rays).

**A4. Transport — the §6.2 emission bookkeeping** (inside the existing `material_is_emissive`
gate; the MIS branch arrives in B):

```glsl
int mat_emit = material_of(hit.region_to);
if (material_is_emissive(mat_emit)) {
    MaterialProperties eprops = props;
    if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p);
#ifdef ENABLE_NEE
    // §6.2: a SAMPLABLE emitter found by a non-delta bounce was already counted by NEE at the
    // previous vertex → w = 0. Path-only (light_of < 0), post-delta, and camera (prev_was_delta
    // init true) stay full-weight. MIS (phase B) swaps the 0.0 for the power heuristic.
    float w = (light_of(hit.region_to) < 0 || prev_was_delta) ? 1.0 : 0.0;
    radiance += throughput * w * interaction_surface_emission(mat_emit, wo, hit, eprops);
#else
    radiance += throughput * interaction_surface_emission(mat_emit, wo, hit, eprops);
#endif
}
```

`prev_was_delta` finally gets its reader. Under `directLighting:'none'` emission stays
full-weight — that is WHY pt converges to the same image as pt-nee. Point-light-only scenes:
`light_of ≡ −1` → `w ≡ 1` → images unchanged (a gate).

**A5. Scenes (every branch summoned).**
- **`cornell-area`** (X-CORNELL): the Cornell box with the point light replaced by a ceiling
  quad (explicit `kind:'quad'`, visible in renders). Strategies: pt-nee (key 1) vs pt (key 2).
  **Expect: both converge to the same image** (§11.2 protocol: RMSE < 1.5% at 4096 spp excluding
  top 0.1% pixels); divergence implicates the w-bookkeeping, the quad pdf, or shadow offsetting.
- **`orb`** (sphere-light summoning scene): a glowing sphere (via `sampleAsLight` — the second
  authoring route gets exercised) over a floor with a matte + a glass object. pt-nee vs pt pair,
  same convergence expectation; the orb must be VISIBLE and appear in the glass reflections.

Gate: cornell-area + orb convergence pairs; two-light/cornell (delta-only) images unchanged;
suite + snapshot + typecheck; area-light-free scenes get no light_of table.

## Phase B — MIS (the three-line diff + the medium-side line)

**B1. Transport state:** `float prev_bsdf_pdf` + `Point prev_p`, stored after every surface BSDF
sample and every medium phase sample (both already return `.pdf`).

**B2. Generated `lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit)`** (§6.1
signature — light identity known from the hit, no search): per-kind solid-angle pdf recomputed
from the hit geometry (quad: `d²/(A·cos_l)`; sphere: cone pdf from p), × the same compile-time
`LIGHT_SELECT_PDF[light_id]`. Delta lights never queried (pitfall 12).

**B3. The diff (reference §8, transcribe):**
1. Emitter hit: the A4 `0.0` becomes
   `power_heuristic(prev_bsdf_pdf, lighting_pdf(prev_p, current_ray.direction, lid, hit))`.
2. Surface NEE gains `w_l = (ls.flags & LIGHT_DELTA) != 0u ? 1.0 :
   power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, props))` — the generated
   `interaction_surface_pdf` dispatcher finally gets its reader.
3. Medium NEE gains the same (2)-shaped weight with `hg_pdf(ls.wi, wo_med, m_evt)` — medium-side
   MIS rides Phase B (reference §8's closing line), which is what makes X-FOG buildable.
`power_heuristic(pf, pg) = pf²/(pf² + pg²)` in math.glsl. `ENABLE_MIS` define; Validator admits
`'mis'`; Planner `LightingDesc` carries `method: 'nee' | 'mis'`.

**B4. Witnesses.**
- **cornell-area goes three-way**: pt / pt-nee / pt-mis (keys 1-3), all pairs RMSE < 1.5%.
- **`cornell-area-glass`** (X-GLASS): + the glass sphere — delta-bookkeeping stressor
  (`prev_was_delta` propagation through specular chains, NEE skipped at glass, emitter weight 1
  after delta). Noisiest pair — double spp before suspecting bias.
- **`fog-area`** (X-FOG proper — the resurrected haze equality pair): cornell-area + grayscale
  ambient haze (σ_s 0.4, σ_a 0.05, g 0.6). pt vs pt-nee vs pt-mis: the pair that exposes
  hg_eval/hg_sample desync AND the medium-NEE weights, now buildable because the light is
  hittable. This retires the media plan's deferred haze-equality item.

Gate: all three witnesses' strategy pairs converge (§11.2); Phase-A scenes unchanged under their
existing strategies; delta-only scenes still byte-stable.

---

## Deferred — mapped, not dropped

| Piece | Lands with |
|---|---|
| **Spherical-rectangle quad sampling** (Ureña et al. 2013 — pbrt-v4's upgrade; solid-angle-exact, kills close-to-panel variance; drop-in body swap behind the same LightSample signature) | when a scene shows the close-panel noise |
| **Inside-sphere-light fallback** (uniform-area sampling like pbrt, replacing the `pdf = 0` punt) | first camera-inside-a-lamp scene |
| Environment as samplable light (the old `hdri-importance.glsl` CDF machinery + sinθ Jacobian, env MIS line from reference §8.3) | env-as-light item (tabulated environments, §2.10 proving case c) |
| Two-sided quads (`twoSided` flag à la pbrt) | first light-through-a-panel scene |
| Light BVH / many-lights selection (pbrt-v4 BVHLightSampler, Arnold adaptive) | hundreds-of-lights regime, with §4.7 batches |
| Emissive-SDF sampling (archive open question #10) | honestly open — even production meshes instead |
| Textured / IES / spot lights | reader-driven |
| Equiangular medium-NEE placement (per-light distance sampling — now MIS-composable) | unchanged from media plan |
| Transmissive emitters seen from inside; emission side flags | §10.2 |
| Light descriptors (`lights/point.{glsl,ts}` pairs) | the deferred reorg pass (module-anatomy §7) |

## Pinned constants & conventions

One-sided quads (deviation note above, annotate §6.2). Synthesized materials named `__light_<n>`
(collision-proof, invisible to authors). Registry order = light id. Delta lights: `pdf = 1`,
`LIGHT_DELTA`, falloff folded — unchanged. Area: `flags = 0u`, solid-angle pdf, bare Le.
`w`-bookkeeping under `ENABLE_NEE` only. `light_of` emitted only when samplable non-delta lights
exist. Power formulas per pitfall 6.

Verification chain: A (cornell-area + orb pairs converge; delta-only scenes unchanged) →
B (three-way cornell-area, X-GLASS, X-FOG). Then GGX (§7 reference, whose highlights need area
emitters) and tabulated environments are the natural successors.
