// Box (axis-aligned, SDF backend only — rotation comes from placement wrappers;
// normals come from the marcher's gradient of the owner's field).
// Provides (struct GENERATED from descriptor rows — A1): box_sdf().

float box_sdf(vec3 p, Box b) {
    vec3 d = abs(p - b.center) - b.halfSize;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
