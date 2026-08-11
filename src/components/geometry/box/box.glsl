// Box (axis-aligned canonical form — rotation comes from placement: the rigid-residual
// arm for constant rotations, the frame tier for instanced placements). Both backends'
// math in one wholesale file (§2.12); placement-fold stage 4 added the analytic pair.
// Provides (struct GENERATED from descriptor rows — A1): box_sdf() (also the analytic
// backend's containment query), box_intersect(), box_normal().

float box_sdf(vec3 p, Box b) {
    vec3 d = abs(p - b.center) - b.halfSize;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// Nearest intersection ahead of the ray (t > EPSILON) — the slab method. direction is
// unit; a zero component gives ±inf slab times that min/max resolve (the bvh_aabb_hit
// convention). The FAR bound is the caller's job (t < hit.t / t < maxDist).
// Root selection by the INSIDE test (tn < 0 ⇔ origin inside the box), never by a
// t-threshold: an outside origin within EPSILON of a face must NOT fall through to the
// exit face — that skips the entry interface and fakes an exit from a region the ray
// never entered (the sphere_intersect review finding, transcribed).
bool box_intersect(Ray ray, Box b, out float t) {
    vec3 inv = 1.0 / ray.direction;
    vec3 t0 = (b.center - b.halfSize - ray.origin) * inv;
    vec3 t1 = (b.center + b.halfSize - ray.origin) * inv;
    vec3 tsm = min(t0, t1), tbg = max(t0, t1);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z);
    if (tf < tn) return false;
    t = (tn < 0.0) ? tf : tn;
    return t > EPSILON;
}

// Outward surface normal at p (a point on/near the surface): the dominant axis of the
// unit-cube map — exact on faces, the nearer face at edges/corners.
vec3 box_normal(vec3 p, Box b) {
    vec3 q = (p - b.center) / b.halfSize;
    vec3 a = abs(q);
    if (a.x >= a.y && a.x >= a.z) return vec3(sign(q.x), 0.0, 0.0);
    if (a.y >= a.z) return vec3(0.0, sign(q.y), 0.0);
    return vec3(0.0, 0.0, sign(q.z));
}

// The INTERVAL form (impl-plan-sdf-as-shape T2) — entry/exit of the slab intersection,
// the shape a marched arm consumes. Entry clamped to 0; sibling of box_intersect, which
// stays untouched.
bool box_interval(Ray ray, Box b, out float t0, out float t1) {
    vec3 inv = 1.0 / ray.direction;
    vec3 ta = (b.center - b.halfSize - ray.origin) * inv;
    vec3 tb = (b.center + b.halfSize - ray.origin) * inv;
    vec3 tsm = min(ta, tb), tbg = max(ta, tb);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z);
    if (tf < tn || tf <= EPSILON) return false;
    t0 = max(tn, 0.0);
    t1 = tf;
    return true;
}

// Marching (`box_sdf_intersect`) and the gradient normal (`box_sdf_normal`) are
// GENERATED from box_sdf when a program marches this shape — fable-sdf-contract §4.
