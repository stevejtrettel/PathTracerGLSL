// Equirectangular camera — the full sphere (360°×180°) mapped to the image. No aperture
// (ignores xiLens), no fov (the whole sphere is the frame). Sub-pixel jitter preserved.
// Requires: u_imageSize, u_cameraPosition, u_cameraForward/Right/Up. (No TAN_FOV.)
//
// The image is naturally 2:1 (azimuth spans 2π, elevation spans π); other aspect ratios
// stretch, they don't crop. Center pixel looks along `forward`; +x wraps toward `right`
// with the seam behind, +y tilts toward `up` (top of image = straight up).

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    // film = continuous sub-pixel point (pixel/ owns the footprint); xiLens unused.
    vec2 uv = film / u_imageSize;   // [0,1]²

    float phi   = (uv.x - 0.5) * TWO_PI;      // azimuth   [-π, π],   0 = forward
    float theta = (uv.y - 0.5) * PI;          // elevation [-π/2, π/2], 0 = horizon

    // Look-at frame precomputed on the CPU (components/camera/basis.ts), shipped as
    // uniforms — no per-ray normalize/cross (the up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    // Spherical direction in the look-at frame. f,r,up are orthonormal so this is unit
    // (|ct·(cosφ f + sinφ r) + sinθ up| = √(cos²θ + sin²θ) = 1); normalize guards fp drift.
    float ct = cos(theta);
    vec3 dir = ct * (cos(phi) * forward + sin(phi) * right) + sin(theta) * up;

    return make_ray(u_cameraPosition, normalize(dir));
}
