// Plane in H²×R — a totally geodesic surface, which in H²×R is either a horizontal plane H²×{c} or
// a vertical plane γ×R (γ an H² geodesic); there is no tilted one, so the normal row is vertical or
// horizontal (the Validator's h2xr row constraint). In the object's frame, as in E³'s
// dot(p, normal) + offset = 0:
//   - vertical normal (0, ±1, 0): the plane y·normal.y + offset = 0, signed distance
//     y·normal.y + offset;
//   - horizontal normal: the vertical plane ⟨x_H, N⟩_H = 0 with N = (cosh(offset)·normal.x, 0,
//     cosh(offset)·normal.z, −sinh(offset)) (H³'s plane in the H² factor), signed distance
//     asinh(⟨p, N⟩_H), positive on the side `normal` points to.
// Derivations: components/ambient/h2xr/h2xr.md.
// Provides (struct GENERATED from descriptor rows): plane_sdf(), plane_intersect(), plane_normal().
// Depends on: h2xr_form(), h2xr_vertical_plane_root() (the H²×R occupant).

Direction plane_N(Plane pl) {
    return Direction(cosh(pl.offset) * pl.normal.x, 0.0, cosh(pl.offset) * pl.normal.z, -sinh(pl.offset));
}

// Exact signed distance (asinh of |x| with the sign restored: GLSL's asinh loses precision for
// large negative arguments).
float plane_sdf(Point p, Plane pl) {
    if (pl.normal.y != 0.0) return p.y * pl.normal.y + pl.offset;
    float s = h2xr_form(p, plane_N(pl));
    return sign(s) * asinh(abs(s));
}

// A horizontal plane: the height is linear along every geodesic, t = −(y·n.y + offset)/(v.y·n.y)
// (a ray with v.y = 0 never meets it). A vertical plane: the occupant's root.
bool plane_intersect(Ray ray, Plane pl, out float t) {
    if (pl.normal.y != 0.0) {
        float rate = ray.direction.y * pl.normal.y;
        if (rate == 0.0) return false;
        t = -(ray.origin.y * pl.normal.y + pl.offset) / rate;
        return t > 0.0;
    }
    return h2xr_vertical_plane_root(ray, plane_N(pl), t);
}

// Outward unit normal: the normal row (a horizontal plane), or N (tangent on the vertical plane).
Direction plane_normal(Point p, Plane pl) {
    return pl.normal.y != 0.0 ? pl.normal : plane_N(pl);
}
