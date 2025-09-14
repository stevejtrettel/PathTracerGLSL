/* geometry.ops — Euclidean v0 (metric ops + helpers) */

// Constructors / helpers
Tangent at(Point p, Dir v) { return Tangent(p, v); }
Ray     makeRay(Point o, Dir d) { return Ray(o, normalize(d)); }

// Convert between Ray/Tangent (identical layout today; may diverge later)
Tangent asTangent(Ray r)   { return Tangent(r.o, r.d); }
Ray     asRay(Tangent t)   { return Ray(t.p, t.v); }

// Metric ops — dual form (Point,Dir,Dir) and (Tangent,Tangent)
// In Euclidean space, the metric is position-independent.
float dot_g(Point /*p*/, Dir a, Dir b) { return dot(a, b); }
float dot_g(Tangent a, Tangent b)      { return dot(a.v, b.v); }

float norm_g(Point /*p*/, Dir v) { return length(v); }
float norm_g(Tangent a)          { return length(a.v); }

Dir     normalize_g(Point /*p*/, Dir v) { return normalize(v); }
Tangent normalize_g(Tangent a)          { return Tangent(a.p, normalize(a.v)); }
