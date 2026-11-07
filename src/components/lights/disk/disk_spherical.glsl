// Disk area light in S³ — uniform-area sampling of the geodesic disk of radius ρ about `center`
// in the great sphere perpendicular to `normal` (a unit tangent vector at the center; as a 4-vector
// it is the great sphere's normal N at every point of it, x·N = 0 on it). center and normal are
// the backing region's placement applied to o and to the authored normal (one CPU function makes
// both), so the sampled disk is the disk rays hit.
// Area: 2π(1 − cos ρ) = 4π sin²(ρ/2). Uniform-area radius: cos r = 1 − u(1 − cos ρ), i.e.
// sin(r/2) = √u·sin(ρ/2) (the cancellation-free form). Two geodesics join p to a sampled point y:
// the short arc (length d, leaving along u = ambient_direction_to(p, y), arriving with velocity
// −ambient_direction_to(y, p)) and the long arc (length 2π − d, leaving along −u, arriving with the
// opposite velocity), with the same area density sin² d. The arc is chosen first
// (spherical_light_arc, from the query), then area → solid angle at p: dω = cos_l·dA / sin²d, with
// cos_l taken against the chosen arc's reversed arrival direction, and the pdf carries the arc's
// probability. The §6.1 byte-match invariant: disk_light_pdf mirrors the sampler's density with the
// same expressions. ONE-SIDED: emits toward +normal; back-face samples and queries return pdf 0.
// Provides (struct GENERATED from descriptor rows): disk_light_sample(), disk_light_pdf().
// Depends on: ambient_frame/ambient_geodesic/ambient_distance/ambient_direction_to/ambient_dot,
//             spherical_cos_sin/spherical_asin/spherical_light_arc/spherical_light_arc_probability
//             (the S³ occupant).

LightSample disk_light_sample(DiskLight l, LightQuery q, vec2 xi) {
    Frame f = ambient_frame(l.center, l.normal);
    float h = spherical_cos_sin(0.5 * l.radius).y;
    float r = 2.0 * spherical_asin(sqrt(xi.x) * h);
    vec2 cs = spherical_cos_sin(TWO_PI * xi.y);
    Point y = ambient_geodesic(l.center, f.t * cs.x + f.b * cs.y, r);
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
    float cos_l = ambient_dot(l.normal, long_arc ? -back : back, y);   // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    float s = spherical_cos_sin(d).y;
    ls.pdf = arc_pdf * s * s / (4.0 * PI * h * h * cos_l);
    return ls;
}

// The MIS density with which disk_light_sample(l, q, ·) would have produced the geodesic from q.p
// that arrived at the hit point light_p, where wo is the arrival direction reversed — MUST mirror
// the sampler above (§6.1). Both arcs have the area density sin² d and the same arc probability,
// so only the emitter cosine depends on which arc the ray travelled, and wo gives it. Back side: 0.
float disk_light_pdf(DiskLight l, LightQuery q, Point light_p, Direction wo) {
    float cos_l = ambient_dot(l.normal, wo, light_p);
    if (cos_l <= 0.0) return 0.0;
    float h = spherical_cos_sin(0.5 * l.radius).y;
    float s = spherical_cos_sin(ambient_distance(q.p, light_p)).y;
    return spherical_light_arc_probability(q) * s * s / (4.0 * PI * h * h * cos_l);
}
