// Euclidean Ambient Geometry
// Flat-space geometric operations (geodesics, frames, dot products, parallel transport)
// These functions are the interface that non-Euclidean geometries would override

#ifndef Point
#define Point vec3
#endif

#ifndef Direction
#define Direction vec3
#endif

Point ambient_geodesic(Point origin, Direction dir, float t) {
    return origin + dir * t;
}

Frame ambient_frame(Point p, Direction dir) {
    Direction n = normalize(dir);
    Direction t = abs(n.x) < 0.9 ? Direction(1.0, 0.0, 0.0) : Direction(0.0, 1.0, 0.0);
    t = normalize(t - dot(t, n) * n);
    Direction b = cross(n, t);
    return Frame(p, t, b, n);
}

float ambient_dot(Direction v1, Direction v2, Point p) {
    return dot(v1, v2);
}

Direction ambient_parallel_transport(Direction v, Point from, Point to) {
    return v;
}
