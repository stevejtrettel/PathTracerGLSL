// Sphere area light — VISIBLE-CONE sampling, pdf directly in solid angle (§6.1 / reference §6.2).
// Struct-shaped (the house pattern). The §6.1 BYTE-MATCH INVARIANT lives here as two
// ADJACENT functions: sphere_light_pdf mirrors the sampler's cone density exactly.
// Pitfall 3: cone sampling, NOT uniform-surface (the old sphere-light.glsl wasted half its
// samples on the back hemisphere). p inside the light: pdf = 0 punt — OPEN; pbrt falls back to
// uniform-area sampling there (deferred).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): sphere_light_sample(), sphere_light_pdf().

LightSample sphere_light_sample(SphereLight l, Point p, vec2 xi) {
    vec3 to_c = l.center - p;
    float dc2 = dot(to_c, to_c);

    LightSample ls;
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;
    ls.light_id = -1;                       // dispatcher sets the real id

    if (dc2 <= l.radius * l.radius) {       // p inside the light: degenerate, punt (OPEN)
        ls.wi = Direction(0.0, 1.0, 0.0);
        ls.distance = 1.0;
        ls.pdf = 0.0;
        return ls;
    }

    // Sample the cone of directions subtending the sphere — pdf is DIRECTLY solid-angle.
    float sin2_max = l.radius * l.radius / dc2;
    float cos_max  = sqrt(max(0.0, 1.0 - sin2_max));
    float cos_t    = 1.0 - xi.x * (1.0 - cos_max);      // uniform in the cone
    float sin_t    = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    float phi      = TWO_PI * xi.y;

    vec3 w = to_c * inversesqrt(dc2);
    vec3 t, b;
    build_basis(w, t, b);
    ls.wi  = normalize(t * (sin_t * cos(phi)) + b * (sin_t * sin(phi)) + w * cos_t);
    ls.pdf = 1.0 / (TWO_PI * max(1e-8, 1.0 - cos_max)); // uniform-cone solid-angle pdf

    // Distance to the sphere along wi (near root — guaranteed real by the cone construction).
    float proj = dot(to_c, ls.wi);
    float det  = max(0.0, proj * proj - dc2 + l.radius * l.radius);
    ls.distance = proj - sqrt(det);
    return ls;
}

// The MIS cone density — depends only on p (mirrors the sampler above, §6.1); inside the
// sphere returns 0, matching the sampler's punt. light_p/wi unused (uniform pdf signature).
float sphere_light_pdf(SphereLight l, Point p, Point light_p, Direction wi) {
    vec3 to_c = l.center - p;
    float dc2 = dot(to_c, to_c);
    if (dc2 <= l.radius * l.radius) return 0.0;   // inside: sampler punts too
    float cos_max = sqrt(max(0.0, 1.0 - l.radius * l.radius / dc2));
    return 1.0 / (TWO_PI * max(1e-8, 1.0 - cos_max));
}
