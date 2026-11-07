// Quad area light in H³ — the geodesic rectangle of the curved quad shape
// (components/geometry/quad/quad_hyperbolic.glsl), in world coordinates: `corner` holds its CENTER
// c (in a curved space a light's point row holds the image of its anchor, here the authored
// quad's center corner + (edge1 + edge2)/2), and edge1, edge2 hold E₁, E₂, the authored edges as
// tangent vectors at c (orthogonal, lengths 2a and 2b) — all the backing region's placement
// applied, so the sampled rectangle is the one rays hit.
// Sampling: uniform in the plane's Klein chart about c, k = (tanh a·(2ξ₁ − 1), tanh b·(2ξ₂ − 1)),
// y = (c + k₁·Ê₁ + k₂·Ê₂)/√(1 − |k|²) (an isometry is linear on R⁴, so the chart point maps by the
// same coefficients). The chart's area element is w³·dk₁dk₂ with w = 1/√(1 − |k|²) = −⟨y, c⟩, so the
// density with respect to area is exactly 1/(4·tanh a·tanh b·w³) — not uniform in area, but exact.
// Area → solid angle at p: dω = cos_l·dA / sinh²d, with cos_l against the reversed arrival
// direction at y. The §6.1 byte-match invariant: quad_light_pdf mirrors the sampler's density with
// the same expressions. ONE-SIDED: emits toward N = Ê₁ × Ê₂ carried to c (quad_light_normal);
// back-face samples and queries return pdf 0. Derivations:
// docs/claude-2026-11-review/curved/next-shapes-plan.md §4.
// Provides (struct GENERATED from descriptor rows): quad_light_sample(), quad_light_pdf().
// Depends on: hyperbolic_form(), hyperbolic_on_model(), ambient_distance(),
//             ambient_direction_to(), ambient_dot() (the H³ occupant).

// The emitting side: the unit tangent vector at c orthogonal to E₁ and E₂ with the orientation of
// ê1×ê2. X with X·d = det[E₁; E₂; d; c] (rows) is Euclidean-orthogonal to E₁, E₂ and c, and equals
// 4ab·(ê1×ê2, 0) at o; J·X (J = diag(1,1,1,−1)) is then Minkowski-orthogonal to them, and
// orientation-preserving isometries carry it along.
Direction quad_light_normal(QuadLight l) {
    vec4 E1 = l.edge1, E2 = l.edge2, c = l.corner;
    vec4 X = vec4(dot(E1.yzw, cross(E2.yzw, c.yzw)), -dot(E1.xzw, cross(E2.xzw, c.xzw)),
                  dot(E1.xyw, cross(E2.xyw, c.xyw)), -dot(E1.xyz, cross(E2.xyz, c.xyz)));
    Direction N = Direction(X.xyz, -X.w);
    return N * inversesqrt(hyperbolic_form(N, N));
}

// The Klein half-widths tanh a, tanh b and the edge lengths 2a, 2b.
vec4 quad_light_chart(QuadLight l) {
    float l1 = sqrt(hyperbolic_form(l.edge1, l.edge1)), l2 = sqrt(hyperbolic_form(l.edge2, l.edge2));
    return vec4(tanh(0.5 * l1), tanh(0.5 * l2), l1, l2);
}

LightSample quad_light_sample(QuadLight l, LightQuery q, vec2 xi) {
    vec4 ch = quad_light_chart(l);
    float k1 = ch.x * (2.0 * xi.x - 1.0), k2 = ch.y * (2.0 * xi.y - 1.0);
    Point y = hyperbolic_on_model((l.corner + (k1 / ch.z) * l.edge1 + (k2 / ch.w) * l.edge2) * inversesqrt(1.0 - k1 * k1 - k2 * k2));
    float d = ambient_distance(q.p, y);

    LightSample ls;
    ls.wi       = ambient_direction_to(q.p, y);
    ls.distance = d;
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = ambient_dot(quad_light_normal(l), ambient_direction_to(y, q.p), y);   // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    float w = -hyperbolic_form(y, l.corner);
    float s = sinh(d);
    ls.pdf = s * s / (4.0 * ch.x * ch.y * w * w * w * cos_l);
    return ls;
}

// The MIS density with which quad_light_sample(l, q, ·) would have produced the geodesic from q.p
// that arrived at the hit point light_p, where wo is the arrival direction reversed — MUST mirror
// the sampler above (§6.1). Back side: 0.
float quad_light_pdf(QuadLight l, LightQuery q, Point light_p, Direction wo) {
    float cos_l = ambient_dot(quad_light_normal(l), wo, light_p);
    if (cos_l <= 0.0) return 0.0;
    vec4 ch = quad_light_chart(l);
    float w = -hyperbolic_form(light_p, l.corner);
    float s = sinh(ambient_distance(q.p, light_p));
    return s * s / (4.0 * ch.x * ch.y * w * w * w * cos_l);
}
