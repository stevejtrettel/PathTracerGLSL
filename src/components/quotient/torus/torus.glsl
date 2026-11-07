// The cube 3-torus E³/Γ, Γ = Lx·Z × Ly·Z × Lz·Z: pure lattice math, no calls into the program.
// Provides: quotient_image_index(), quotient_image_shift(), quotient_image(), quotient_reduce(),
//           torus_face_times().
// Depends on: TORUS_PERIOD (vec3, the periods L), TORUS_BIG (a face time that never wins),
//             Point/Direction (ambient types), Ray/Hit (structs).
//
// The fundamental domain is D = [−L/2, L/2]³ (componentwise); cell k ∈ Z³ is D + L∘k (∘ is the
// componentwise product). The generated walk (scene_intersect) visits the cells a ray crosses
// and queries the one scene copy in D with the ray translated by −L∘k, so the hit it reports is
// in D's chart: its point is (origin + direction·t) − L∘k, up to rounding.
//
// The NEE image table S is the 27 translations L∘c, c ∈ {−1, 0, 1}³. Image j names
// c_j = (j/9, (j/3)%3, j%3) − 1, and the index and the shift below are this one numbering.

// The image of cell k in the table, or −1 when k is not in {−1, 0, 1}³.
int quotient_image_index(vec3 k) {
    return all(lessThanEqual(abs(k), vec3(1.0))) ? int(dot(k + 1.0, vec3(9.0, 3.0, 1.0))) : -1;
}

// The translation L∘c_j of image j: a light at c in D has its image j at c + L∘c_j.
Point quotient_image_shift(int j) {
    return TORUS_PERIOD * (vec3(float(j / 9), float((j / 3) % 3), float(j % 3)) - 1.0);
}

// The image a ray from x along wi hit: the walk reported h.p = (x' + wi·h.t) − L∘k for its origin
// x', so (x + wi·h.t − h.p)/L is the integer vector k up to the spawn offset |x' − x| and the
// rounding of points within the far clip, both far below L/2. Rounding it recovers k exactly.
int quotient_image(Point x, Direction wi, Hit h) {
    return quotient_image_index(round((x + wi * h.t - h.p) / TORUS_PERIOD));
}

// The point of D equivalent to p (p − L∘k for the cell k containing p).
Point quotient_reduce(Point p) {
    return p - TORUS_PERIOD * floor(p / TORUS_PERIOD + 0.5);
}

// The ray's arc lengths to the three exit faces of cell k (the faces on the side of each step
// s = ±1), measured from r.origin. A zero component (−0.0 included: `!= 0.0` is false for it)
// never reaches its faces and gets TORUS_BIG, so a ray parallel to a face never steps across it.
vec3 torus_face_times(Ray r, vec3 k, vec3 s) {
    vec3 c = (k + 0.5 * s) * TORUS_PERIOD - r.origin;
    return vec3(r.direction.x != 0.0 ? c.x / r.direction.x : TORUS_BIG,
                r.direction.y != 0.0 ? c.y / r.direction.y : TORUS_BIG,
                r.direction.z != 0.0 ? c.z / r.direction.z : TORUS_BIG);
}
