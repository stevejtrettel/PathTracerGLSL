// Box (axis-aligned, SDF backend only — rotation comes from placement wrappers;
// normals come from the marcher's gradient of the owner's field).
// Provides: struct Box, box_sdf().

struct Box {
    vec3 center;
    vec3 halfSize;   // field name = schema row name, verbatim (T4 pin)
};

float box_sdf(vec3 p, Box b) {
    vec3 d = abs(p - b.center) - b.halfSize;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
