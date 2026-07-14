// Cylindrical panorama camera — the wide "stitched panorama" projection. Wrap a cylinder
// around the camera (axis = up): the horizontal image coordinate is the AZIMUTH (linear, so
// vertical lines stay straight), the vertical is the cylinder HEIGHT (linear in
// h = tan(elevation), the panorama's vertical stretch).
//
// SQUARE PIXELS: both axes share ONE focal length (the cylinder radius in pixels, set by the
// horizontal sweep), so the image is perspectivally correct at ANY window size. The window
// aspect decides how much VERTICAL is visible, it does NOT stretch. Ignores xiLens.
// Requires: u_imageSize, u_cameraPosition, u_cameraTarget, u_cylHfov (DEGREES).

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    float f = u_imageSize.x / radians(u_cylHfov);   // cylinder radius in pixels (from the width)
    vec2 c = film - 0.5 * u_imageSize;               // centered pixel coords

    float phi = c.x / f;   // azimuth = arc length (c.x px at radius f px)
    float h   = c.y / f;   // cylinder height, SAME f → square pixels; elevation = atan(h)

    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);
    // Same degenerate up-reference guard as pinhole (forward ∥ ±Y → normalize(0) = NaN).
    vec3 up_ref = abs(forward.y) > 0.999999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(forward, up_ref));
    vec3 up = cross(right, forward);

    // Horizontal part rides the unit cylinder; h·up climbs it.
    vec3 dir = cos(phi) * forward + sin(phi) * right + h * up;
    return make_ray(u_cameraPosition, normalize(dir));
}
