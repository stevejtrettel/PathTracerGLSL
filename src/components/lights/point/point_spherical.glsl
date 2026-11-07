// Point light in S³ — delta light sampler. Two geodesics join the shading point p to the light: the
// short arc (length d) and the long arc (length 2π − d, leaving in the opposite direction). The
// radiant intensity I spreads over the geodesic sphere of radius d about the light, of area
// 4π·sin²d, the same for both arcs, so each arc delivers I/sin²d (A(d) = sin²d in place of E³'s
// d²; the irradiance on a surface is I·|cos θ|/sin²d summed over the arc leaving into each side).
// The arc is chosen by spherical_light_arc (from the query), and the pdf is its probability.
// The position row is the light's point on the sphere (exp_o of the authored position).
// Provides (struct GENERATED from descriptor rows): point_light_sample().
// Depends on: LightSample, LIGHT_DELTA, ambient_distance/ambient_direction_to,
//             spherical_cos_sin/spherical_light_arc (the S³ occupant).

LightSample point_light_sample(PointLight l, LightQuery q, vec2 xi) {
    float d = ambient_distance(q.p, l.position);
    Direction u = ambient_direction_to(q.p, l.position);
    float arc_pdf;
    bool long_arc = spherical_light_arc(q, u, arc_pdf);
    float s = spherical_cos_sin(d).y;

    LightSample ls;
    ls.wi       = long_arc ? -u : u;
    ls.distance = long_arc ? TWO_PI - d : d;
    ls.radiance = l.intensity / (s * s);   // falloff folded in (delta light, §6.1)
    ls.pdf      = arc_pdf;                 // per-light pdf: the arc choice; selection applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                      // dispatcher sets the real id
    return ls;
}
