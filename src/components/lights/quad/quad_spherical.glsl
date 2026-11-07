// Quad area light in S³ — the geodesic rectangle of the curved quad shape
// (components/geometry/quad/quad_spherical.glsl), in world coordinates: `corner` holds its CENTER
// c (in a curved space a light's point row holds the image of its anchor, here the authored
// quad's center corner + (edge1 + edge2)/2), and edge1, edge2 hold E₁, E₂, the authored edges as
// tangent vectors at c (orthogonal, lengths 2a and 2b, each below π) — all the backing region's
// placement applied, so the sampled rectangle is the one rays hit.
// Sampling: uniform in the plane's gnomonic chart about c, k = (tan a·(2ξ₁ − 1), tan b·(2ξ₂ − 1)),
// y = (c + k₁·Ê₁ + k₂·Ê₂)/√(1 + |k|²) (an isometry is linear on R⁴). The chart's area element is
// w³·dk₁dk₂ with w = 1/√(1 + |k|²) = y·c, so the density with respect to area is exactly
// 1/(4·tan a·tan b·w³). Two geodesics join p to y (the short arc of length d leaving along u, the
// long arc of length 2π − d leaving along −u, arriving with opposite velocities, both with area
// density sin² d): the arc is chosen first (spherical_light_arc, from the query), then
// dω = cos_l·dA / sin²d with cos_l against the chosen arc's reversed arrival direction, and the pdf
// carries the arc's probability (the disk light's rule). The §6.1 byte-match invariant:
// quad_light_pdf mirrors the sampler's density with the same expressions. ONE-SIDED: emits toward
// N = Ê₁ × Ê₂ carried to c (quad_light_normal); back-face samples and queries return pdf 0.
// Derivations: docs/claude-2026-11-review/curved/next-shapes-plan.md §4.
// Provides (struct GENERATED from descriptor rows): quad_light_sample(), quad_light_pdf().
// Depends on: spherical_cos_sin(), spherical_light_arc(), spherical_light_arc_probability(),
//             ambient_distance(), ambient_direction_to(), ambient_dot() (the S³ occupant).

// The emitting side: the unit tangent vector at c orthogonal to E₁ and E₂ with the orientation of
// ê1×ê2. X with X·d = det[E₁; E₂; d; c] (rows) is orthogonal to E₁, E₂ and c, equals
// 4ab·(ê1×ê2, 0) at o, and rotations of R⁴ carry it along.
Direction quad_light_normal(QuadLight l) {
    vec4 E1 = l.edge1, E2 = l.edge2, c = l.corner;
    vec4 X = vec4(dot(E1.yzw, cross(E2.yzw, c.yzw)), -dot(E1.xzw, cross(E2.xzw, c.xzw)),
                  dot(E1.xyw, cross(E2.xyw, c.xyw)), -dot(E1.xyz, cross(E2.xyz, c.xyz)));
    return normalize(X);
}

// The gnomonic half-widths tan a, tan b and the edge lengths 2a, 2b.
vec4 quad_light_chart(QuadLight l) {
    float l1 = length(l.edge1), l2 = length(l.edge2);
    vec2 cs1 = spherical_cos_sin(0.5 * l1), cs2 = spherical_cos_sin(0.5 * l2);
    return vec4(cs1.y / cs1.x, cs2.y / cs2.x, l1, l2);
}

LightSample quad_light_sample(QuadLight l, LightQuery q, vec2 xi) {
    vec4 ch = quad_light_chart(l);
    float k1 = ch.x * (2.0 * xi.x - 1.0), k2 = ch.y * (2.0 * xi.y - 1.0);
    Point y = normalize(l.corner + (k1 / ch.z) * l.edge1 + (k2 / ch.w) * l.edge2);
    float d = ambient_distance(q.p, y);
    Direction u = ambient_direction_to(q.p, y);
    float arc_pdf;
    bool long_arc = spherical_light_arc(q, u, arc_pdf);

    LightSample ls;
    ls.wi       = long_arc ? -u : u;
    ls.distance = long_arc ? TWO_PI - d : d;
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    Direction back = ambient_direction_to(y, q.p);   // the short arc's reversed arrival direction
    float cos_l = ambient_dot(quad_light_normal(l), long_arc ? -back : back, y);   // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    float w = dot(y, l.corner);
    float s = spherical_cos_sin(d).y;
    ls.pdf = arc_pdf * s * s / (4.0 * ch.x * ch.y * w * w * w * cos_l);
    return ls;
}

// The MIS density with which quad_light_sample(l, q, ·) would have produced the geodesic from q.p
// that arrived at the hit point light_p, where wo is the arrival direction reversed — MUST mirror
// the sampler above (§6.1). Both arcs have the area density sin² d and the same arc probability, so
// only the emitter cosine depends on which arc the ray travelled, and wo gives it. Back side: 0.
float quad_light_pdf(QuadLight l, LightQuery q, Point light_p, Direction wo) {
    float cos_l = ambient_dot(quad_light_normal(l), wo, light_p);
    if (cos_l <= 0.0) return 0.0;
    vec4 ch = quad_light_chart(l);
    float w = dot(light_p, l.corner);
    float s = spherical_cos_sin(ambient_distance(q.p, light_p)).y;
    return spherical_light_arc_probability(q) * s * s / (4.0 * ch.x * ch.y * w * w * w * cos_l);
}
