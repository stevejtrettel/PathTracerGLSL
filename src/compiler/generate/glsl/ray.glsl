// Ray construction — see docs/trace-loop-contract.md.
// A Ray is a geodesic seed (origin + unit direction) plus its intersection search interval
// [tmin, tmax]. Self-intersection escape is an ORIGIN OFFSET (done by the caller via
// ambient_geodesic), not a job for tmin — so these constructors take the already-offset origin,
// matching the original optics/types.md vocabulary.
// Provides: make_ray(), make_shadow_ray(). Depends on: Ray (structs), EPSILON/MAX_DIST (math).

Ray make_ray(Point origin, Direction dir) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    r.tmin      = EPSILON;
    r.tmax      = MAX_DIST;
    return r;
}

Ray make_shadow_ray(Point origin, Direction dir, float dist) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    r.tmin      = EPSILON;
    r.tmax      = dist;      // bounded at the light distance (tmax = live search bound)
    return r;
}
