// Ray construction — see docs/trace-loop-contract.md.
// A Ray is a pure geodesic seed: origin + unit direction, no search interval. Self-intersection
// escape is an ORIGIN OFFSET along the geodesic (ray_spawn), so a Ray's origin is already off the
// surface. Search bounds live elsewhere: nearest-hit uses hit.t; occlusion passes a maxDist argument.
// Provides: make_ray(), ray_spawn(). Depends on: Ray/Hit (structs), ambient_geodesic/ambient_dot.

Ray make_ray(Point origin, Direction dir) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    return r;
}

// Spawn a scattered/shadow ray from a hit: origin escaped to wi's SIDE of the surface along the
// geodesic (robust at grazing, curved-correct). Transmission gets the far side for free.
// The escape distance is the HIT'S OWN positional uncertainty (hit.eps, provenance-filled —
// impl-plan-epsilon-discipline): fp-scale for analytic roots, the marcher's clearance for
// marched commits. This offset is the ONE self-intersection mechanism for the analytic tier
// (their floors are t > 0), so the fill must exceed the hit's true error with margin — the
// null-crossing loops' progress and the media shadow walker both ride on it.
Ray ray_spawn(Hit hit, Direction wi) {
    float side = ambient_dot(wi, hit.frame.n, hit.p) >= 0.0 ? 1.0 : -1.0;
    return make_ray(ambient_geodesic(hit.p, hit.frame.n * side, hit.eps), wi);
}
