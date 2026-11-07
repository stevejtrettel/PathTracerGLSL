// Point light in H²×R — delta light sampler. The radiant intensity I spreads over the geodesic
// sphere about the light, whose area per unit solid angle at the light, in the direction of the
// shading point p, is J = d²·sinh(D_H)/D_H (h2xr_area_density: D_H the H² distance, d the distance).
// So the irradiance factor is I/J — not a function of d alone: a light straight above falls off as
// 1/d², one at the same height as 1/(d·sinh d). Flux 4πI is conserved through every sphere.
// The position row is the light's point (exp_o of the authored position).
// Provides (struct GENERATED from descriptor rows): point_light_sample().
// Depends on: LightSample, LIGHT_DELTA, ambient_distance/ambient_direction_to, h2xr_area_density.

LightSample point_light_sample(PointLight l, LightQuery q, vec2 xi) {
    LightSample ls;
    ls.wi       = ambient_direction_to(q.p, l.position);
    ls.distance = ambient_distance(q.p, l.position);
    ls.radiance = l.intensity / h2xr_area_density(q.p, l.position);   // falloff folded in (delta light, §6.1)
    ls.pdf      = 1.0;                     // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                      // dispatcher sets the real id
    return ls;
}
