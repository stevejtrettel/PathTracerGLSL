# Transport GLSL target — the emitted loop, function-shaped

**Author:** Fable (July 2026)
**Status:** DRAFT for owner review — this document IS the spec. The three dumps below
are hand-written targets for what the compiler must emit for three representative
programs; the emitters change to produce them only after the owner has read these like
a paper and agreed. Until then nothing is built.
**Context:** follows the §7 re-carve (`fable-components.md` §7, DECIDED + BUILT). That
batch moved *emitter ownership* to the mathematical joints while keeping the emitted
GLSL byte-identical. This batch changes the emitted GLSL itself to express the same
anatomy — and moves the technique bodies from TS strings into `.glsl` files.
**Proof regime:** byte-identity is off the table BY DESIGN. The net is: the witness
suite (veach-mis, cornell-area, X-GLASS, X-FOG, slab, F-ETA — all owner-verified
numbers), glslang over every pair, re-goldened snapshots, GPU timing sanity (the
functions must inline to a wash — StatsPanel GPU timings before/after per witness).

---

## 1. The two rules

**Math is static; policy and plumbing are generated.**

- **Static `.glsl` files** (the research objects, authored like materials are):
  technique bodies — sampling flows, eval expressions, scoring arithmetic. They are
  conditionally *included*, never internally branched: no `#ifdef`, no runtime policy
  branch. If a static file wants two shapes, that is two occupants, not one flexible
  file.
- **Generated glue** (the compiler's specialization, per program): the `combiner_*`
  weight functions, `kernel_record` (the carried-record write), `path_state_init` and
  the `PathState` struct, `roulette`, and the walk (`transport_trace`) itself.

**Static files may touch only the pinned core of `PathState`** — `ray`, `throughput`,
`radiance`. Every program-dependent field (`prev_*`, `current_medium`, `eta_scale`,
`null_crossings`) exists only in some programs, so static text may never name it;
those fields are read/written exclusively inside generated bodies. This single rule is
what makes static files safe under compilation.

## 2. The pinned seam signatures

These signatures are the new contract surface (they join the interface header like
every other seam). Struct-based on purpose: future state (a spectral λ, a curvature
frame) grows `PathState` without touching any signature.

```glsl
// generated per program
PathState path_state_init(Ray ray);
float combiner_w_emitter(PathState s, Hit hit);                  // T1's emitter-hit weight
float combiner_w_env(PathState s);                               // T1's miss weight
float combiner_w_light(int mat, LightSample ls, Direction wo, Hit hit, MaterialProperties props);
float combiner_w_light_medium(LightSample ls, Direction wo_med, MediumProperties m_evt);
void  kernel_record(inout PathState s, float pdf, Point p, bool is_delta);
bool  roulette(inout PathState s, int bounce);                   // false = terminate

// static, from components/transport/techniques/*.glsl (conditionally included)
void kernel_score_miss(inout PathState s);
void kernel_score_emitter_hit(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props);
bool kernel_sample_continuation(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props, out InteractionSample bs);
void kernel_sample_phase(inout PathState s, int med_mat, Point p_evt, Direction wo_med);
void light_sample_direct(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props);
void light_sample_direct_medium(inout PathState s, int med_mat, Point p_evt, Direction wo_med);
```

Inclusion table: `kernel.glsl` always; `kernel_phase.glsl` when scattering;
`light.glsl` when NEE; `light_medium.glsl` when NEE ∧ scattering. The combiner emits
exactly the weight functions the included files call.

## 3. The static files (the once-per-repo text, shown once)

These appear verbatim in every program that includes them — they are the technique
occupants, syntax-highlighted files an author edits the way GGX was written. Shown
here once; the three dumps below then show only what varies.

```glsl
// ── techniques/kernel.glsl — T1, kernel sampling ─────────────────────────────
// One draw serves two estimator terms: the recursion's next segment AND a direct-
// lighting sample scored where it LANDS (the deferred sites below), with the record
// kernel_record carried forward. Weights are the combiner's; this file is the math.

void kernel_score_miss(inout PathState s) {
    // Deferred scoring, boundary case: the sample escaped to the environment.
    s.radiance += s.throughput * combiner_w_env(s) * environment_radiance(s.ray.direction);
}

void kernel_score_emitter_hit(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Deferred scoring: emission keys on region_to (§6.2 — you receive emission from
    // the region ahead, NOT the owner; they differ at exits).
    int mat_emit = material_of(hit.region_to);
    if (!material_is_emissive(mat_emit)) return;
    // No ternary: ANGLE rejects '?:' on struct operands (ESSL restriction).
    MaterialProperties eprops = props;
    if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p);
    s.radiance += s.throughput * combiner_w_emitter(s, hit) * interaction_surface_emission(mat_emit, wo, hit, eprops);
}

bool kernel_sample_continuation(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props, out InteractionSample bs) {
    // Sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
    bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
    if (spectrum_is_black(bs.weight)) return false;
    s.throughput *= bs.weight;
    kernel_record(s, bs.pdf, hit.p, (bs.flags & LOBE_DELTA) != 0u);
    return true;
}

// ── techniques/kernel_phase.glsl — T1's medium sampling site ─────────────────
void kernel_sample_phase(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase sample (§3.5): weight is SPECTRUM_ONE exactly — HG sampling is exact.
    InteractionSample ps = hg_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());
    s.throughput *= ps.weight;
    kernel_record(s, ps.pdf, p_evt, false);
    s.ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset
}

// ── techniques/light.glsl — T2, light sampling (surface site) ────────────────
// Both edge endpoints known immediately: sample, shadow-test, score — all local.

void light_sample_direct(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Pure-delta materials skip NEE: their eval is zero, the march would be wasted.
    if (!material_has_nondelta_lobes(mat)) return;
    LightSample ls = lighting_sample(hit.p, random2());
    if (ls.pdf <= 0.0) return;
    // §6.3 per-channel transmittance; 2·EPSILON back-off (ray_spawn moved the origin
    // up to EPSILON — an area light's own surface can sit at distance−EPSILON).
    Ray shadow_ray = ray_spawn(hit, ls.wi);
    Spectrum vis = shadow_transmittance(shadow_ray, ls.distance - 2.0 * EPSILON);
    if (spectrum_is_black(vis)) return;
    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);   // bare f (§2.2)
    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));           // transport applies the cosine (metric)
    s.radiance += s.throughput * ls.radiance * f * cos_i * vis * combiner_w_light(mat, ls, wo, hit, props) / ls.pdf;
}

// ── techniques/light_medium.glsl — T2's medium site ──────────────────────────
void light_sample_direct_medium(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase EVAL, NO cosine (§2.2 — the cosine is a surface Jacobian).
    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);
    LightSample ls = lighting_sample(p_evt, random2());
    if (ls.pdf <= 0.0) return;
    Spectrum vis = shadow_transmittance(make_ray(p_evt, ls.wi), ls.distance - 2.0 * EPSILON);
    if (spectrum_is_black(vis)) return;
    s.radiance += s.throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis * combiner_w_light_medium(ls, wo_med, m_evt) / ls.pdf;
}
```

Every line above is semantics-preserving relative to today's emitted code — same
expressions, same guards, same order — reorganized into functions. **Equiangular NEE
is one more file of this shape** (a different `p_evt` placement + its pdf), plus its
combiner arm.

---

## 4. Target dump A — fog-area + pt-mis (the maximal program)

Everything below is GENERATED for this program (the static files above are included
verbatim and not repeated). Compare against today's 160-line monolith: the walk is now
the table of contents, and each generated body shows exactly one decision.

```glsl
// ── Path state (generated §3.4-style: the union of fields the included parts declare) ──
struct PathState {
    Ray ray;
    Spectrum throughput;
    Radiance radiance;
    bool prev_was_delta;     // kernel's record: camera "bounce" counts as delta (§6.2)
    float prev_bsdf_pdf;     // kernel's record, MIS: the BSDF side of the power heuristic
    Point prev_p;            //   (reference §8) — written at surface AND medium events
    int current_medium;      // walk, §4.4: THE medium variable — classified, never a stack
    int null_crossings;      // walk, §3.6: nulls have their own safety counter
};

PathState path_state_init(Ray ray) {
    PathState s;
    s.ray = ray;
    s.throughput = SPECTRUM_ONE;
    s.radiance = SPECTRUM_ZERO;
    s.prev_was_delta = true;
    s.prev_bsdf_pdf = 0.0;
    s.prev_p = ray.origin;
    s.current_medium = scene_region_at(ray.origin);   // camera may start inside a medium
    s.null_crossings = 0;
    return s;
}

// ── Combiner (generated): pt-mis — the power heuristic at every shared term ──
float combiner_w_emitter(PathState s, Hit hit) {
    // §6.2: a SAMPLABLE emitter found by a non-delta bounce competes with last
    // vertex's light sample. Path-only emitters and post-delta hits stay full-weight.
    int lid = light_of(hit.region_to);
    if (lid < 0 || s.prev_was_delta) return 1.0;
    return power_heuristic(s.prev_bsdf_pdf, lighting_pdf(s.prev_p, s.ray.direction, lid, hit));
}
float combiner_w_env(PathState s) {
    return 1.0;   // environment not samplable in this program — T1 owns the sky term
}
float combiner_w_light(int mat, LightSample ls, Direction wo, Hit hit, MaterialProperties props) {
    // Delta lights get weight 1 — BSDF sampling can never hit them (§6.4).
    if ((ls.flags & LIGHT_DELTA) != 0u) return 1.0;
    return power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, props));
}
float combiner_w_light_medium(LightSample ls, Direction wo_med, MediumProperties m_evt) {
    // Balances against the phase density — no cosine anywhere (§2.2).
    if ((ls.flags & LIGHT_DELTA) != 0u) return 1.0;
    return power_heuristic(ls.pdf, hg_pdf(ls.wi, wo_med, m_evt));
}

// ── Kernel record (generated): the ONE writer of T1's carried state ──
void kernel_record(inout PathState s, float pdf, Point p, bool is_delta) {
    s.prev_was_delta = is_delta;
    s.prev_bsdf_pdf = pdf;
    s.prev_p = p;
}

// ── Russian roulette (generated): §7.2 — once per iteration, post-weight, both sites ──
bool roulette(inout PathState s, int bounce) {
    if (bounce < 3) return true;
    float p_survive = min(0.95, spectrum_max(s.throughput));   // §2.5: basis-agnostic
    if (random() > p_survive) return false;
    s.throughput /= p_survive;
    return true;
}

// ── The walk (generated): pt over media — the estimator's table of contents ──
Radiance transport_trace(Ray ray) {
    PathState s = path_state_init(ray);
    for (int bounce = 0; bounce < 16; bounce++) {
        Hit hit;
        bool boundary = scene_intersect(s.ray, hit);

        // The volumetric component's call site (§2): one segment, ending at the
        // boundary or far clip; entering/exiting is the interface machinery below.
        int med_mat = material_of(s.current_medium);
        if (material_has_medium(med_mat)) {
            MediumSample ms = medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, random2());
            s.throughput *= ms.weight;
            if (ms.scattered) {
                // ---- MEDIUM EVENT ----
                Point p_evt = ambient_geodesic(s.ray.origin, s.ray.direction, ms.t);
                Direction wo_med = -s.ray.direction;
                light_sample_direct_medium(s, med_mat, p_evt, wo_med);
                kernel_sample_phase(s, med_mat, p_evt, wo_med);
                if (!roulette(s, bounce)) break;
                continue;   // medium events COUNT toward the bounce budget (§7.2)
            }
        }
        if (!boundary) { kernel_score_miss(s); break; }

        // §4.4 self-heal: a missed boundary event mistracks one segment and repairs here.
        if (hit.region_from != s.current_medium) s.current_medium = hit.region_from;
        int mat = material_of(hit.region_owner);   // §4.1: the boundary OWNER's BSDF shades
        // §3.6 null interface: not an optical event — pass through, no bounce consumed.
        if (is_null_interface(mat)) {
            s.current_medium = hit.region_to;
            s.ray = ray_spawn(hit, s.ray.direction);
            s.null_crossings++;
            if (s.null_crossings > 32) break;
            bounce--;
            continue;
        }
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -s.ray.direction;

        kernel_score_emitter_hit(s, hit, mat, wo, props);   // settle last bounce's deferred estimate
        light_sample_direct(s, hit, mat, wo, props);        // NEE: sample + score locally
        InteractionSample bs;
        if (!kernel_sample_continuation(s, hit, mat, wo, props, bs)) break;
        if ((bs.flags & LOBE_TRANSMISSION) != 0u) s.current_medium = hit.region_to;   // §4.4 tracking
        if (!roulette(s, bounce)) break;
        s.ray = ray_spawn(hit, bs.wi);   // escape wi's side along the geodesic
    }
    return s.radiance;
}
```

## 5. Target dump B — veach-mis + pt (plain kernel-only tracer)

No NEE: `light*.glsl` absent, no `combiner_w_light*`, and the combiner's T1 weights are
the identity — visible as one-line bodies instead of hidden as absent code.

```glsl
struct PathState {
    Ray ray;
    Spectrum throughput;
    Radiance radiance;
    bool prev_was_delta;     // written by the record; no reader weights it in pt
};

PathState path_state_init(Ray ray) {
    PathState s;
    s.ray = ray;
    s.throughput = SPECTRUM_ONE;
    s.radiance = SPECTRUM_ZERO;
    s.prev_was_delta = true;
    return s;
}

// Combiner: pt — T1 is the only technique; every weight is 1 (this IS the strategy).
float combiner_w_emitter(PathState s, Hit hit) { return 1.0; }
float combiner_w_env(PathState s) { return 1.0; }

void kernel_record(inout PathState s, float pdf, Point p, bool is_delta) {
    s.prev_was_delta = is_delta;
}

bool roulette(inout PathState s, int bounce) {
    if (bounce < 3) return true;
    float p_survive = min(0.95, spectrum_max(s.throughput));
    if (random() > p_survive) return false;
    s.throughput /= p_survive;
    return true;
}

Radiance transport_trace(Ray ray) {
    PathState s = path_state_init(ray);
    for (int bounce = 0; bounce < 6; bounce++) {
        Hit hit;
        if (!scene_intersect(s.ray, hit)) { kernel_score_miss(s); break; }
        int mat = material_of(hit.region_owner);
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -s.ray.direction;

        kernel_score_emitter_hit(s, hit, mat, wo, props);
        InteractionSample bs;
        if (!kernel_sample_continuation(s, hit, mat, wo, props, bs)) break;
        if (!roulette(s, bounce)) break;
        s.ray = ray_spawn(hit, bs.wi);
    }
    return s.radiance;
}
```

## 6. Target dump C — minimal + direct (one-bounce NEE)

The "cartoon skeleton": maxBounces 1, NEE with a delta light, no RR (`roulette` is not
emitted and never called). This is what a stylized one-shot renderer's transport looks
like — the same techniques, the shortest walk.

```glsl
struct PathState {
    Ray ray;
    Spectrum throughput;
    Radiance radiance;
    bool prev_was_delta;
};

PathState path_state_init(Ray ray) {
    PathState s;
    s.ray = ray;
    s.throughput = SPECTRUM_ONE;
    s.radiance = SPECTRUM_ZERO;
    s.prev_was_delta = true;
    return s;
}

// Combiner: nee — T2 at weight 1; T1's shared-term weight is the binary rule.
float combiner_w_emitter(PathState s, Hit hit) { return 1.0; }   // no samplable emitters in this scene
float combiner_w_env(PathState s) { return 1.0; }                // environment not samplable
float combiner_w_light(int mat, LightSample ls, Direction wo, Hit hit, MaterialProperties props) {
    return 1.0;   // plain NEE: the light sample carries full weight
}

void kernel_record(inout PathState s, float pdf, Point p, bool is_delta) {
    s.prev_was_delta = is_delta;
}

Radiance transport_trace(Ray ray) {
    PathState s = path_state_init(ray);
    for (int bounce = 0; bounce < 1; bounce++) {
        Hit hit;
        if (!scene_intersect(s.ray, hit)) { kernel_score_miss(s); break; }
        int mat = material_of(hit.region_owner);
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -s.ray.direction;

        kernel_score_emitter_hit(s, hit, mat, wo, props);
        light_sample_direct(s, hit, mat, wo, props);
        InteractionSample bs;
        if (!kernel_sample_continuation(s, hit, mat, wo, props, bs)) break;
        s.ray = ray_spawn(hit, bs.wi);
    }
    return s.radiance;
}
```

---

## 7. Costs accepted knowingly (read these before approving)

1. **Trivial combiner bodies appear** (`return 1.0;`) where today the weight machinery
   is simply absent. This is the price of static technique files: the *call* is in
   static text, so the *body* must exist. Drivers constant-fold them to nothing; the
   dump gains a few honest lines that state the strategy explicitly. (Arguably a
   readability WIN: dump B says "every weight is 1" instead of implying it by absence.)
2. **`prev_was_delta` is written but unweighted in pt programs** — exactly as today
   (the record writes are uniform; the pt combiner ignores them). Unchanged, just
   now visible in one place (`kernel_record`).
3. **Function-call shape.** GLSL compilers inline aggressively; we verify with the
   StatsPanel GPU timings on the witness scenes before/after. If any driver regresses
   measurably, the fallback is emitter-side inlining of the SAME files' text — the
   authoring format survives even if the emission strategy changes.
4. **The walk stays generated TS.** Its structure genuinely varies (media/no-media,
   nulls, RR sites); it is the integrator occupant, policy by definition. It is now
   ~40 emitted lines and reads as the estimator's table of contents.

## 8. What this buys (the flexibility acceptance test, restated)

| Arrival | Lands as |
|---|---|
| equiangular medium NEE | `techniques/equiangular.glsl` + descriptor + combiner arm — no other file changes |
| one-shot / Whitted / probes | a new generated walk composing the SAME static functions |
| §11.3 GPU histogram harness | a probe walk — nearly free |
| spectral | `PathState` fields + typedefs — static files untouched (they already write `Spectrum`/`spectrum_*`) |
| H³ / Schwarzschild | `ambient_*` occupant — static files already metric-disciplined (`ambient_dot`, `ambient_geodesic`, `ray_spawn`) |

## 9. Batch plan (after approval)

1. Emit the generated glue (`PathState`, combiner, record, roulette) + include the
   static files; the walk emitter shrinks to the orchestrator. Techniques' TS emitters
   become descriptors (fields-read/state-declared/seams-called) + the `.glsl` files.
2. Gates: glslang all pairs, snapshots re-goldened (REVIEWED, not rubber-stamped —
   this batch's diffs are real), tsc + vitest, purity test.
3. GPU: witness sweep (furnace 0.4, slab numbers, F-ETA 0.554, X-FOG/X-GLASS/veach
   three-way convergence) + timing comparison on cornell + fog-area + veach.
4. Docs: this file's status flips to BUILT; fable-components §7 gains the "GLSL
   matches the anatomy" note; CLAUDE.md synced.
