// Spot light — delta light with a smooth cone falloff (transcribed from pbrt-v4
// SpotLight: I(w) = I · smoothstep(cosFalloffEnd, cosFalloffStart, cosθ)). Struct-shaped
// (the house pattern). Delta: 1/d² AND the falloff fold into radiance; per-light pdf = 1;
// no pdf function (never hittable, never MIS-queried). ANISOTROPIC delta — deliberately
// declares NO deltaQuery fact: the equiangular estimate consumes a queried intensity
// directly, and an on-axis value would bias it (the Validator rejects spot under
// 'equiangular'; a direction-dependent query is the deferred fix).
// cos_falloff_start > cos_falloff_end strictly (Validator: falloffStart < angle —
// smoothstep is undefined at equal edges).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): spot_light_sample().
// Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.

LightSample spot_light_sample(SpotLight l, Point p, vec2 xi) {
    vec3 d = l.position - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    // Emission direction is -wi; the cone falloff rides the axis cosine.
    float cos_theta = dot(l.direction, -ls.wi);
    float falloff = smoothstep(l.cos_falloff_end, l.cos_falloff_start, cos_theta);
    ls.radiance = l.intensity * (falloff / d2);   // falloff + 1/d² folded (delta, §6.1)
    ls.pdf      = 1.0;                 // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                  // dispatcher sets the real id
    return ls;
}
