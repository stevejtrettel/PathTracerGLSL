// Pinhole camera
// Requires: u_tanFov (= tan(fov/2)), u_imageSize, u_cameraPosition, u_cameraForward/Right/Up,
//           ambient_normalize

Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl) {
    // film = continuous sub-pixel point (pixel/ owns the footprint); xiLens unused (no aperture).
    vec2 ndc = (2.0 * film / u_imageSize) - 1.0;
    ndc.x *= u_aspect;   // aspect precomputed on the CPU (u_aspect), not per-ray

    // Look-at frame precomputed on the CPU (components/camera/basis.ts) and shipped as
    // uniforms: an orthonormal tangent frame at the camera point in the space's metric — no
    // per-ray normalize/cross (the degenerate up-reference guard lives there).
    Direction forward = u_cameraForward;
    Direction right = u_cameraRight;
    Direction up = u_cameraUp;

    Direction dir = ambient_normalize(forward + ndc.x * u_tanFov * right + ndc.y * u_tanFov * up, u_cameraPosition);

    return make_ray(u_cameraPosition, dir, wl);   // unbounded ahead; the far clip (MAX_DIST) is the query's concern
}
