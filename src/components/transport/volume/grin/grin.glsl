// grin.glsl — the gradient-index (variable-IOR) region walker (fable-variable-ior.md).
//
// A DEFLECTING medium: instead of the straight scatter/absorb walk, integrate the ray ODE of the
// optical metric n²(x)·δ and hand back the BENT exit ray. NORMATIVE SOURCE (transcribe, don't
// re-derive): Sharma, Kumar & Ghatak 1982, "Tracing rays through graded-index media" (Appl. Opt.
// 21(6)) — state (r, T) with T = n·(unit tangent): dr/dt = T, dT/dt = n·∇n.
//
// INTEGRATOR — velocity Verlet (leapfrog), symplectic. The force n·∇n = ∇(n²/2) depends only on
// POSITION, so the ODE is the Hamiltonian system r'' = ∇Φ with potential Φ = n²/2 (conserved
// energy ½(|T|²−n²) = 0 ⇒ the |T| = n invariant). Verlet is the natural integrator for it: ONE
// force evaluation per step (vs four for RK4), and it PRESERVES the phase-space measure — |T|=n
// stays bounded (RK4 drifts) and etendue/brightness stay honest over long paths.
//
// n(x) is read through `ior_at` (NOT MediumProperties — ior is consumed by its GRADIENT, sampled
// at many nearby points; the value-bundle struct is for σ_a/σ_s/ε). ∇n is central finite
// differences of ior_at (the SDF-normal trick). Marches until the ray leaves the medium,
// then returns the bent ray from just INSIDE the wall — the wall's MATERIAL owns the interface
// (impl-plan-grin-interface): 'none' = continuous-n pass-through, dielectric = Snell/Fresnel/TIR
// with the local n(exit_p) via ior_of(region, p). Per-step Beer–Lambert absorption (σ_a, colored,
// value-consumed via scene_medium_properties) + per-step EMISSION collection (impl-plan-grin-media
// batch 1: the E1.5 closed form per step × the (n₀/n)² basic-radiance source factor) + the
// interior L/n² factor. The absorbing walker's path is DETERMINISTIC (xi unused there — only
// Verlet truncation bounded by the adaptive step) up to the long-traversal roulette, which draws
// from the stream only past GRIN_ROUND_STEPS steps; the SCATTERING arm below (batch 2) consumes
// xi for the analytic channel-MIS draw in arc length. t_max IS respected (the near-wall
// straight-transmit guard). Geometry-free interior (§7).
//
// Depends on: ior_at (generated — n(x)), scene_medium_properties (generated — σ_a/σ_s/ε fields),
// random (sampler — the long-traversal roulette),
// medium_emission (generated — the zero-folding ε accessor), ambient_geodesic (core),
// scene_region_at + material_of (generated — the exit test, grin_inside), MediumSample (structs_media), spectrum_exp (core
// math). The step is ADAPTIVE
// (the DS_MAX/DTOL limiters below — strong fields, e.g. black holes) with GRIN_STEP as its smooth-
// field ceiling; analytic ∇n (autodiff the ior formula) is the remaining declared polish.

// LONG TRAVERSALS — Russian roulette in rounds. A traversal of the region is ONE event for
// measurement.maxBounces however many steps it takes (step counts belong to the integrator, not
// the path: taxonomy §4.1). Long and trapped traversals (a Maxwell fisheye orbit, rays circling a
// black hole's photon sphere) are ended by roulette instead: every GRIN_ROUND_STEPS steps the ray
// survives with probability GRIN_ROUND_SURVIVAL and a survivor's weight is divided by it. That is
// unbiased — E[weight] is unchanged — and it may depend on step counts because it only changes
// the noise. Radiance already collected stays on a kill: it belongs to the traversal's prefix,
// which is counted with probability 1. Smooth lenses leave within ~100 steps and never draw.
// GRIN_MAX_ROUNDS is the loop's hard stop, a step limit that must be unreachable: a traversal
// reaches it with probability GRIN_ROUND_SURVIVAL^(GRIN_MAX_ROUNDS − 1) = 0.9^199 ≈ 8e-10.
#ifndef GRIN_ROUND_STEPS
#define GRIN_ROUND_STEPS 512
#endif
#ifndef GRIN_ROUND_SURVIVAL
#define GRIN_ROUND_SURVIVAL 0.9
#endif
#ifndef GRIN_MAX_ROUNDS
#define GRIN_MAX_ROUNDS 200
#endif
#ifndef GRIN_STEP
#define GRIN_STEP 0.02          // Verlet parameter step ceiling (coordinate length ≈ n·h)
#endif
#ifndef GRIN_GRAD_EPS
#define GRIN_GRAD_EPS 0.001     // central-difference epsilon for ∇n — STANDALONE FALLBACK ONLY:
                                // compiled programs receive the compiler-owned header define
                                // (intersection.ts GRIN_GRAD_EPS — it also floors analytic spawn
                                // offsets there); this default must match it (epsilonCoupling.test)
#endif
#ifndef GRIN_BISECT_ITERS
#define GRIN_BISECT_ITERS 8     // exit refinement: crossing bracketed to n·h/2^8 before the pull-back
#endif
// GRIN_EXIT_PULLBACK — how far INSIDE the wall the handoff point lands. Keyed to the
// WALKER'S OWN residuals, never to fp (impl-plan-epsilon-discipline; the Aug 12 audit
// killed an fp-relative re-key): the bisection above brackets the crossing only to
// ds/2^GRIN_BISECT_ITERS ≤ GRIN_DS_MAX·(1+GRIN_DTOL/2)/256 ≈ 2.0e-4, and a MARCHED wall
// additionally has its acceptance band (march_epsilon ≤ 5e-4) — the handoff must land
// strictly inside `med`, because the walk neither flips current_medium nor re-spawns
// there (pt.ts): an outside landing makes the next call rewind and burn bounces. Must
// also stay BELOW the t_max micro-segment guard (min(n0·GRIN_STEP, GRIN_DS_MAX)) or the
// handoff never terminates. Coupling pinned by tests/components/epsilonCoupling.test.ts.
#ifndef GRIN_EXIT_PULLBACK
#define GRIN_EXIT_PULLBACK 0.002
#endif
// Strong-field limiters + capture (transcribed from the reference odeMarch — PathTracer
// docs/curved-light-blackhole.md; pulled by the Majumdar–Papapetrou demo). With |T| = n a FIXED
// parameter step makes the coordinate jump h·n blow up near a black-hole point (n → ∞ there):
// the ray leaps over the strong field, samples ∇n at garbage points, and diverges — rendering
// as concentric black rings. The per-step h is bounded by two limiters (far from mass neither
// binds and h = GRIN_STEP, so smooth/weak media are unchanged):
#ifndef GRIN_DS_MAX
#define GRIN_DS_MAX 0.05        // max COORDINATE step h·n — caps the |T| = n blow-up near a hole
#endif
#ifndef GRIN_DTOL
#define GRIN_DTOL 0.05          // max change of n per step: h·|∇n| ≤ DTOL (strong-field accuracy)
#endif
#ifndef GRIN_CAPTURE
#define GRIN_CAPTURE 50.0       // n above this = captured (the horizon): for a single MP hole this
#endif                          // is r < M/(√50−1) ≈ M/6 — well inside the photon sphere at r = M,
                                // so terminating there is EXACT for the rendered image. The shadow
                                // is pure dynamics, not drawn geometry. Inert for weak fields
                                // (Luneburg peaks at √2).

float grin_n(int med, vec3 p) {
    return max(ior_at(med, p), 1e-3);   // fp-safety floor (physical n ≥ 1)
}

vec3 grin_grad_n(int med, vec3 p) {
    vec2 e = vec2(GRIN_GRAD_EPS, 0.0);
    return vec3(
        grin_n(med, p + e.xyy) - grin_n(med, p - e.xyy),
        grin_n(med, p + e.yxy) - grin_n(med, p - e.yxy),
        grin_n(med, p + e.yyx) - grin_n(med, p - e.yyx)
    ) / (2.0 * GRIN_GRAD_EPS);
}

// Is p still inside this walker's medium? `med` is a MATERIAL id — the dispatcher passes the
// material, and ior_at / scene_medium_properties take the same id — so the exit test asks
// the material at p, via material_of. (Until Sep 25 2026 it compared scene_region_at's REGION
// id with `med` directly, which is right only when the two numberings coincide: in every GRIN
// demo the lens was region 1 AND material 1, but in the six-plane furnaces it is region 6 and
// material 1 or 2, so the walker "left" at its first step, rewound outside, re-entered, and
// burned the bounce budget — those lenses rendered black.) Leaving the MEDIUM rather than the
// region is also the physically right exit: a wall between two regions of the same material
// has the same n(p) on both sides, so walking through it changes nothing; and an ambient GRIN
// medium (region −1) is handled by the same test.
bool grin_inside(int med, vec3 p) {
    return material_of(scene_region_at(p)) == med;
}

// The conservative force F(r) = n·∇n = ∇(n²/2) — position-only (the Verlet enabler).
vec3 grin_force(int med, vec3 r) {
    return grin_n(med, r) * grin_grad_n(med, r);
}

// Interior basic-radiance factor (impl-plan-grin-interface): along a curved ray in varying n,
// L/n² is invariant, so camera-path throughput over the interior carries (n_in/n_out)² — the
// continuous twin of the dielectric's η² line. |T| = n is carried by the integrator, so the
// factor is free — and |T|, not a fresh ior_at(p), is the RIGHT n here: Verlet exactly
// conserves a nearby "shadow" Hamiltonian, whose index along the computed trajectory is |T|,
// so ratios of |T| are consistent with the ray actually traced. (Sep 25 2026, measured:
// evaluating n exactly at the exit/event points instead biased grin-furnace-scatter +0.25%,
// 0.40101 ± 0.00002 over salts; the |T| form reads 0.4000.) Mirrored into ms.eta_scale so the §7.2 RR metric divides the compression
// back out (exactly the surface transmission site's bookkeeping). Books close: enter (1/n_A)²
// · interior (n_A/n_B)² · exit (n_B/1)² = 1 for a lossless region — and under the continuous
// n→1 wall contract the factor is 1, so 'none'-wall scenes are unchanged.
void grin_finish(inout MediumSample ms, float n_in, float n_out, Spectrum absorb) {
    float er = n_out / n_in;              // n_in floored by grin_n; n_out = |T| > 0
    ms.weight    = absorb / (er * er);
    ms.eta_scale = er * er;
}

// A traversal that ends inside the region with nothing coming back: captured by a black-hole
// point (nothing returns from beyond it), killed by the long-traversal roulette, or at the hard
// stop. Zero weight, not deflected; ms.radiance keeps what the traversal collected before it
// ended (glowing gas in front of a hole stays visible). The walk's throughput goes to zero.
MediumSample grin_killed(MediumSample ms, float t_max) {
    ms.scattered = false;
    ms.deflected = false;
    ms.eta_scale = 1.0;
    ms.t = t_max;
    ms.weight = SPECTRUM_ZERO;
    return ms;
}

// Seam-1 GRIN arm: integrate the ray ODE from ray.origin/direction until the ray leaves region
// `med`; return the bent ray from just INSIDE the wall (deflected outcome). The wall interaction
// is NOT subsumed (impl-plan-grin-interface): the walk spawns the exit ray, the next iteration's
// scene_intersect hits the boundary from inside, and the wall's MATERIAL decides the interface —
// 'none' pass-through (continuous n, v1) or dielectric Snell/Fresnel/TIR with the local n at the
// exit point (ior_of(region, p) = this medium's formula). The walker walks; the wall decides.
MediumSample medium_sample_grin(int med, Ray ray, float t_max, vec2 xi) {
    MediumSample ms;
    ms.scattered = false;
    ms.radiance = SPECTRUM_ZERO;

    float n0 = grin_n(med, ray.origin);

    // THE t_max GUARD: the straight-line boundary (scene_intersect's hit.t) is within one step
    // — fly straight instead of relaunching the walker on a sub-resolution segment (this is
    // what terminates the near-wall handoff: the previous deflected return parked the ray
    // GRIN_EXIT_PULLBACK inside the wall). Deflection below one step is below the integrator's
    // resolution anyway — declared, consistent truncation. Transmitted outcome: the walk falls
    // through to the surface hit and the wall material fires there. Emission over the
    // micro-segment rides the E1.5 closed form (n change is sub-resolution — factor 1).
    if (t_max <= min(n0 * GRIN_STEP, GRIN_DS_MAX)) {
        MediumProperties mg = scene_medium_properties(med, ray.origin);
        Spectrum sag = max(mg.sigma_a, Spectrum(1e-6));
        ms.deflected = false;
        ms.eta_scale = 1.0;
        ms.t = t_max;
        ms.weight = spectrum_exp(-sag * t_max);
        ms.radiance = medium_emission(mg) * (SPECTRUM_ONE - ms.weight) / sag;
        return ms;
    }

    ms.deflected = true;
    ms.t = 0.0;

    vec3 r = ray.origin;
    vec3 T = n0 * ray.direction;               // T = n·(unit tangent) at the actual entry index
    vec3 F = grin_force(med, r);               // carried across steps — velocity Verlet reuses it
    Spectrum absorb = SPECTRUM_ONE;

    for (int i = 0; i < GRIN_MAX_ROUNDS * GRIN_ROUND_STEPS; i++) {
        // Round boundary: the long-traversal roulette (header). absorb weights everything
        // collected from here on, so dividing it carries the survivor compensation.
        if (i > 0 && i % GRIN_ROUND_STEPS == 0) {
            if (random() >= GRIN_ROUND_SURVIVAL) return grin_killed(ms, t_max);
            absorb /= GRIN_ROUND_SURVIVAL;
        }

        // n from the carried |T| = n invariant (exact at entry, symplectically bounded after) —
        // the limiters and the capture test need no extra field evaluation.
        float n = length(T);

        // CAPTURE (black-hole horizon): the ray has essentially reached the singular point —
        // nothing returns from BEYOND it, so what remains is exactly the radiance already
        // collected along the sightline (ms.radiance — glowing gas in front of the hole
        // stays visible; the plunge itself contributes zero). A deterministic zero-weight
        // terminator: the walk's throughput goes to zero and roulette reaps the path.
        if (n > GRIN_CAPTURE) return grin_killed(ms, t_max);

        // The adaptive step: h·n ≤ DS_MAX (coordinate cap) and h·|∇n| ≤ DTOL (field-change
        // cap, |∇n| = |F|/n). Far from mass neither binds and h = GRIN_STEP.
        float h = min(GRIN_STEP, GRIN_DS_MAX / n);
        h = min(h, GRIN_DTOL * n / max(length(F), 1e-6));

        // Velocity Verlet for r'' = F(r): half-kick → drift → half-kick.
        vec3 T_half = T + 0.5 * h * F;
        vec3 r_next = r + h * T_half;

        // Exit: the drift crossed out of the region (geometry-free interior ⇒ leaving `med` is
        // the only boundary). Bisect the drift segment for the crossing, then PULL BACK
        // GRIN_EXIT_PULLBACK along the drift so the returned point sits strictly INSIDE the
        // wall (above the bisection residual AND a marched wall's acceptance band — see the
        // define) with the exit hit at t ≈ GRIN_EXIT_PULLBACK in ALL geometries including
        // grazing (the pull-back is along the RAY, so the wall-hit distance is
        // angle-independent to first order). The exit direction is the drift
        // tangent T_half — deliberately NOT the second half-kick, which would evaluate ∇n
        // outside the region where authored formulas need not be total. Absorption/emission
        // charge only the traveled fraction of the step.
        if (!grin_inside(med, r_next)) {
            float lo = 0.0, hi = 1.0;
            for (int j = 0; j < GRIN_BISECT_ITERS; j++) {
                float mid = 0.5 * (lo + hi);
                if (grin_inside(med, r + (mid * h) * T_half)) lo = mid; else hi = mid;
            }
            float n_exit  = length(T_half);
            float t_cross = hi * h * n_exit;                       // world distance from r to the crossing
            float t_exit  = t_cross - GRIN_EXIT_PULLBACK;          // may rewind past r at grazing — by design
            MediumProperties me = scene_medium_properties(med, r);
            Spectrum sae = max(me.sigma_a, Spectrum(1e-6));
            Spectrum tre = spectrum_exp(-sae * max(t_exit, 0.0));
            ms.radiance += absorb * ((n0 * n0) / (n * n)) * medium_emission(me) * (SPECTRUM_ONE - tre) / sae;
            absorb *= tre;
            ms.exit_dir = normalize(T_half);
            ms.exit_p   = r + t_exit * ms.exit_dir;
            grin_finish(ms, n0, n_exit, absorb);
            return ms;
        }

        // Per-step source + attenuation over ds = |Δr| = |T_half|·h — the E1.5 closed form
        // per step (σ_a floored 1e-6 for pair consistency; for CONSTANT coefficients the sum
        // TELESCOPES to the inline arm's exact result). Emitted radiance at index n reaches
        // the segment start (index n₀) scaled by (n₀/n)² — basic radiance L/n² invariance,
        // paid by the carried |T| = n (impl-plan-grin-media batch 1).
        MediumProperties mp = scene_medium_properties(med, r);
        Spectrum sa = max(mp.sigma_a, Spectrum(1e-6));
        Spectrum step_tr = spectrum_exp(-sa * (length(T_half) * h));
        ms.radiance += absorb * ((n0 * n0) / (n * n)) * medium_emission(mp) * (SPECTRUM_ONE - step_tr) / sa;
        absorb *= step_tr;

        vec3 F_next = grin_force(med, r_next);   // THE one force evaluation per step (reused next)
        T = T_half + 0.5 * h * F_next;
        r = r_next;
        F = F_next;
    }

    // The hard stop (probability ≈ 8e-10 per traversal — header).
    return grin_killed(ms, t_max);
}

// Seam-1 GRIN SCATTERING arm (impl-plan-grin-media batch 2): the analytic arm's channel-MIS
// (fable-volumetric-component §4, pbrt-v3 uniform channel selection) transcribed to ARC LENGTH.
// For CONSTANT σ_t (Validator-guaranteed on a scattering deflecting medium) free flight along
// the bent path obeys the same exponential law in arc length, so the draw happens UP FRONT and
// the Verlet walk just finds where the sampled arc lands: a scatter event inside the region
// (the EVENT RAY — drift point + tangent — rides exit_p/exit_dir; a bent event is not
// recomputable from (origin, dir, t)), or the wall first (the survive weight at the DISCOVERED
// exit arc — the same measure split with t_max discovered rather than passed). Every outcome
// carries the interior (n₀/n)² basic-radiance factor with its eta_scale mirror. No emission
// here (σ_s + ε on a deflecting medium is Validator-rejected — the declared cut).
MediumSample medium_sample_grin_scatter(int med, Ray ray, float t_max, vec2 xi) {
    MediumSample ms;
    ms.scattered = false;
    ms.radiance = SPECTRUM_ZERO;

    MediumProperties m0 = scene_medium_properties(med, ray.origin);
    Spectrum sigma_t = m0.sigma_a + m0.sigma_s;       // constant over the region (Validator)
    float n0 = grin_n(med, ray.origin);

    // Channel-MIS draw, up front: uniform channel, exponential target arc s*.
    int   c  = min(int(xi.x * 3.0), 2);
    float sc = max(sigma_t[c], 1e-9);
    float s_star = -log(1.0 - xi.y) / sc;

    // t_max guard (the near-wall handoff terminator, as in the deterministic arm): resolve
    // the analytic decision directly on the straight micro-segment.
    if (t_max <= min(n0 * GRIN_STEP, GRIN_DS_MAX)) {
        ms.deflected = false;
        ms.eta_scale = 1.0;
        if (s_star < t_max) {
            Spectrum tr  = spectrum_exp(-sigma_t * s_star);
            float    pdf = spectrum_average(sigma_t * tr);
            ms.scattered = true;
            ms.t         = s_star;
            ms.exit_p    = ambient_geodesic(ray.origin, ray.direction, s_star);
            ms.exit_dir  = ray.direction;
            ms.weight    = m0.sigma_s * tr / max(pdf, 1e-20);
        } else {
            Spectrum tr  = spectrum_exp(-sigma_t * t_max);
            float    pdf = spectrum_average(tr);
            ms.t         = t_max;
            ms.weight    = tr / max(pdf, 1e-20);
        }
        return ms;
    }

    ms.deflected = true;   // default outcome: carried to the wall (overwritten on scatter/capture)
    ms.t = 0.0;

    vec3 r = ray.origin;
    vec3 T = n0 * ray.direction;
    vec3 F = grin_force(med, r);
    float s_acc = 0.0;                                 // accumulated arc length
    float round_comp = 1.0;                            // 1/survival^rounds — the roulette's compensation

    for (int i = 0; i < GRIN_MAX_ROUNDS * GRIN_ROUND_STEPS; i++) {
        if (i > 0 && i % GRIN_ROUND_STEPS == 0) {      // the long-traversal roulette (header)
            if (random() >= GRIN_ROUND_SURVIVAL) return grin_killed(ms, t_max);
            round_comp /= GRIN_ROUND_SURVIVAL;
        }
        float n = length(T);
        if (n > GRIN_CAPTURE) return grin_killed(ms, t_max);   // horizon: nothing returns, event or not
        float h = min(GRIN_STEP, GRIN_DS_MAX / n);
        h = min(h, GRIN_DTOL * n / max(length(F), 1e-6));

        vec3 T_half = T + 0.5 * h * F;
        vec3 r_next = r + h * T_half;
        float n_half = length(T_half);
        float ds = n_half * h;                         // this step's coordinate arc length

        // Does the wall cross this drift? (Needed to order event-vs-wall along the step.)
        float ds_wall = ds + 1.0;                      // sentinel: no crossing in this step
        float hi = 1.0;
        if (!grin_inside(med, r_next)) {
            float lo = 0.0;
            for (int j = 0; j < GRIN_BISECT_ITERS; j++) {
                float mid = 0.5 * (lo + hi);
                if (grin_inside(med, r + (mid * h) * T_half)) lo = mid; else hi = mid;
            }
            ds_wall = hi * ds;
        }

        // The tentative event lands in this step AND before the wall → scatter.
        float ds_event = s_star - s_acc;
        if (ds_event <= ds && ds_event <= ds_wall) {
            Spectrum tr  = spectrum_exp(-sigma_t * s_star);
            float    pdf = spectrum_average(sigma_t * tr);
            float er = n_half / n0;
            ms.scattered = true;
            ms.deflected = false;
            ms.t         = s_star;
            ms.exit_dir  = normalize(T_half);
            ms.exit_p    = r + ds_event * ms.exit_dir;
            ms.weight    = round_comp * m0.sigma_s * tr / (max(pdf, 1e-20) * er * er);
            ms.eta_scale = er * er;
            return ms;
        }

        // The wall comes first → survive-to-boundary handoff (pull-back as in the
        // deterministic arm). Transmittance is charged to the HANDOFF point (the pulled-back
        // micro-segment is re-charged by the guard next iteration); the pdf is the true
        // probability of the branch taken — P(s* past the wall). The ε-order mismatch is
        // the same declared class as the straight micro-segment truncation.
        if (ds_wall <= ds) {
            float t_exit = ds_wall - GRIN_EXIT_PULLBACK;
            float er = n_half / n0;
            Spectrum tr  = spectrum_exp(-sigma_t * (s_acc + max(t_exit, 0.0)));
            float    pdf = spectrum_average(spectrum_exp(-sigma_t * (s_acc + ds_wall)));
            ms.exit_dir  = normalize(T_half);
            ms.exit_p    = r + t_exit * ms.exit_dir;
            ms.weight    = round_comp * tr / (max(pdf, 1e-20) * er * er);
            ms.eta_scale = er * er;
            return ms;
        }

        s_acc += ds;
        vec3 F_next = grin_force(med, r_next);
        T = T_half + 0.5 * h * F_next;
        r = r_next;
        F = F_next;
    }

    // The hard stop (probability ≈ 8e-10 per traversal — header).
    return grin_killed(ms, t_max);
}
