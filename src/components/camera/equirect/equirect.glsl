// Equirectangular camera — the full sphere (360°×180°) mapped to the image. No aperture
// (ignores xiLens), no fov (the whole sphere is the frame). Sub-pixel jitter preserved.
// Requires: u_imageSize, u_cameraPosition, u_cameraTarget. (No TAN_FOV.)
//
// The image is naturally 2:1 (azimuth spans 2π, elevation spans π); other aspect ratios
// stretch, they don't crop. Center pixel looks along `forward`; +x wraps toward `right`
// with the seam behind, +y tilts toward `up` (top of image = straight up).

Ray camera_generateRay(vec2 pixel, vec2 xiPixel, vec2 xiLens) {
    vec2 jittered_pixel = pixel + (xiPixel - 0.5);
    vec2 uv = jittered_pixel / u_imageSize;   // [0,1]²

    float phi   = (uv.x - 0.5) * TWO_PI;      // azimuth   [-π, π],   0 = forward
    float theta = (uv.y - 0.5) * PI;          // elevation [-π/2, π/2], 0 = horizon

    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);
    // Same degenerate up-reference guard as pinhole (forward ∥ ±Y → normalize(0) = NaN).
    vec3 up_ref = abs(forward.y) > 0.999999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(forward, up_ref));
    vec3 up = cross(right, forward);

    // Spherical direction in the look-at frame. f,r,up are orthonormal so this is unit
    // (|ct·(cosφ f + sinφ r) + sinθ up| = √(cos²θ + sin²θ) = 1); normalize guards fp drift.
    float ct = cos(theta);
    vec3 dir = ct * (cos(phi) * forward + sin(phi) * right) + sin(theta) * up;

    return make_ray(u_cameraPosition, normalize(dir));
}
