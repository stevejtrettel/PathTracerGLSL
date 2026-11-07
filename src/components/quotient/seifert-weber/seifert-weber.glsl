// The Seifert–Weber space H³/Γ: pure group math, no calls into the program. The math and its
// measurements are in seifert-weber.md.
// Provides: quotient_image_index(), quotient_image_query(), quotient_image_direction(),
//           seifert_weber_exit(), seifert_weber_cross().
// Depends on: FACE_N[12], PAIRING[12] (the occupant's const tables, emitted just before this
//             block), hyperbolic_form() (the H³ occupant), Ray/LightQuery (structs).
//
// The fundamental domain D is the regular dodecahedron about o with dihedral angle 2π/5:
// D = {p : ⟨FACE_N[i], p⟩ ≤ 0 for all i}, ⟨FACE_N[i], p⟩ = sinh of p's distance beyond face i.
// Face i xor 1 is opposite face i. A ray leaving D through face i continues from PAIRING[i]
// applied to its exit point and velocity. The generated walk (scene_intersect) queries the one
// scene copy in D cell after cell, so every hit is reported in D's chart.
//
// The NEE image table S13: image 0 is a light in D, image 1 + f its copy in the cell across face
// f. Seen from x, image 1 + f is the light in D seen from PAIRING[f]·x. The index below and the
// two maps after it are this one numbering.

// The image of a hit the walk found after `crossings` face crossings, the first through
// `first_face`: 0, 1 + first_face, or −1 (not in the table). D and the cell across one face form
// a convex region (72° ≤ 90°), so a geodesic from D reaches that cell through exactly one face.
int quotient_image_index(int crossings, int first_face) {
    return crossings == 0 ? 0 : (crossings == 1 ? 1 + first_face : -1);
}

// The query seen from image j: the lights in D seen from the returned query are image j of the
// lights seen from q (its point and normal moved by PAIRING[j − 1]).
LightQuery quotient_image_query(LightQuery q, int j) {
    if (j > 0) {
        q.p = PAIRING[j - 1] * q.p;
        q.n = PAIRING[j - 1] * q.n;
    }
    return q;
}

// A direction at the moved query's point (quotient_image_query(q, j).p) carried back to q.p: by
// PAIRING[j − 1]⁻¹ = PAIRING[(j − 1) xor 1].
Direction quotient_image_direction(int j, Direction v) {
    return j > 0 ? PAIRING[(j - 1) ^ 1] * v : v;
}

// The face where the ray (r.origin in D) leaves D, and τ = tanh of the arc length to it. Along
// γ(t) = cosh t·p + sinh t·v, ⟨N, γ(t)⟩ = 0 where tanh t = −⟨N, p⟩/⟨N, v⟩; the ray leaves through
// the face with ⟨N, v⟩ > 0 that it meets first. τ ≤ tanh(2R_c) < 1, D's diameter being 2R_c.
float seifert_weber_exit(Ray r, out int face) {
    float tau = 1.0;
    face = 0;
    for (int i = 0; i < 12; i++) {
        float b = hyperbolic_form(FACE_N[i], r.direction);
        if (b > 0.0) {
            float ti = max(-hyperbolic_form(FACE_N[i], r.origin) / b, 0.0);
            if (ti < tau) { tau = ti; face = i; }
        }
    }
    return tau;
}

// The ray continued past `face` at τ = tanh t: the exit point and velocity are p + τv and v + τp
// (cosh t·p + sinh t·v and sinh t·p + cosh t·v divided by cosh t), put back on the hyperboloid
// and on its tangent space, then moved by the pairing. Renormalizing at every crossing is
// required: the constraint ⟨p, v⟩ = 0 is unstable (its defect grows by cosh 2t per crossing).
Ray seifert_weber_cross(Ray r, float tau, int face) {
    Point q = r.origin + tau * r.direction;
    Direction w = r.direction + tau * r.origin;
    Point p = q * inversesqrt(-hyperbolic_form(q, q));
    Direction v = w + hyperbolic_form(w, p) * p;
    v *= inversesqrt(hyperbolic_form(v, v));
    return Ray(PAIRING[face] * p, PAIRING[face] * v, r.wl);
}
