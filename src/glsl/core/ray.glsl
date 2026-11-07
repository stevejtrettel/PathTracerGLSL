// Ray construction — see docs/trace-loop-contract.md.
// A Ray carries origin, unit direction and current wavelengths, with no search interval. Self-intersection
// escape is an ORIGIN OFFSET along the geodesic (ray_spawn), so a Ray's origin is already off the
// surface. Search bounds live elsewhere: nearest-hit uses hit.t; occlusion passes a maxDist argument.
// Provides: make_ray(), ray_spawn(). Depends on: Ray/Hit (structs), ambient_geodesic/ambient_dot/
//           ambient_parallel_transport.

Ray make_ray(Point origin, Direction dir, Wavelengths wl) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    r.wl        = wl;
    return r;
}

// Spawn a scattered/shadow ray from a hit: origin escaped to wi's SIDE of the surface along the
// geodesic (robust at grazing, curved-correct). Transmission gets the far side for free.
// "Side" means the side of the TRUE surface, so the offset runs along the geometric normal
// hit.ng, not the shading normal. With an interpolated shading normal (a smooth mesh) a
// direction sampled around the shading normal can point below the true plane; offsetting it
// along the shading normal would put the origin on the outside, and the ray would cross back
// through its own triangle — a spurious hit that, on an emitter, counts its emission under
// MIS but not under NEE (witness mesh-light-smooth). Along ng the ray starts on the side it
// actually travels into. For surfaces whose shading normal is the true normal, ng = frame.n.
// The escape distance is the HIT'S OWN positional uncertainty (hit.eps): fp-scale for analytic
// roots and triangle tests, the marcher's clearance for marched commits. This offset is the ONE
// self-intersection mechanism for analytic and triangle hits (their floors are t > 0), so the
// fill must exceed the hit's true error with margin — the null-crossing loops' progress and
// the media shadow walker both ride on it.
// The direction is wi carried to the new origin by parallel transport along the offset geodesic:
// a ray is a point and a unit tangent vector THERE. In a curved space wi is tangent at hit.p, not at
// the moved origin; kept as is it is off by about hit.eps·cos, and a specular chain passes that on
// (a reflected or refracted direction inherits the arriving one's error), so after a few bounces
// inside a glass ball the curved roots, which assume a unit tangent ray, put the hit beyond hit.eps
// from the surface and the next spawn on the wrong side. In E³ the transport is the identity.
Ray ray_spawn(Hit hit, Direction wi) {
    float side = ambient_dot(wi, hit.ng, hit.p) >= 0.0 ? 1.0 : -1.0;
    Point origin = ambient_geodesic(hit.p, hit.ng * side, hit.eps);
    return make_ray(origin, ambient_parallel_transport(wi, hit.p, origin), hit.wl);
}
