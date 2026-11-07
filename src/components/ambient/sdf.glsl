// The vocabulary of marched fields in a curved space (H³, S³), written over the metric seam so one
// source serves both; the space-specific pieces, sdf_plane() and sdf_tube(), are in each occupant's
// GLSL. Included exactly when a curved program marches. A field is a function of a point p of the
// model (a vec4) in the object's own frame, whose origin o = (0,0,0,1) the placement carries to the
// object's position.
//
// Every piece here is a true geodesic distance or a 1-Lipschitz function of such distances, and a
// 1-Lipschitz f never claims more than the distance to its own zero set (for q with f(q) = 0,
// |f(p)| = |f(p) − f(q)| ≤ d(p, q)) — all sphere tracing needs. min and max (union, intersection)
// keep the property; so does the smooth union, whose value is a weighted mean of its arguments' moves
// (weights w and 1 − w, both in [0, 1]). The smooth union lies at most k/4 below min(a, b), so its
// solid lies inside {min(a, b) ≤ k/4}: a march bound must contain that set.
// Provides: sdf_point(), sdf_ball(), sdf_smooth_union(), sdf_smooth_intersection(),
//           sdf_smooth_subtraction().
// Depends on: ambient_geodesic(), ambient_distance() (the occupant).

// exp_o(v): the point at distance |v| from o in direction v̂ — the meaning of an authored point.
Point sdf_point(vec3 v) {
    float s = length(v);
    if (s == 0.0) return Point(0.0, 0.0, 0.0, 1.0);
    return ambient_geodesic(Point(0.0, 0.0, 0.0, 1.0), Direction(v / s, 0.0), s);
}

// The signed distance to the geodesic ball of radius r about c.
float sdf_ball(Point p, Point c, float r) {
    return ambient_distance(p, c) - r;
}

// The polynomial smooth minimum of a and b with blend width k > 0: min(a, b) − k·h²/4,
// h = max(k − |a − b|, 0)/k. Equal to min(a, b) when |a − b| ≥ k.
float sdf_smooth_union(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}

// The smooth maximum: the solid where both fields are negative, its crease rounded by k.
float sdf_smooth_intersection(float a, float b, float k) {
    return -sdf_smooth_union(-a, -b, k);
}

// The solid of a with the solid of b carved out, the crease rounded by k.
float sdf_smooth_subtraction(float a, float b, float k) {
    return sdf_smooth_intersection(a, -b, k);
}
