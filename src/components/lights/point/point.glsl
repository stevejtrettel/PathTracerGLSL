// Point light — delta light sampler (§6.1 / reference §6.3).
// Provides: point_light_sample(). Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.
// The per-kind library (mirrors lambert.glsl); the generated dispatcher calls it with the
// light's baked constants. Delta light: 1/d² falloff is folded into radiance, per-light pdf = 1.

LightSample point_light_sample(Point position, Spectrum intensity, Point p) {
    vec3 d = position - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = intensity / d2;      // falloff folded in (delta light, §6.1)
    ls.pdf      = 1.0;                  // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                  // dispatcher sets the real id
    return ls;
}
