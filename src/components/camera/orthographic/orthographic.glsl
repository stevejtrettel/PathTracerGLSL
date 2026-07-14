// Orthographic camera — parallel projection. Every ray shares the direction `forward`; the
// ORIGIN slides over the film plane, sized by u_orthoScale (the world-space half-height of
// the view). No fov, no aperture (ignores xiLens).
// Requires: u_imageSize, u_cameraPosition, u_cameraTarget, u_orthoScale.

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    vec2 ndc = (2.0 * film / u_imageSize) - 1.0;
    float aspect = u_imageSize.x / u_imageSize.y;
    ndc.x *= aspect;

    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);
    // Same degenerate up-reference guard as pinhole (forward ∥ ±Y → normalize(0) = NaN).
    vec3 up_ref = abs(forward.y) > 0.999999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(forward, up_ref));
    vec3 up = cross(right, forward);

    // Parallel rays: the origin spans the film plane (half-height u_orthoScale, half-width
    // aspect·u_orthoScale), the direction is constant. No perspective foreshortening.
    vec3 origin = u_cameraPosition + ndc.x * u_orthoScale * right + ndc.y * u_orthoScale * up;
    return make_ray(origin, forward);
}
