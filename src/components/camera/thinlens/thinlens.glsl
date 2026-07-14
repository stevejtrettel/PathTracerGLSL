// Thin-lens camera — pinhole geometry + a finite aperture for defocus (depth of field).
// Requires: TAN_FOV (define), u_imageSize, u_cameraPosition, u_cameraTarget,
//           u_aperture (lens radius), u_focusDistance.
// aperture → 0 collapses exactly to pinhole (the witness's correctness anchor).

// Concentric (Shirley) map [0,1)² → unit disk — equal-area, low distortion. Inlined:
// thin-lens is its only user today (promote to a shared helper when a second appears).
vec2 concentric_disk(vec2 u) {
    vec2 o = 2.0 * u - 1.0;                 // to [-1,1]²
    if (o.x == 0.0 && o.y == 0.0) return vec2(0.0);
    float r, theta;
    if (abs(o.x) > abs(o.y)) { r = o.x; theta = (PI / 4.0) * (o.y / o.x); }
    else                     { r = o.y; theta = PI / 2.0 - (PI / 4.0) * (o.x / o.y); }
    return r * vec2(cos(theta), sin(theta));
}

Ray camera_generateRay(vec2 pixel, vec2 xiPixel, vec2 xiLens) {
    vec2 jittered_pixel = pixel + (xiPixel - 0.5);
    vec2 ndc = (2.0 * jittered_pixel / u_imageSize) - 1.0;
    float aspect = u_imageSize.x / u_imageSize.y;
    ndc.x *= aspect;

    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);
    // Same degenerate up-reference guard as pinhole (looking ∥ ±Y → normalize(0) = NaN).
    vec3 up_ref = abs(forward.y) > 0.999999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(forward, up_ref));
    vec3 up = cross(right, forward);

    // The pinhole primary direction through the (jittered) pixel.
    vec3 dir = normalize(forward + ndc.x * TAN_FOV * right + ndc.y * TAN_FOV * up);

    // Everything on the focus plane (distance u_focusDistance along `forward`) images
    // sharply; the primary ray crosses it at t = focusDistance / dot(dir, forward).
    vec3 focus_point = u_cameraPosition + dir * (u_focusDistance / dot(dir, forward));

    // Jitter the ray origin over the lens disk, re-aim at the focus point. aperture = 0
    // gives lens = 0 → origin unchanged, dir → normalize(focus_point − position) = the
    // pinhole ray (exact limit).
    vec2 lens = concentric_disk(xiLens) * u_aperture;
    vec3 origin = u_cameraPosition + lens.x * right + lens.y * up;
    vec3 lens_dir = normalize(focus_point - origin);

    return make_ray(origin, lens_dir);
}
