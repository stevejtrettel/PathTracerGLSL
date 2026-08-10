// Beam light — collimated finite-cross-section source: the honest laser
// (impl-plan-directional-beam). The delta² idealization (delta in position AND
// direction) is unbuildable in an unbiased tracer — its single-scatter visibility is
// supported on a measure-zero set (eye line × beam line; the degeneracy behind the
// photon-beams blur kernel) — so the beam is a disk APERTURE (`position` = center,
// `radius`) emitting delta-in-direction: from any point p inside the forward cylinder
// exactly one emitted ray arrives, and the sample is a pure EVALUATION (no RNG read).
// Delta light: never hittable, per-light pdf = 1, MIS weight 1 (§6.4). NOTHING folds
// into radiance — collimation means transmittance is the ONLY attenuation, and the
// shadow walker supplies it: the shadow target is the aperture point p − s·direction,
// so occluders and media BETWEEN aperture and p attenuate, nothing behind blocks, and
// occlusion is what terminates the beam (no range parameter — a laser stops at the
// wall). Outside the cylinder: pdf = 0, the NEE techniques' existing invalid-sample
// guard (`if (ls.pdf <= 0.0) return;` at both the surface and medium sites).
// The visible-beam-in-fog shot needs no new machinery: distance sampling puts a medium
// vertex on the eye ray; vertices landing inside the cylinder connect. v1 noise
// ceiling (plan P7): vertex placement ignores beam proximity — tight beams in thin fog
// firefly at low spp; the beam-segment mediumLightSampling technique is the deferred fix.
// v1 cross-section is a HARD-EDGED disk (exact witness numbers); Gaussian profile = one
// deferred row. ANISOTROPIC delta — no deltaQuery fact (equiangular rejects, spot's path).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): beam_light_sample().
// Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.

LightSample beam_light_sample(BeamLight l, Point p, vec2 xi) {
    LightSample ls;
    vec3  rel    = p - l.position;
    float s      = dot(rel, l.direction);              // axial distance along the beam
    vec3  radial = rel - s * l.direction;
    if (s <= 0.0 || dot(radial, radial) > l.radius * l.radius) {
        ls.pdf = 0.0;                                  // outside the forward cylinder: invalid sample
        return ls;
    }
    ls.wi       = -l.direction;                        // back toward the aperture
    ls.distance = s;                                   // shadow target = the aperture point p - s*direction
    ls.radiance = l.irradiance;                        // nothing folds: collimated (T is the walker's job)
    ls.pdf      = 1.0;                                 // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                                  // dispatcher sets the real id
    return ls;
}
