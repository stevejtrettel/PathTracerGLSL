// Disk area light — CONCENTRIC uniform-area sampling, area→solid-angle pdf (§6.1;
// pbrt-v4 Disk::Sample / SampleUniformDiskConcentric — better stratification than the
// √u polar map under pcg4d and future low-discrepancy samplers).
// Struct-shaped (the house pattern). The §6.1 BYTE-MATCH INVARIANT lives here as two
// ADJACENT functions: disk_light_pdf mirrors the sampler's density exactly — A = π·r²
// is computed IDENTICALLY inline in both (one multiply; no derived field needed, unlike
// quad's |cross|). ONE-SIDED: emits from the +normal side; l.normal is the SAME
// unitVec3-normalized value the geometry disk's struct carries (the one-sided pin).
// Pitfall 1: radiance carries NO 1/d² — the falloff IS the d²/(A·cosθ) measure.
// Pitfall 2: back-face samples/queries return pdf = 0 (pdf=1,radiance=0 poisons MIS).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): disk_light_sample(), disk_light_pdf().
// Depends on: concentric_disk + build_basis (core math).

LightSample disk_light_sample(DiskLight l, Point p, vec2 xi) {
    vec3 t, b;
    build_basis(l.normal, t, b);
    vec2 u = l.radius * concentric_disk(xi);
    Point q = l.center + u.x * t + u.y * b;
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

    // THE measure conversion: pdf_area = 1/(π r²), converted to solid angle at p (§6.1).
    ls.pdf = d2 / (PI * l.radius * l.radius * cos_l);
    return ls;
}

// The MIS density with which disk_light_sample(l, p, ·) would have produced direction wi
// toward the hit point light_p — MUST mirror the sampler above (§6.1). Back side: 0.
float disk_light_pdf(DiskLight l, Point p, Point light_p, Direction wi) {
    float cos_l = dot(l.normal, -wi);
    if (cos_l <= 0.0) return 0.0;
    vec3 d = light_p - p;
    return dot(d, d) / (PI * l.radius * l.radius * cos_l);
}
