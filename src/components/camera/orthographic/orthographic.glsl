// Orthographic camera — parallel projection. Every ray shares the direction `forward`; the
// ORIGIN slides over the film plane, sized by u_orthoScale (the world-space half-height of
// the view). No fov, no aperture (ignores xiLens).
// Requires: u_imageSize, u_cameraPosition, u_cameraForward/Right/Up, u_orthoScale.

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    vec2 ndc = (2.0 * film / u_imageSize) - 1.0;
    ndc.x *= u_aspect;   // aspect precomputed on the CPU (u_aspect), not per-ray

    // Look-at frame precomputed on the CPU (components/camera/basis.ts), shipped as
    // uniforms — no per-ray normalize/cross (the up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    // Parallel rays: the origin spans the film plane (half-height u_orthoScale, half-width
    // aspect·u_orthoScale), the direction is constant. No perspective foreshortening.
    vec3 origin = u_cameraPosition + ndc.x * u_orthoScale * right + ndc.y * u_orthoScale * up;
    return make_ray(origin, forward);
}
