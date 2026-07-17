// Quad area light — uniform surface sampling, area→solid-angle pdf (§6.1 / reference §6.1).
// Struct-shaped (the house pattern): normal and area are PRECOMPILED struct fields (the
// normal is the SAME compile-time literal geometry's quad bakes — bit-exact one-sided pin).
// ONE-SIDED: emits from the cross(edge1, edge2) side (impl-plan-area-lights pinned deviation);
// the hit-side region_to convention agrees.
// The §6.1 BYTE-MATCH INVARIANT lives here as two ADJACENT functions: quad_light_pdf must
// mirror quad_light_sample's density exactly — same struct, same file, same math.
// Pitfall 1: radiance carries NO 1/d² — the falloff IS the d²/(A·cosθ) measure (double-falloff bug).
// Pitfall 2: back-face samples/queries return pdf = 0 (the old pdf=1,radiance=0 poisons MIS).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): quad_light_sample(), quad_light_pdf().

LightSample quad_light_sample(QuadLight l, Point p, vec2 xi) {
    Point q = l.corner + xi.x * l.edge1 + xi.y * l.edge2;
    vec3 d = q - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = dot(l.normal, -ls.wi);    // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    // THE measure conversion: pdf_area = 1/A, converted to solid angle at p (§6.1).
    ls.pdf = d2 / (l.area * cos_l);
    return ls;
}

// The MIS density with which quad_light_sample(l, p, ·) would have produced direction wi
// toward the hit point light_p — MUST mirror the sampler above (§6.1). Back side: 0.
float quad_light_pdf(QuadLight l, Point p, Point light_p, Direction wi) {
    float cos_l = dot(l.normal, -wi);
    if (cos_l <= 0.0) return 0.0;
    vec3 d = light_p - p;
    return dot(d, d) / (l.area * cos_l);
}
