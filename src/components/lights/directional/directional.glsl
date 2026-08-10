// Directional (distant) light — the delta-in-DIRECTION class's first occupant
// (impl-plan-directional-beam): uniform irradiance E from a fixed direction — the sun.
// Delta light: never hittable, per-light pdf = 1, MIS weight 1 (§6.4). NOTHING folds
// into radiance — a distant source has no 1/d² and no angular falloff; `irradiance` is
// E (W/m², measured ⊥ to the propagation direction — B2's ladder, the delta-direction
// rung) and the BSDF's cosine supplies surface obliquity as always. distance = 1.0e20
// is the §6.1 directional/environment convention (structs.glsl L58; the env sampler's
// exact sentinel): the shadow walker runs to "infinity", so an unbounded ambient
// MEDIUM correctly swallows the sun — identical to the samplable env today.
// ANISOTROPIC delta — deliberately NO deltaQuery fact (there is no position to place
// the equiangular pivot at; the Validator rejects under 'equiangular', spot's path).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): directional_light_sample().
// Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.

LightSample directional_light_sample(DirectionalLight l, Point p, vec2 xi) {
    LightSample ls;
    ls.wi       = -l.direction;    // direction = PROPAGATION (spot's convention); wi points back at the source
    ls.distance = 1.0e20;          // §6.1 directional/environment sentinel
    ls.radiance = l.irradiance;    // nothing folds (no falloff; transmittance is the walker's job)
    ls.pdf      = 1.0;             // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;              // dispatcher sets the real id
    return ls;
}
