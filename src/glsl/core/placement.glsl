// core/placement.glsl — the driven-placement contract (fable-transforms §6.1).
//
// A live (uniform-driven) placement arrives as TWO vec4s, host-precomposed in fp64:
//   q  = the INVERSE rotation quaternion (world→local)
//   ts = (t_rigid.xyz, s) where t_rigid = −Rᵀ·t and s is the FORWARD scale
//
// The contract is four operations, never a matrix. The load-bearing subtlety: queries
// run in the RIGID frame (rotation+translation only — an isometry of world space), and
// the similarity-closed primitive PARAMETERS absorb s in-shader (s·center, s·radius,
// s·halfSize, s·offset). Consequences, all exact:
//   - distances and ray-t are WORLD values (no rescaling, no reciprocal anywhere);
//   - every proximity guard inside the primitives stays world-correct under driven scale;
//   - SDF marching sees an exact world-distance field.
// Directions stay unit through placement_dir, so intersector assumptions hold; normals
// return via the free forward rotation (quaternion conjugation is a sign flip).
// Included only when the program has driven placements (exact linkage).

// Rotate v by unit quaternion q: v + 2·q.xyz × (q.xyz × v + q.w·v).
vec3 placement_qrot(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// World → the placement's RIGID frame (isometric to world; scale stays on params).
vec3 placement_rigid(vec4 q, vec4 ts, vec3 p) {
    return placement_qrot(q, p) + ts.xyz;
}

// World → rigid-frame direction. Pure rotation: unit in, unit out.
vec3 placement_dir(vec4 q, vec3 d) {
    return placement_qrot(q, d);
}

// Rigid-frame normal → world (the forward rotation; conjugation is free).
vec3 placement_normal(vec4 q, vec3 n) {
    return placement_qrot(vec4(-q.xyz, q.w), n);
}

// The forward scale s — multiplies similarity-closed primitive parameters in-shader.
float placement_scale(vec4 ts) {
    return ts.w;
}
