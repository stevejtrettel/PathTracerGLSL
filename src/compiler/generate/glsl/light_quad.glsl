// Quad area light — uniform surface sampling, area→solid-angle pdf (§6.1 / reference §6.1).
// Provides: quad_light_sample(). Depends on: LightSample (structs), Point/Spectrum typedefs.
// ONE-SIDED: emits from the cross(edge1, edge2) side (impl-plan-area-lights pinned deviation);
// the hit-side region_to convention agrees. n_l and area are precompiled constants.
// Pitfall 1: radiance carries NO 1/d² — the falloff IS the d²/(A·cosθ) measure (double-falloff bug).
// Pitfall 2: back-face samples return pdf = 0 (the old GLSL's pdf=1,radiance=0 poisons MIS).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).

LightSample quad_light_sample(Point corner, vec3 edge1, vec3 edge2, Direction n_l, float area, Spectrum Le, Point p, vec2 xi) {
    Point q = corner + xi.x * edge1 + xi.y * edge2;
    vec3 d = q - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = Le;                       // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = dot(n_l, -ls.wi);         // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    // THE measure conversion: pdf_area = 1/A, converted to solid angle at p (§6.1).
    ls.pdf = d2 / (area * cos_l);
    return ls;
}
