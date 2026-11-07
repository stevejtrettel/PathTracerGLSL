// Thin-lens camera — pinhole geometry + a finite aperture for defocus (depth of field).
// Requires: u_tanFov (= tan(fov/2)), u_imageSize, u_cameraPosition, u_cameraForward/Right/Up,
//           u_aperture (lens radius), u_focusDistance, concentric_disk (core math).
// aperture → 0 collapses exactly to pinhole (the witness's correctness anchor).
// LENS_BLADES / LENS_BLADE_ROTATION (defined only for a bladed lens): the pupil is the
// regular LENS_BLADES-gon of circumradius u_aperture instead of the disk.

#ifdef LENS_BLADES
// A uniform point in the regular n-gon of circumradius 1 whose vertices lie at angles
// rotation + 2πk/n, measured from camera right toward camera up. ξ.x picks one of the n
// equal-area triangles (center, vertex k−1, vertex k) and is reused inside it; the
// barycentrics (1 − √ξ, √ξ·ξ.y) on its two outer vertices are uniform over the triangle.
// Cycles' regular_polygon_sample, whose rotation puts vertices at rot ± π/n, with
// rot = rotation − π/n. Density 1/Area over the polygon.
vec2 aperture_polygon(vec2 xi, float n, float rotation) {
    float sector = floor(xi.x * n);
    float s = sqrt(xi.x * n - sector);
    float a = 1.0 - s;
    float b = s * xi.y;
    float half_angle = PI / n;
    // The triangle with vertices (cos h, ±sin h), h = π/n, rotated into sector `sector`.
    vec2 p = vec2((a + b) * cos(half_angle), (a - b) * sin(half_angle));
    float angle = rotation + (2.0 * sector - 1.0) * half_angle;
    float c = cos(angle);
    float sn = sin(angle);
    return vec2(c * p.x - sn * p.y, sn * p.x + c * p.y);
}
#endif

Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl) {
    // film = continuous sub-pixel point (pixel/ owns the footprint).
    vec2 ndc = (2.0 * film / u_imageSize) - 1.0;
    ndc.x *= u_aspect;   // aspect precomputed on the CPU (u_aspect), not per-ray

    // Look-at frame precomputed on the CPU (components/camera/basis.ts), shipped as
    // uniforms — no per-ray normalize/cross (the up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    // The pinhole primary direction through the (jittered) pixel.
    vec3 dir = normalize(forward + ndc.x * u_tanFov * right + ndc.y * u_tanFov * up);

    // Everything on the focus plane (distance u_focusDistance along `forward`) images
    // sharply; the primary ray crosses it at t = focusDistance / dot(dir, forward).
    vec3 focus_point = u_cameraPosition + dir * (u_focusDistance / dot(dir, forward));

    // Jitter the ray origin over the pupil (disk or n-gon), re-aim at the focus point. aperture = 0
    // gives lens = 0 → origin unchanged, dir → normalize(focus_point − position) = the
    // pinhole ray (exact limit).
#ifdef LENS_BLADES
    vec2 lens = aperture_polygon(xiLens, LENS_BLADES, LENS_BLADE_ROTATION) * u_aperture;
#else
    vec2 lens = concentric_disk(xiLens) * u_aperture;
#endif
    vec3 origin = u_cameraPosition + lens.x * right + lens.y * up;
    vec3 lens_dir = normalize(focus_point - origin);

    return make_ray(origin, lens_dir, wl);
}
