// Point light — delta light sampler (§6.1 / reference §6.3). Struct-shaped (the house
// pattern): the struct is the light's record; the generated dispatcher constructs it
// from compile-time literals (hoisted const) and calls the uniform surface over it.
// Delta light: 1/d² falloff is folded into radiance; per-light pdf = 1; no pdf function
// (never hittable, never MIS-queried).
// Provides (struct GENERATED from descriptor rows — A1): point_light_sample().
// Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.

LightSample point_light_sample(PointLight l, Point p, vec2 xi) {
    vec3 d = l.position - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = l.intensity / d2;    // falloff folded in (delta light, §6.1)
    ls.pdf      = 1.0;                 // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                  // dispatcher sets the real id
    return ls;
}
