// Apollonian gasket — the sphere-inversion IFS (evilryu/mla lineage), wrapped in an
// outer inversion that maps the space-filling gasket to a bounded object. `morph` is the
// inversion radius² that deforms it (~0.8…1.5; 1.2 is the classic still).
//
// WHY THIS SHAPE HAS A `thickness` ROW, which is the one real decision in the port. The
// gasket's limit set has EMPTY INTERIOR — the distance estimate is ≥ 0 everywhere and
// reaches 0 only ON the fractal (measured: zero negative samples over a 200³ grid). A
// marcher still renders it, because acceptance is `d < march_epsilon(t)` — but then the
// SHAPE IS A FUNCTION OF THE MARCHER'S TOLERANCE: change MARCH_EPSILON, or just look
// from further away (the epsilon grows with t), and the object thickens. That is exactly
// the class of accident this codebase legislates away elsewhere (the heterogeneous
// medium IS min(σ, majorant), with the clamp emitted in the lookup — fable-heterogeneous
// -media). So the object here is DECLARED to be the ε-neighbourhood of the limit set:
// `thickness` is that ε, authored in world units, and the field is a true signed
// distance to it with a genuine interior. A dielectric apollonian is then meaningful,
// containment works, and the picture no longer moves when the tolerance does.
//
// Subtracting a constant keeps the estimate conservative: if f ≤ dist(p, Z) then for p
// outside the thickened set, dist(p, Z_t) = dist(p, Z) − t ≥ f − t. Never overestimates.
//
// Deferred: the ORBIT TRAP. The reference exposes min(|p|, |p|²) over the orbit as
// colouring data, which wants a per-shape data channel this repo does not have yet
// (Hit.uv is a surface chart, and an orbit trap is not one — faking it there would be
// the kind of magic fable-imagery P2 explicitly refused).
// Provides (struct + march/normal GENERATED — A1, fable-sdf-contract §4): apollonian_sdf().

// The core gasket: fold into ±1 cells, invert in a sphere of radius² `morph`, and
// accumulate the conformal scale — the estimate is the folded distance divided by it.
float apollonian_gasket(vec3 p, float morph, int iterations) {
    float scale = 1.0;
    for (int i = 0; i < iterations; i++) {
        p -= 2.0 * round(0.5 * p);
        float p2 = dot(p, p);
        float k = morph / max(p2, 1e-12);
        p *= k;
        scale *= k;
    }
    float res = min(abs(p.z) + abs(p.x), min(abs(p.x) + abs(p.y), abs(p.y) + abs(p.z)));
    return res / scale;
}

float apollonian_sdf(vec3 p, Apollonian a) {
    vec3 q = p / a.size;
    // The outer inversion. Its POLE is the local origin, where the gasket genuinely
    // accumulates (the origin is the pre-image of infinity, and the gasket fills space
    // there) — so the field going to zero at q = 0 is the shape, not an artifact. The
    // guard is only against the division itself.
    float s = 4.0 / max(dot(q, q), 1e-12);
    float d = 0.25 * apollonian_gasket(q * s + vec3(1.0), a.morph, int(a.iterations)) / s;
    return a.size * d - a.thickness;
}

// Marching (`apollonian_sdf_intersect`) and the gradient normal (`apollonian_sdf_normal`)
// are GENERATED from apollonian_sdf when a program marches this shape — fable-sdf-contract
// §4. This is the shape that leans on the step budget hardest: a distance ESTIMATE
// underestimates, so approach near the limit set is geometric rather than quadratic and
// the step count is the real cost.
