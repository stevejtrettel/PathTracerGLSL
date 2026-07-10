# Reference Implementations (Normative)

**Status:** Normative companion to [fable-compiler-contracts.md](fable-compiler-contracts.md). This is the GLSL the migration should *transcribe*, not re-derive. Every function here conforms to the contracts; where a subtlety exists that commonly produces silent bias (the η² radiance factor, NEE double-count bookkeeping, TIR handling), it is implemented and annotated rather than left to interpretation.
**Date:** July 2026
**Conventions in force:** sample-returns-weight (§2.1), bare-f eval (§2.2), region-primary identity (§2.3), spectral discipline (§2.5) — note every radiometric constant below goes through `SPECTRUM_*` helpers or generated constants, never raw `vec3` literals.

Code is written against the contract signatures; `SPECTRUM_ONE`/`SPECTRUM_ZERO` denote the Generator-emitted constants for 1 and 0.

---

## 1. Lambert (migration item 1 — the shape-setter)

```glsl
// lambert.glsl — conforms to §3.2
// Fields read: mp.albedo, mp.emission

Spectrum lambert_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // bare f (§2.2): no cosine here. Reflection-side only.
    if (dot(wi, hit.frame.n) * dot(wo, hit.frame.n) <= 0.0) return SPECTRUM_ZERO;
    return mp.albedo * (1.0 / PI);
}

InteractionSample lambert_sample(Direction wo, Hit hit, MaterialProperties mp, vec2 xi) {
    // cosine-weighted hemisphere on the wo side of the surface
    Frame f = hit.frame;
    vec3 n = dot(wo, f.n) < 0.0 ? -f.n : f.n;         // shade the side we arrived from
    float cos_theta = sqrt(xi.y);
    float sin_theta = sqrt(max(0.0, 1.0 - xi.y));     // guard: xi.y clamped by RNG contract to [0,1)
    float phi = TWO_PI * xi.x;

    InteractionSample s;
    s.wi     = normalize(f.t * (sin_theta * cos(phi)) + f.b * (sin_theta * sin(phi)) + n * cos_theta);
    s.weight = mp.albedo;                             // (albedo/PI) * cos / (cos/PI) — exact cancellation (§2.1)
    s.pdf    = cos_theta * (1.0 / PI);
    s.flags  = LOBE_REFLECTION;
    return s;
}

float lambert_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    float c = dot(wi, hit.frame.n) * sign(dot(wo, hit.frame.n));
    return max(0.0, c) * (1.0 / PI);
}

Spectrum lambert_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return mp.emission;   // §6.2 registry logic decides whether/how it's counted
}
```

Notes: `weight = albedo` exactly — the contract's cancellation promise, and the furnace test's (§11.1) first target. Emission is a plain property read; all light bookkeeping lives in transport.

## 2. Dielectric (the contract's first real test)

Requires one new generated helper, pinned here: **`float ior_of(int region_id)`** — a constant table (like `material_of`) returning each region's IOR, with `ior_of(-1)` = the ambient medium's IOR or 1.0 for vacuum. Rationale: the far side's IOR must not require a full `scene_material_properties` fetch for the far material; IOR is (almost always) a per-material constant, and when `Value<T>`-driven it compiles to a uniform read. This helper is now part of the generated-tables family (`material_of`, `light_of`, `ior_of`).

```glsl
// dielectric.glsl — smooth dielectric, conforms to §3.2
// Fields read: mp.transmittance (tint applied at the interface; interior absorption is the medium's job §4.4)

float fresnel_dielectric(float cos_i, float eta) {   // eta = n_i / n_t
    float sin2_t = eta * eta * (1.0 - cos_i * cos_i);
    if (sin2_t >= 1.0) return 1.0;                    // total internal reflection
    float cos_t = sqrt(1.0 - sin2_t);
    float r_par  = (cos_i - eta * cos_t) / (cos_i + eta * cos_t);
    float r_perp = (eta * cos_i - cos_t) / (eta * cos_i + cos_t);
    return 0.5 * (r_par * r_par + r_perp * r_perp);
}

Spectrum dielectric_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; } // pure delta
float    dielectric_pdf (Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return 0.0; }
Spectrum dielectric_emission(Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; }

InteractionSample dielectric_sample(Direction wo, Hit hit, MaterialProperties mp, vec2 xi) {
    // Media on both sides come from the HIT, not from the material (§4.1):
    float n_i = ior_of(hit.region_from);
    float n_t = ior_of(hit.region_to);
    float eta = n_i / n_t;

    vec3  n     = hit.frame.n;                        // oriented toward region_from (§4.1)
    float cos_i = dot(wo, n);                         // > 0 by orientation; clamp for grazing safety
    cos_i = clamp(cos_i, 1e-6, 1.0);

    float F = fresnel_dielectric(cos_i, eta);

    InteractionSample s;
    if (xi.x < F) {
        // --- reflection branch (includes TIR, where F == 1) ---
        s.wi     = normalize(2.0 * cos_i * n - wo);   // reflect
        s.weight = SPECTRUM_ONE;                      // F / P(reflect=F) = 1 — exact (§2.1)
        s.pdf    = 0.0;
        s.flags  = LOBE_REFLECTION | LOBE_DELTA;
    } else {
        // --- transmission branch ---
        float sin2_t = eta * eta * (1.0 - cos_i * cos_i);
        float cos_t  = sqrt(max(0.0, 1.0 - sin2_t));  // sin2_t < 1 guaranteed (else F was 1)
        s.wi     = normalize(-eta * wo + (eta * cos_i - cos_t) * n);

        // THE η² FACTOR — do not omit. Radiance is compressed by (n_t/n_i)² crossing into a
        // denser medium; camera paths carry radiance, so the throughput factor is (n_i/n_t)²
        // ... inverted relative to intuition because we transport radiance *backwards*.
        // Omitting this cancels on enter+exit round trips through the SAME pair of media —
        // which is why hobby tracers "look fine" until an interior path terminates (emissive
        // object inside glass, camera underwater) and the brightness is silently wrong.
        // (PBRT: "Account for non-symmetry with transmission to different medium.")
        float radiance_scale = (n_i * n_i) / (n_t * n_t);
        s.weight = mp.transmittance * radiance_scale; // (1-F)/P(transmit=1-F) = 1, times scale & tint
        s.pdf    = 0.0;
        s.flags  = LOBE_TRANSMISSION | LOBE_DELTA;
    }
    return s;
}
```

Notes: TIR is not a special case — it is the reflection branch with F = 1 (transmission branch unreachable). The tint `mp.transmittance` is an *interface* color; distance-dependent coloring belongs to the interior medium's `sigma_a` (§4.4) — offering both is standard and they compose. Transport reacts to `LOBE_TRANSMISSION` by setting `current_medium = hit.region_to` (§4.4).

## 3. Henyey–Greenstein phase (the medium-side interaction)

```glsl
// phase_hg.glsl — conforms to §3.5. Fields read: mp.phase_g
Spectrum hg_eval(Direction wi, Direction wo, MediumProperties mp) {
    float g = mp.phase_g, c = dot(wi, -wo);           // cos of angle from the FORWARD (propagation) direction
    // CONVENTION TRAP: with c measured from forward (-wo), the denominator is 1 + g² − 2gc
    // (forward peak at c=1 for g>0). PBRT's 1 + g² + 2gc form goes with cosθ = dot(wo, wi) —
    // mixing the two swaps forward/backward scattering AND desyncs eval from hg_sample below,
    // which samples in the forward convention. (Second-pass audit caught exactly this.)
    float d = 1.0 + g * g - 2.0 * g * c;
    return Spectrum(((1.0 - g * g) / (4.0 * PI * d * sqrt(max(d, 1e-8)))));
}

InteractionSample hg_sample(Direction wo, MediumProperties mp, vec2 xi) {
    float g = mp.phase_g;
    float cos_theta = (abs(g) < 1e-3)
        ? 1.0 - 2.0 * xi.x
        : (1.0 + g * g - pow2((1.0 - g * g) / (1.0 - g + 2.0 * g * xi.x))) / (2.0 * g);
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = TWO_PI * xi.y;
    vec3 t, b; build_basis(-wo, t, b);                // frame around the propagation direction

    InteractionSample s;
    s.wi     = normalize(t * (sin_theta * cos(phi)) + b * (sin_theta * sin(phi)) + (-wo) * cos_theta);
    s.weight = SPECTRUM_ONE;                          // phase/pdf = 1: HG sampling is exact
    s.pdf    = spectrum_average(hg_eval(s.wi, wo, mp)); // scalar; HG is grayscale
    s.flags  = LOBE_MEDIUM;
    return s;
}
float hg_pdf(Direction wi, Direction wo, MediumProperties mp) { return spectrum_average(hg_eval(wi, wo, mp)); }
```

## 4. Shadow transmittance (v1: homogeneous, segment-walking)

```glsl
// Conforms to §6.3. Compiler emits the boolean fast path instead when the scene has no media.
Spectrum shadow_transmittance(Point p, Direction wi, float dist) {
    Spectrum T = SPECTRUM_ONE;
    int medium = /* caller's current_medium */;
    float t = EPS_SHADOW; // offset off the surface/medium point
    for (int seg = 0; seg < MAX_SHADOW_SEGMENTS; seg++) {
        Hit h;
        bool hit_something = scene_intersect_from(p, wi, t, dist, h);   // next boundary in (t, dist)
        float seg_len = (hit_something ? h.t : dist) - t;
        if (medium >= 0 || material_of(medium) >= 0) {                  // segment inside a medium
            MediumProperties m = scene_medium_properties(material_of(medium), /*p mid*/ ambient_point);
            T *= spectrum_exp(-(m.sigma_a + m.sigma_s) * seg_len);      // closed-form (V1-C1)
        }
        if (!hit_something) return T;                                   // reached the light
        if (!is_null_interface(h)) return SPECTRUM_ZERO;                // opaque or dielectric: blocked (§6.3 v1 policy)
        medium = h.region_to;                                            // null interface: pass through
        t = h.t + EPS_SHADOW;
    }
    return SPECTRUM_ZERO;  // segment budget exhausted: conservative
}
```

Note the asymmetry with the main loop: *only null interfaces* pass shadow rays in v1 (§6.3 pins dielectrics as shadow-opaque); scattering along the segment attenuates via full σ_t (absorption + out-scatter) — the standard single-scattering shadow approximation.

## 5. The v1 transport loop (pt-nee, homogeneous media, null interfaces)

This is the loop the transport generator emits for `{integrator:'pt', directLighting:'nee', volumeIntegrator:'raymarch'}` with all v1 constraints active. Blocks the Planner disables (no media in scene, no NEE) simply vanish.

```glsl
Radiance transport_trace(Ray primary) {
    Spectrum throughput = SPECTRUM_ONE;
    Radiance radiance   = SPECTRUM_ZERO;

    Ray   ray = primary;                              // pure geodesic seed (§5); advanced via ambient_geodesic
    int   current_medium = -1;                        // §4.4 — ambient
    // §6.2 bookkeeping (spans loop iterations):
    bool  prev_was_delta = true;                      // camera "bounce" counts as delta: emission at bounce 0 is full-weight
    float prev_bsdf_pdf  = 0.0;
    Point prev_p         = ray.origin;
    int   null_crossings = 0;

    for (int bounce = 0; bounce < MAX_BOUNCES; /* increment at real events only (§7.2 pins) */) {

        // ---- 1. Advance through current_medium: medium event vs boundary event ----
        Hit hit;
        bool boundary = scene_intersect(ray, hit);    // ambient_geodesic march (§5)
        float t_hit = boundary ? hit.t : RAY_TMAX;

        int med_mat = material_of(current_medium);
        if (med_mat >= 0 && medium_is_scattering(med_mat)) {          // compile-time specialized per scene
            MediumProperties m = scene_medium_properties(med_mat, ray.origin);
            Spectrum sigma_t = m.sigma_s + m.sigma_a;                 // spectral extinction
            float sigma_bar  = spectrum_average(sigma_t);             // scalar SAMPLING density
            float t_med = -log(max(1e-9, 1.0 - random())) / sigma_bar; // closed-form (V1-C1)

            if (t_med < t_hit) {
                // ---- 2. MEDIUM EVENT ----
                Point p_evt = ambient_geodesic(ray.origin, ray.direction, t_med);
                // CHROMATIC-EXTINCTION weight (audit fix): sampling used scalar σ̄, physics uses σ_t(λ).
                // Exact weight = σ_s(λ)·e^{−σ_t(λ)t} / (σ̄·e^{−σ̄t}). Reduces to σ_s/σ_t for grayscale
                // extinction; writing only σ_s/σ̄ silently biases every COLORED scattering medium.
                throughput *= m.sigma_s * spectrum_exp(-(sigma_t - Spectrum(sigma_bar)) * t_med)
                              / Spectrum(sigma_bar);

                // NEE from the medium point (phase eval, §6.3 transmittance)
                LightSample ls = lighting_sample(p_evt, random2());
                if (ls.pdf > 0.0) {
                    Spectrum T = shadow_transmittance(p_evt, ls.wi, ls.distance);
                    // §2.2: NO cosine at medium events — phase functions have none
                    radiance += throughput * ls.radiance * hg_eval(ls.wi, -ray.direction, m) * T / ls.pdf;
                }

                InteractionSample ms = hg_sample(-ray.direction, m, random2());
                throughput *= ms.weight;
                prev_was_delta = false;  prev_bsdf_pdf = ms.pdf;  prev_p = p_evt;
                ray = make_ray(p_evt, ms.wi);          // continue from the medium event (no surface offset)
                bounce++;                                             // medium events count (§7.2)
                if (russian_roulette(throughput, bounce)) break;      // §7.2 pin
                continue;
            }
            // Survived to boundary. For grayscale extinction: probability = transmittance exactly, weight 1.
            // For chromatic extinction the same ratio correction applies (audit fix):
            throughput *= spectrum_exp(-(sigma_t - Spectrum(sigma_bar)) * t_hit);
        } else if (med_mat >= 0) {
            // absorbing-only medium (tinted glass interior): deterministic Beer–Lambert
            MediumProperties m = scene_medium_properties(med_mat, ray.origin);
            throughput *= spectrum_exp(-m.sigma_a * t_hit);
        }

        // ---- 3. MISS → environment ----
        if (!boundary) {
            float w = (prev_was_delta || !ENV_SAMPLABLE) ? 1.0
                    : /* MIS later; NEE-only: */ 0.0;                 // env samplable + non-delta prev → NEE counted it
            radiance += throughput * Spectrum(w) * environment_radiance(ray.direction);
            break;
        }

        // ---- self-heal medium tracking (§4.4, free) ----
        if (hit.region_from != current_medium) current_medium = hit.region_from;

        // ---- 4. NULL INTERFACE (§3.6) ----
        if (surface_is_null(hit)) {                                   // generated: owner material has surface:none
            current_medium = hit.region_to;
            ray = make_ray(ambient_geodesic(hit.p, hit.frame.n, EPSILON), ray.direction);  // same dir, offset past boundary
            if (++null_crossings > MAX_NULL_CROSSINGS) break;
            continue;                                                 // no bounce consumed
        }

        // ---- 5. SURFACE EVENT ----
        int owner = hit_owner_region(hit);                            // §4.1: boundary owner shades
        int mat   = material_of(owner);
        MaterialProperties mp = scene_material_properties(mat, hit.p);
        Direction wo = -ray.direction;

        // Emission with §6.2 bookkeeping. AUDIT FIX: emission keys on region_to (the §6.2 side
        // convention), NOT on the boundary owner — the owner shades the BSDF (§4.1), region_to
        // supplies emission. They coincide for opaque emitters hit from outside (the common case,
        // which the Generator can specialize to a single fetch) but differ at exit interfaces:
        // leaving an emissive region must contribute nothing (one-sided rule).
        int emat = (hit.region_to >= 0) ? material_of(hit.region_to) : -1;
        if (emat >= 0 && material_is_emissive(emat)) {                // compile-time flag: fetch only if it can emit
            MaterialProperties emp = (emat == mat) ? mp : scene_material_properties(emat, hit.p);
            Spectrum Le = interaction_surface_emission(emat, wo, hit, emp);
            int lid = light_of(hit.region_to);
            float w = (lid < 0 || prev_was_delta) ? 1.0 : 0.0;        // NEE-only; MIS swaps the 0.0 (§8 diff)
            radiance += throughput * Spectrum(w) * Le;
        }

        // NEE (skipped entirely for pure-delta materials — eval is 0):
        if (material_has_nondelta_lobes(mat)) {                       // compile-time per material
            LightSample ls = lighting_sample(hit.p, random2());
            if (ls.pdf > 0.0) {
                Spectrum T = shadow_transmittance(hit.p + hit.frame.n * EPS_OFFSET, ls.wi, ls.distance);
                Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, mp);   // bare f (§2.2)
                float cos_i = abs(dot(ls.wi, hit.frame.n));                        // transport applies cosine (§2.2)
                radiance += throughput * ls.radiance * f * cos_i * T / ls.pdf;
            }
        }

        // BSDF sample:
        InteractionSample bs = interaction_surface_sample(mat, wo, hit, mp, random2());
        if (spectrum_is_black(bs.weight)) break;
        throughput *= bs.weight;                                      // cosine already inside (§2.1)

        if ((bs.flags & LOBE_TRANSMISSION) != 0u) current_medium = hit.region_to;   // §4.4
        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;
        prev_bsdf_pdf  = bs.pdf;  prev_p = hit.p;

        ray = make_ray(ambient_geodesic(hit.p, hit.frame.n, EPSILON), bs.wi);   // continuation (§5, offset origin)
        bounce++;                                                     // surface events count (§7.2)
        if (russian_roulette(throughput, bounce)) break;
    }
    return radiance;
}

bool russian_roulette(inout Spectrum throughput, int bounce) {        // §7.2 pin — ONE definition
    if (bounce < RR_START_DEPTH) return false;
    float p = min(0.95, spectrum_average(throughput));
    if (random() > p) return true;
    throughput /= p;
    return false;
}
```

**Annotations (each an easy-to-miss correctness point):**

1. `prev_was_delta` initializes **true** — emission seen directly by the camera is always full-weight (§6.2's `bounce == 0` case, folded into the flag).
2. The medium-survival branch applies **no weight** — with closed-form distance sampling, P(reach boundary) equals the transmittance exactly; multiplying transmittance again is a classic double-attenuation bug.
3. The environment miss applies the same NEE bookkeeping as surface emitters — if the environment is samplable and the previous vertex did NEE, adding full env radiance double-counts.
4. Cosine appears **exactly once** per NEE estimate, applied by transport, surface events only (§2.2) — and never in the sampled-direction path (it's inside `weight`, §2.1).
5. The self-heal line costs one integer compare — `hit.region_from` was already computed.
6. `russian_roulette` exists once; integrators share it. Two integrators with subtly different RR are un-diffable (§11.2 would flag them).

---

## 6. Light samplers — measure conventions made concrete

Measure bugs (area vs solid-angle pdfs, falloff folded twice or not at all) are the most common cause of NEE/MIS bias. These implementations *are* the §6.1 conventions.

### 6.1 Quad light (area → solid angle conversion)

```glsl
// Registry data (compile-time or Value<T>-driven): corner C, edges e1, e2,
// unit normal n_l, area A, emitted radiance Le. One-sided emitter by default.
LightSample quad_light_sample(int lid, Point p, vec2 xi) {
    Point q = C + xi.x * e1 + xi.y * e2;
    vec3  d = q - p;
    float d2 = dot(d, d);
    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.light_id = lid;
    ls.flags    = 0u;
    float cos_l = dot(n_l, -ls.wi);            // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample
    // THE measure conversion: pdf_area = 1/A, converted to solid angle at p.
    ls.pdf      = d2 / (A * cos_l);            // × selection pdf, applied by the dispatcher
    ls.radiance = Le;                          // NO distance falloff — falloff IS the solid-angle measure.
    return ls;                                 // Folding 1/d² here too is the classic double-falloff bug.
}
```

### 6.2 Sphere light (visible-cone sampling)

```glsl
// Registry data: center Cs, radius r, radiance Le.
LightSample sphere_light_sample(int lid, Point p, vec2 xi) {
    vec3 to_c = Cs - p;  float dc2 = dot(to_c, to_c);
    LightSample ls;  ls.light_id = lid;  ls.flags = 0u;
    if (dc2 <= r * r) { ls.pdf = 0.0; return ls; }         // p inside the light: degenerate, punt (OPEN)
    // Sample the cone of directions subtending the sphere — pdf is *directly* solid-angle:
    float sin2_max = r * r / dc2;
    float cos_max  = sqrt(max(0.0, 1.0 - sin2_max));
    float cos_t    = 1.0 - xi.x * (1.0 - cos_max);         // uniform in the cone
    float sin_t    = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    float phi      = TWO_PI * xi.y;
    vec3 t, b;  vec3 w = to_c * inversesqrt(dc2);  build_basis(w, t, b);
    ls.wi  = normalize(t * (sin_t * cos(phi)) + b * (sin_t * sin(phi)) + w * cos_t);
    ls.pdf = 1.0 / (TWO_PI * (1.0 - cos_max));             // uniform-cone solid-angle pdf
    ls.distance = /* ray-sphere hit along ls.wi */ sphere_hit_distance(p, ls.wi, Cs, r);
    ls.radiance = Le;
    return ls;
}
```

### 6.3 Point light (delta conventions) and the selection dispatcher

```glsl
LightSample point_light_sample(int lid, Point p) {
    vec3 d = P_light - p;  float d2 = dot(d, d);
    LightSample ls;
    ls.wi = d * inversesqrt(d2);  ls.distance = sqrt(d2);
    ls.radiance = I_light / Spectrum(d2);      // delta light: falloff FOLDED into radiance (§6.1)
    ls.pdf      = 1.0;                          // per-light pdf is 1 by convention; selection applied below
    ls.flags    = LIGHT_DELTA;
    ls.light_id = lid;
    return ls;
}

// Generated dispatcher — compile-time power-weighted CDF over samplable lights:
LightSample lighting_sample(Point p, vec2 xi) {
    // const float LIGHT_CDF[N] = ...;  (generated; power = spectrum_average(Le)·A·π etc.)
    int i = cdf_select(LIGHT_CDF, xi.x);        // linear scan for small N, binary search above ~8
    float xr = cdf_rescale(LIGHT_CDF, i, xi.x); // reuse the selection dimension (stratification-preserving)
    LightSample ls = /* generated per-kind switch */ sample_light_i(i, p, vec2(xr, xi.y));
    ls.pdf *= LIGHT_SELECT_PDF[i];              // total pdf = selection × per-light (§6.1)
    return ls;
}

// MIS pdf query (§6.1 signature — light identity known, no search):
float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit) {
    // per-kind: quad → d²/(A·cos_l) recomputed from light_hit; sphere → cone pdf from p;
    // delta lights are never queried (not hittable). Times LIGHT_SELECT_PDF[light_id].
    return LIGHT_SELECT_PDF[light_id] * per_light_solid_angle_pdf(light_id, p, wi, light_hit);
}
```

---

## 7. GGX conductor — the first glossy BSDF (VNDF sampling)

```glsl
// ggx.glsl — rough conductor, Smith separable masking, Schlick Fresnel.
// Fields read: mp.f0 (normal-incidence reflectance), mp.roughness (alpha = roughness²).
// Convention: alpha clamped ≥ 1e-3 — author true mirrors as a delta model instead (§3.1);
// letting alpha→0 here produces fireflies, not a mirror.

float ggx_D(vec3 h_local, float a) {           // local frame: n = +z
    float t = h_local.z * h_local.z * (a * a - 1.0) + 1.0;
    return a * a / (PI * t * t);
}
float ggx_G1(vec3 v_local, float a) {          // Smith, separable
    float c = abs(v_local.z);
    return 2.0 * c / (c + sqrt(a * a + (1.0 - a * a) * c * c));
}

Spectrum ggx_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = to_local(hit.frame, wi), wol = to_local(hit.frame, wo);
    if (wil.z * wol.z <= 0.0) return SPECTRUM_ZERO;         // reflection-only model
    float a = max(1e-3, mp.roughness * mp.roughness);
    vec3 h = normalize(wil + wol);
    Spectrum F = mp.f0 + (SPECTRUM_ONE - mp.f0) * pow(1.0 - abs(dot(wol, h)), 5.0);
    // bare f (§2.2): D·F·G / (4 cos_i cos_o), NO extra cos_i here
    return F * (ggx_D(h, a) * ggx_G1(wil, a) * ggx_G1(wol, a) / (4.0 * abs(wil.z) * abs(wol.z)));
}

InteractionSample ggx_sample(Direction wo, Hit hit, MaterialProperties mp, vec2 xi) {
    vec3 wol = to_local(hit.frame, wo);  if (wol.z < 0.0) wol = -wol;   // canonical side
    float a = max(1e-3, mp.roughness * mp.roughness);
    // VNDF sampling (Heitz 2018) — sample the visible microfacet distribution:
    vec3 vh = normalize(vec3(a * wol.x, a * wol.y, wol.z));
    float lensq = vh.x * vh.x + vh.y * vh.y;
    vec3 T1 = lensq > 0.0 ? vec3(-vh.y, vh.x, 0.0) * inversesqrt(lensq) : vec3(1, 0, 0);
    vec3 T2 = cross(vh, T1);
    float rr = sqrt(xi.x), phi = TWO_PI * xi.y;
    float t1 = rr * cos(phi), t2 = rr * sin(phi);
    float s_ = 0.5 * (1.0 + vh.z);
    t2 = (1.0 - s_) * sqrt(max(0.0, 1.0 - t1 * t1)) + s_ * t2;
    vec3 nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * vh;
    vec3 h  = normalize(vec3(a * nh.x, a * nh.y, max(1e-6, nh.z)));

    vec3 wil = reflect(-wol, h);
    InteractionSample s;
    if (wil.z <= 0.0) { s.weight = SPECTRUM_ZERO; s.pdf = 0.0; s.flags = LOBE_REFLECTION; return s; }
    Spectrum F = mp.f0 + (SPECTRUM_ONE - mp.f0) * pow(1.0 - abs(dot(wol, h)), 5.0);
    // The VNDF elegance: weight = F · G1(wi) exactly (separable Smith) — D, cosines, jacobian all cancel.
    s.weight = F * ggx_G1(wil, a);
    // pdf for MIS: VNDF pdf = G1(wo)·D·|wo·h| / cos_o, reflected through the half-vector jacobian 1/(4|wo·h|):
    s.pdf    = ggx_G1(wol, a) * ggx_D(h, a) / (4.0 * abs(wol.z));
    s.flags  = LOBE_REFLECTION;
    s.wi     = from_local(hit.frame, wil * sign(dot(wo, hit.frame.n)));  // back to arrival side
    return s;
}

float ggx_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = to_local(hit.frame, wi), wol = to_local(hit.frame, wo);
    if (wil.z * wol.z <= 0.0) return 0.0;
    float a = max(1e-3, mp.roughness * mp.roughness);
    vec3 h = normalize(wil + wol);
    return ggx_G1(wol, a) * ggx_D(h, a) / (4.0 * abs(wol.z));   // MUST match ggx_sample's pdf — §11.3 checks this
}
```

The `sample.pdf` / `ggx_pdf` agreement is the exact triple-consistency the §11.3 histogram harness exists to verify — GGX is its first real customer.

---

## 8. The MIS diff — exactly three lines change from NEE-only

The §5 loop becomes `pt-mis` by changing *only* these (anything else differing between the two generated loops is a bug §11.2 will catch):

```glsl
// (1) emitter hit (§6.2 bookkeeping): the 0.0 branch becomes a weight
float w = (lid < 0 || prev_was_delta) ? 1.0
        : power_heuristic(prev_bsdf_pdf, lighting_pdf(prev_p, ray_dir, lid, hit));

// (2) surface-NEE estimate gains the balance against the BSDF's pdf:
float w_l = (ls.flags & LIGHT_DELTA) != 0u ? 1.0                       // delta lights: BSDF can't hit them
          : power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, mp));
radiance += throughput * ls.radiance * f * cos_i * T * w_l / ls.pdf;

// (3) environment miss: same shape as (1) with environment_pdf:
float w = (prev_was_delta || !ENV_SAMPLABLE) ? 1.0
        : power_heuristic(prev_bsdf_pdf, ENV_SELECT_PDF * environment_pdf(ray_dir));

float power_heuristic(float pf, float pg) { float f2 = pf * pf; return f2 / (f2 + pg * pg); }
```

Medium-event NEE gains the same (2)-shaped weight with `hg_pdf` in place of the surface pdf.

---

## 9. Generated code shapes: the innermost-wins classifier and the tables

What the Generator emits for a scene with two solids (pool `0`, submerged glass sphere `1`) and one multi-region object (regions `2..4`):

```glsl
// scene_region_at — innermost-wins (§2.7): among containing (d < 0), LEAST negative wins.
int scene_region_at(vec3 p) {
    int best = -1;  float best_d = -1e20;
    float d;
    d = sdf_object_0(p);  if (d < 0.0 && d > best_d) { best = 0; best_d = d; }   // note: d > best_d
    d = sdf_object_1(p);  if (d < 0.0 && d > best_d) { best = 1; best_d = d; }   // (least negative)
    d = mro_2_distance(p);
    if (d < 0.0 && d > best_d) { best = mro_2_region_at(p); best_d = d; }        // predicate order inside (§4.6)
    return best;
}

// The generated-tables family (§2.3) — constant switches, O(1):
int   material_of(int r) { /* r0→water, r1→glass, r2→glass, r3→water, r4→air */ }
int   light_of   (int r) { /* -1 everywhere unless samplable emitter (§6.2) */ }
float ior_of     (int r) { /* r<0 → ambient's ior or 1.0 */ }
```

The comparison direction (`d > best_d` among negatives) is the entire innermost-wins fix from verification T2 — one flipped inequality away from the submerged-sphere bug. Worth a comment in the real Generator.

---

## 10. Ambient geodesics — Euclidean, and H³ as the swappability proof

Ray advancement is `ambient_geodesic(origin, dir, t) → Point` per ambient space (§5) — **no stepper,
no `GeodesicState`.** The Ray is a pure seed; the ambient module owns how the geodesic is evaluated.

```glsl
// euclidean.glsl — the compiler inlines these to nothing (§5.2)
Point     ambient_geodesic (Point o, Direction d, float t)     { return o + d * t; }
float     ambient_dot      (Direction a, Direction b, Point p) { return dot(a, b); }
Direction ambient_transport(Direction u, Point from, Point to) { return u; }
```

```glsl
// hyperbolic.glsl — H³, hyperboloid model. Point/Direction are vec4 here (§5.3):
// points on ⟨p,p⟩ = -1 (Minkowski signature +++-), directions with ⟨d,d⟩ = 1, ⟨p,d⟩ = 0.
float mdot(vec4 a, vec4 b) { return a.x*b.x + a.y*b.y + a.z*b.z - a.w*b.w; }

Point ambient_geodesic(Point o, Direction d, float t) {        // exact closed form — constant curvature
    vec4 p = o * cosh(t) + d * sinh(t);
    return p / sqrt(max(1e-9, -mdot(p, p)));                    // renormalize onto the hyperboloid vs float drift
}
float ambient_dot(Direction a, Direction b, Point p) { return mdot(a, b); }
// ambient_transport (parallel transport) is nontrivial in H³ — closed form in terms of the
// connecting geodesic; derived with the H³ backend when that work starts (shape-normative here).
```

The point of including H³ is the *existence proof*: `Point` widens to `vec4`, `ambient_geodesic` is a
different closed form, the metric is `mdot` — and the march loop, the transport loop, and every
contract above are untouched. Schwarzschild replaces `ambient_geodesic`'s **body** with an RK4
integration of the geodesic ODE (internal to the ambient module — no new type, no loop rewrite). The
H³ forms are shape-normative, not numerics-normative — derive exact transport with the H³ SDF library
when that work starts; the SDF primitives must also be hyperbolic-distance functions, the real work
of an H³ backend. **Open (§5.3):** the ray's *direction at a far hit* (the transported velocity the
retired stepper used to carry) — needed for `wo` in curved space; a companion to `ambient_geodesic`
or an `ambient_transport` of the seed direction, resolved when the first curved backend is built.

---

## 11. What writing this verified (and one more generated table)

Producing real code stressed the contracts one final time. Result: **no contract changes needed**, one addition: the generated-tables family gains **`ior_of(region_id)`** (§2 of this doc) so dielectrics read the far side's IOR without a full material-properties fetch. Everything else — the Hit fields, the sample struct, the flags, `light_of`, `current_medium`, the `ambient_geodesic` indirection — was sufficient to write Lambert, dielectric, GGX, HG, three light samplers, shadow transmittance, the full NEE loop, the MIS diff, and two `ambient_geodesic` forms (Euclidean + vec4-point H³) without inventing anything off-contract. That is the property the contracts were designed for; it now has an existence proof across every contract.

**Second-pass audit (do not skip this step when extending this document).** After the code above was written, a hostile re-read against PBRT conventions found and fixed three real errors: an HG sign-convention bug (eval used the `+2gc` form with a forward-measured angle — forward/backward swapped *and* eval desynced from sample), missing chromatic-extinction ratio weights in the transport loop (silent bias for every colored scattering medium), and emission keyed on the boundary owner instead of `region_to` (contradicting §6.2 at exit interfaces). All three were the *plausible-looking* kind that renders images without complaint. The lesson is procedural: reference code gets its own adversarial pass, and the §11 harnesses (furnace, cross-strategy, pdf-histogram) remain the ground truth — paper audits reduce the bug count; they do not zero it. Known remaining paper-only items: the H³ transport expression (shape-normative, §10), the sphere-light p-inside-light case (OPEN), and every helper marked as pseudo (`scene_intersect_from`).

**Implementation checklist derived from this document** (each item is a transcription target + its test):

| Reference | Migration item (§10.1) | Verified by |
|---|---|---|
| §1 Lambert | item 1 | furnace test (§11.1) |
| §9 tables + classifier | item 2 | T2 scene renders correctly |
| §6 light samplers | item 3 | cross-strategy convergence (§11.2) |
| §4 shadow transmittance | item 5 | foggy-Cornell scene |
| §10 Euclidean `ambient_geodesic` | item 7 (no stepper — see trace-loop-contract) | image-identical to current output |
| §5 transport loop | item 9 | §11.2 across pt / pt-nee |
| §2 dielectric, §7 GGX, §3 HG | post-migration features | §11.1 + §11.3 per model |
| §8 MIS diff | with area lights | §11.2 three-way |
