// Disk area light in H²×R — uniform-area sampling of the horizontal geodesic disk of radius ρ about
// `center` (disks are horizontal in H²×R: `normal` is ±e_y, the Validator's h2xr row constraint).
// A horizontal plane is a totally geodesic copy of H², so the disk is H³'s geodesic disk in a
// plane: area 2π(cosh ρ − 1) = 4π sinh²(ρ/2), uniform-area radius sinh(r/2) = √u·sinh(ρ/2) along a
// horizontal direction (the frame's t and b at the center are horizontal). center and normal are
// the backing region's placement applied to o and to the authored normal (one CPU function makes
// both), so the sampled disk is the disk rays hit. Area → solid angle at p: dω = cos_l·dA/J with
// J = h2xr_area_density(p, y) = d²·sinh(D_H)/D_H (direction-dependent, unlike H³'s sinh² d), and
// cos_l taken against the reversed arrival direction of the geodesic at the light point:
// ambient_direction_to(y, p) for a sample y, the transport's wo at a hit. The §6.1 byte-match
// invariant: disk_light_pdf mirrors the sampler's density with the same expressions. ONE-SIDED:
// emits toward +normal; back-face samples and queries return pdf 0.
// Provides (struct GENERATED from descriptor rows): disk_light_sample(), disk_light_pdf().
// Depends on: ambient_frame/ambient_geodesic/ambient_distance/ambient_direction_to/ambient_dot,
//             h2xr_area_density.

LightSample disk_light_sample(DiskLight l, LightQuery q, vec2 xi) {
    Frame f = ambient_frame(l.center, l.normal);
    float h = sinh(0.5 * l.radius);
    float r = 2.0 * asinh(sqrt(xi.x) * h);
    float phi = TWO_PI * xi.y;
    Point y = ambient_geodesic(l.center, f.t * cos(phi) + f.b * sin(phi), r);

    LightSample ls;
    ls.wi       = ambient_direction_to(q.p, y);
    ls.distance = ambient_distance(q.p, y);
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = ambient_dot(l.normal, ambient_direction_to(y, q.p), y);   // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    ls.pdf = h2xr_area_density(q.p, y) / (4.0 * PI * h * h * cos_l);
    return ls;
}

// The MIS density with which disk_light_sample(l, q, ·) would have produced the geodesic from q.p
// that arrived at the hit point light_p, where wo is the arrival direction reversed — MUST mirror
// the sampler above (§6.1). Back side: 0.
float disk_light_pdf(DiskLight l, LightQuery q, Point light_p, Direction wo) {
    float cos_l = ambient_dot(l.normal, wo, light_p);
    if (cos_l <= 0.0) return 0.0;
    float h = sinh(0.5 * l.radius);
    return h2xr_area_density(q.p, light_p) / (4.0 * PI * h * h * cos_l);
}
