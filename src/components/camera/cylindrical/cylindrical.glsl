// Cylindrical panorama camera — the wide "stitched panorama" projection. Wrap a cylinder
// around the camera (axis = up): the horizontal image coordinate is the AZIMUTH (linear, so
// vertical lines stay straight), the vertical is the cylinder HEIGHT (linear in
// h = tan(elevation), the panorama's vertical stretch).
//
// SQUARE PIXELS: both axes share ONE focal length (the cylinder radius in pixels, set by the
// horizontal sweep), so the image is perspectivally correct at ANY window size. The window
// aspect decides how much VERTICAL is visible, it does NOT stretch. Ignores xiLens.
// Requires: u_imageSize, u_cameraPosition, u_cameraForward/Right/Up,
//           u_cylFocal (cylinder radius in pixels = imageSize.x / radians(hfov), CPU-precomputed).

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    float f = u_cylFocal;                // cylinder radius in pixels (CPU-precomputed from the width)
    vec2 c = film - 0.5 * u_imageSize;   // centered pixel coords

    float phi = c.x / f;   // azimuth = arc length (c.x px at radius f px)
    float h   = c.y / f;   // cylinder height, SAME f → square pixels; elevation = atan(h)

    // Look-at frame precomputed on the CPU (components/camera/basis.ts), shipped as
    // uniforms — no per-ray normalize/cross (the up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    // Horizontal part rides the unit cylinder; h·up climbs it.
    vec3 dir = cos(phi) * forward + sin(phi) * right + h * up;
    return make_ray(u_cameraPosition, normalize(dir));
}
