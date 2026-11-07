// Point light in H³ — delta light sampler. The radiant intensity I spreads over the geodesic
// sphere of radius d about the light, whose area is 4π·sinh²d, so the irradiance factor is
// I/sinh²d (A(d) = sinh²d in place of E³'s d²; flux 4πI is conserved through every sphere).
// The position row is the light's point on the hyperboloid (exp_o of the authored position).
// Provides (struct GENERATED from descriptor rows): point_light_sample().
// Depends on: LightSample, LIGHT_DELTA, ambient_distance/ambient_direction_to.

LightSample point_light_sample(PointLight l, LightQuery q, vec2 xi) {
    float d = ambient_distance(q.p, l.position);
    float s = sinh(d);

    LightSample ls;
    ls.wi       = ambient_direction_to(q.p, l.position);
    ls.distance = d;
    ls.radiance = l.intensity / (s * s);   // falloff folded in (delta light, §6.1)
    ls.pdf      = 1.0;                     // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                      // dispatcher sets the real id
    return ls;
}
