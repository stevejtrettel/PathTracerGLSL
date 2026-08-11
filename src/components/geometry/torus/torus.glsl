// Torus — the ring standing about the canonical Y axis (orientation is PLACEMENT,
// like box and cylinder). `ringRadius` runs from the centre to the middle of the tube,
// `tubeRadius` is the tube itself.
//
// MARCHED ONLY. A torus has a closed form — a quartic — but its roots need a numerically
// delicate solver, and its field is exact and cheap, so this is the shape that shows what
// the merge means: nothing here differs from sphere.glsl except which intersect line the
// generator emits. It is also the first shape whose march bound is a DIFFERENT primitive
// (a cylinder of radius R+r and half-height r — see torus.ts), which is the interesting
// half: the marched arm only ever runs inside that cylinder's ray interval.
// Provides (struct + march/normal GENERATED — A1, fable-sdf-contract §4): torus_sdf(), torus_uv().

// Exact signed distance: the distance in the (radial, axial) half-plane from the tube's
// circular cross-section — the standard revolution form, correct sign, never overestimating.
float torus_sdf(vec3 p, Torus t) {
    vec2 c = vec2(length(p.xz) - t.ringRadius, p.y);
    return length(c) - t.tubeRadius;
}

// Marching (`torus_sdf_intersect`) and the gradient normal (`torus_sdf_normal`) are
// GENERATED from torus_sdf when a program marches this shape — fable-sdf-contract §4.

// Surface parameterization — the torus's OWN two angles, which is the whole appeal of
// charting one: u runs around the ring, v around the tube. Both in [0,1).
vec2 torus_uv(vec3 p, Torus t) {
    float u = atan(p.z, p.x) / TWO_PI + 0.5;
    float v = atan(p.y, length(p.xz) - t.ringRadius) / TWO_PI + 0.5;
    return vec2(u, v);
}
