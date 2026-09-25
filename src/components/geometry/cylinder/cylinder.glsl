// Cylinder (finite, capped, canonical Y-axis — orientation is PLACEMENT, not shape:
// a tilted cylinder is transform.rotation through the rigid-residual/frame arms,
// exactly like box). Both backends' math in one wholesale file (§2.12);
// placement-fold stage 4 added the analytic pair.
// Provides (struct GENERATED from descriptor rows — A1): cylinder_sdf() (also the
// analytic backend's containment query), cylinder_intersect(), cylinder_normal().

// Exact signed distance to the capped cylinder (not a bound): correct sign, never
// overestimates, exact near the surface — full quality for marching, containment,
// and gradient normals alike.
float cylinder_sdf(vec3 p, Cylinder c) {
    vec3 q = p - c.center;
    vec2 d = vec2(length(q.xz) - c.radius, abs(q.y) - c.halfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Nearest intersection strictly ahead of the ray (t > 0): the capped cylinder as the
// INTERVAL intersection of the axis slab and the infinite tube — caps and side fall
// out of one [tn, tf] pair, no per-face candidate juggling. Root selection by the
// INSIDE test (tn < 0 ⇔ origin inside), the sphere_intersect discipline.
bool cylinder_intersect(Ray ray, Cylinder c, out float t) {
    vec3 q = ray.origin - c.center;
    vec3 d = ray.direction;
    float tn, tf;
    if (abs(d.y) > 1e-12) {
        float ta = (-c.halfHeight - q.y) / d.y;
        float tb = ( c.halfHeight - q.y) / d.y;
        tn = min(ta, tb); tf = max(ta, tb);
    } else {
        if (abs(q.y) > c.halfHeight) return false;   // axis-normal ray outside the slab
        tn = -1.0e30; tf = 1.0e30;
    }
    float a  = d.x * d.x + d.z * d.z;
    float bq = q.x * d.x + q.z * d.z;
    float cc = q.x * q.x + q.z * q.z - c.radius * c.radius;
    if (a > 1e-12) {
        // The sphere_intersect robust form in 2D: bq² − a·cc = a·r² − (q × d)² (Lagrange's
        // identity), which avoids subtracting two numbers of size |q|² for thin, distant
        // tubes; the near root as cc/Q.
        float cross_qd = q.x * d.z - q.z * d.x;
        float disc = a * c.radius * c.radius - cross_qd * cross_qd;
        if (disc < 0.0) return false;
        float Q = (bq >= 0.0) ? -bq - sqrt(disc) : -bq + sqrt(disc);
        if (Q == 0.0) return false;   // tangent through the origin
        float ra = Q / a, rb = cc / Q;
        tn = max(tn, min(ra, rb));
        tf = min(tf, max(ra, rb));
        if (tf < tn) return false;
    } else if (cc > 0.0) {
        return false;   // axis-parallel ray outside the tube
    }
    t = (tn < 0.0) ? tf : tn;
    return t > 0.0;   // floor 0: escape is ray_spawn's offset (impl-plan-epsilon-discipline)
}

// Outward surface normal at p (a point on/near the surface): the smaller surface
// residual picks the face — exact on caps and side, the nearer face at the rim.
vec3 cylinder_normal(vec3 p, Cylinder c) {
    vec3 q = p - c.center;
    float dy = c.halfHeight - abs(q.y);
    float dr = c.radius - length(q.xz);
    if (dy < dr) return vec3(0.0, sign(q.y), 0.0);
    return normalize(vec3(q.x, 0.0, q.z));
}

// The INTERVAL form (impl-plan-sdf-as-shape T2) — the slab ∩ tube interval that
// cylinder_intersect already computes internally, exposed as entry/exit for a marched
// arm. Entry clamped to 0; cylinder_intersect stays untouched.
bool cylinder_interval(Ray ray, Cylinder c, out float t0, out float t1) {
    vec3 q = ray.origin - c.center;
    vec3 d = ray.direction;
    float tn, tf;
    if (abs(d.y) > 1e-12) {
        float ta = (-c.halfHeight - q.y) / d.y;
        float tb = ( c.halfHeight - q.y) / d.y;
        tn = min(ta, tb); tf = max(ta, tb);
    } else {
        if (abs(q.y) > c.halfHeight) return false;
        tn = -1.0e30; tf = 1.0e30;
    }
    float a  = d.x * d.x + d.z * d.z;
    float bq = q.x * d.x + q.z * d.z;
    float cc = q.x * q.x + q.z * q.z - c.radius * c.radius;
    if (a > 1e-12) {
        // The sphere_intersect robust form in 2D: bq² − a·cc = a·r² − (q × d)² (Lagrange's
        // identity), which avoids subtracting two numbers of size |q|² for thin, distant
        // tubes; the near root as cc/Q.
        float cross_qd = q.x * d.z - q.z * d.x;
        float disc = a * c.radius * c.radius - cross_qd * cross_qd;
        if (disc < 0.0) return false;
        float Q = (bq >= 0.0) ? -bq - sqrt(disc) : -bq + sqrt(disc);
        if (Q == 0.0) return false;   // tangent through the origin
        float ra = Q / a, rb = cc / Q;
        tn = max(tn, min(ra, rb));
        tf = min(tf, max(ra, rb));
    } else if (cc > 0.0) {
        return false;
    }
    if (tf < tn || tf <= 0.0) return false;   // behind the ray — see sphere_interval
    t0 = max(tn, 0.0);
    t1 = tf;
    return true;
}

// Marching (`cylinder_sdf_intersect`) and the gradient normal (`cylinder_sdf_normal`)
// are GENERATED from cylinder_sdf when a program marches this shape — fable-sdf-contract §4.
