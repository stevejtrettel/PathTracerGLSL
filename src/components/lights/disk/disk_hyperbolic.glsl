// Disk area light in H³ — uniform-area sampling of the geodesic disk of radius ρ about `center`
// in the totally geodesic plane perpendicular to `normal` (a unit tangent vector at the center;
// as a 4-vector it is the plane's normal N at every point of the plane, ⟨x, N⟩ = 0 on it).
// center and normal are the backing region's placement applied to o and to the authored normal
// (one CPU function makes both), so the sampled disk is the disk rays hit.
// Area: 2π(cosh ρ − 1) = 4π sinh²(ρ/2). Uniform-area radius: cosh r = 1 + u(cosh ρ − 1), i.e.
// sinh(r/2) = √u·sinh(ρ/2) (the cancellation-free form). Area → solid angle at p:
// dω = cos_l·dA / sinh²d, with cos_l taken against the reversed arrival direction of the
// geodesic at the light point: ambient_direction_to(y, p) for a sample y, the transport's wo at a
// hit. The §6.1 byte-match invariant: disk_light_pdf mirrors the sampler's density with the same
// expressions. ONE-SIDED: emits toward +normal; back-face samples and queries return pdf 0.
// Provides (struct GENERATED from descriptor rows): disk_light_sample(), disk_light_pdf().
// Depends on: ambient_frame/ambient_geodesic/ambient_distance/ambient_direction_to/ambient_dot.

LightSample disk_light_sample(DiskLight l, LightQuery q, vec2 xi) {
    Frame f = ambient_frame(l.center, l.normal);
    float h = sinh(0.5 * l.radius);
    float r = 2.0 * asinh(sqrt(xi.x) * h);
    float phi = TWO_PI * xi.y;
    Point y = ambient_geodesic(l.center, f.t * cos(phi) + f.b * sin(phi), r);
    float d = ambient_distance(q.p, y);

    LightSample ls;
    ls.wi       = ambient_direction_to(q.p, y);
    ls.distance = d;
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = ambient_dot(l.normal, ambient_direction_to(y, q.p), y);   // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    float s = sinh(d);
    ls.pdf = s * s / (4.0 * PI * h * h * cos_l);
    return ls;
}

// The MIS density with which disk_light_sample(l, q, ·) would have produced the geodesic from q.p
// that arrived at the hit point light_p, where wo is the arrival direction reversed — MUST mirror
// the sampler above (§6.1). Back side: 0.
float disk_light_pdf(DiskLight l, LightQuery q, Point light_p, Direction wo) {
    float cos_l = ambient_dot(l.normal, wo, light_p);
    if (cos_l <= 0.0) return 0.0;
    float h = sinh(0.5 * l.radius);
    float s = sinh(ambient_distance(q.p, light_p));
    return s * s / (4.0 * PI * h * h * cos_l);
}
