
// Fallback aliases (only if not already defined elsewhere)
#ifndef Point
#define Point vec3
#endif

#ifndef Direction
#define Direction vec3
#endif



// Geometric frame for building coordinate systems
struct Frame {
    Point base;
    Direction t, b, n;  // tangent, bitangent, normal (orthonormal basis)
};


Point ambient_geodesic(Point origin, Direction dir, float t) {
    // In Euclidean space, geodesics are straight lines
    // Travel distance t along direction dir from origin
    return origin + dir * t;
}

Frame ambient_frame(Point p, Direction dir) {
    // Build orthonormal frame with given normal as one axis
    // Use stable method to find perpendicular vectors

    Direction n = normalize(dir);

    // Find a vector not parallel to n
    Direction t = abs(n.x) < 0.9 ? Direction(1.0, 0.0, 0.0) : Direction(0.0, 1.0, 0.0);

    // Gram-Schmidt to get orthonormal basis
    t = normalize(t - dot(t, n) * n);  // Remove component parallel to n
    Direction b = cross(n, t);         // Third axis via cross product

    return Frame(p, t, b, n);
}

float ambient_dot(Direction v1, Direction v2, Point p) {
    // In Euclidean space, dot product is position-independent
    // Point p parameter enables non-Euclidean geometries later
    return dot(v1, v2);
}

Direction ambient_parallel_transport(Direction v, Point from, Point to) {
    // In Euclidean space, parallel transport doesn't change vectors
    // Vector remains the same regardless of path
    return v;
}
