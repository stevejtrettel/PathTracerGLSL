// Ray construction — see docs/trace-loop-contract.md.
// A Ray is a pure geodesic seed: origin + unit direction, no search interval. Self-intersection
// escape is an ORIGIN OFFSET (done by the caller via ambient_geodesic), so the origin passed here
// is already off the surface. Search bounds live elsewhere: nearest-hit uses hit.t; occlusion
// passes a maxDist argument.
// Provides: make_ray(). Depends on: Ray (structs).

Ray make_ray(Point origin, Direction dir) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    return r;
}
