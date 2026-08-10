// Soft beam — a disk aperture emitting into a CONE (half-angle δ): the finite-
// divergence laser (fable-emitter-profiles.md v0; the delta `beam` kind's hittable
// sibling). This kind exists to make concentrated light REACHABLE through specular
// chains: unlike the delta beam (zero solid angle — BSDF sampling can never score it),
// a soft beam is an ordinary HITTABLE area emitter, so eye paths through arbitrary
// curved mirrors/glass terminate on the aperture-within-cone and score, the way area
// lights work through glass today. The declared variance law: chance-hit probability
// through a chain scales with the cone's solid angle — δ → 0 recovers the delta
// beam's unsampleable limit continuously (authored δ is physics: real lasers diverge).
//
// Structure = the disk light with TWO changes (concentric sampling, area→solid-angle
// pdf, §6.1 byte-match as adjacent functions — all inherited):
//   1. The axis IS the one-sided normal (rows: direction, no separate normal).
//   2. The CONE GATE multiplies RADIANCE ONLY — the pdf stays the pure geometric
//      measure (pitfall: gating the pdf would poison MIS; an out-of-cone sample is a
//      valid sample of zero radiance). The SAME step(cos_divergence, axis·ω) formula
//      gates the hit-side emission dispatch via the descriptor's emissionCone fact —
//      one profile truth, two readers (pt ≡ pt-nee).
// `radiance` is Le INSIDE the cone (B2: area kinds author Le); irradiance across the
// aperture is E = Le·π·sin²δ, power Φ = Le·π²·r²·sin²δ.
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): softbeam_light_sample(), softbeam_light_pdf().
// Depends on: concentric_disk + build_basis (core math).

LightSample softbeam_light_sample(SoftbeamLight l, Point p, vec2 xi) {
    vec3 t, b;
    build_basis(l.direction, t, b);
    vec2 u = l.radius * concentric_disk(xi);
    Point q = l.position + u.x * t + u.y * b;
    vec3 d = q - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = dot(l.direction, -ls.wi); // emitter-side cosine (axis = one-sided normal)
    if (cos_l <= 0.0) { ls.pdf = 0.0; ls.radiance = SPECTRUM_ZERO; return ls; }

    // Cone gate on radiance; measure conversion identical to the disk light.
    ls.radiance = l.radiance * step(l.cos_divergence, cos_l);
    ls.pdf = d2 / (PI * l.radius * l.radius * cos_l);
    return ls;
}

// MIS density mirror (§6.1) — geometric only, cone-blind BY DESIGN: it mirrors the
// SAMPLER's density (which samples the whole disk), not the radiance support.
float softbeam_light_pdf(SoftbeamLight l, Point p, Point light_p, Direction wi) {
    float cos_l = dot(l.direction, -wi);
    if (cos_l <= 0.0) return 0.0;
    vec3 d = light_p - p;
    return dot(d, d) / (PI * l.radius * l.radius * cos_l);
}
