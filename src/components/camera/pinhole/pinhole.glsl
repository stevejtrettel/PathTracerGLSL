// Pinhole camera
// Requires: u_tanFov (= tan(fov/2)), u_imageSize, u_cameraPosition, u_cameraForward/Right/Up

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    // film = continuous sub-pixel point (pixel/ owns the footprint); xiLens unused (no aperture).
    vec2 ndc = (2.0 * film / u_imageSize) - 1.0;
    ndc.x *= u_aspect;   // aspect precomputed on the CPU (u_aspect), not per-ray

    // Look-at frame precomputed on the CPU (components/camera/basis.ts) and shipped as
    // uniforms — no per-ray normalize/cross (the degenerate up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    vec3 dir = normalize(forward + ndc.x * u_tanFov * right + ndc.y * u_tanFov * up);

    return make_ray(u_cameraPosition, dir);   // tmin = EPSILON, tmax = MAX_DIST
}
