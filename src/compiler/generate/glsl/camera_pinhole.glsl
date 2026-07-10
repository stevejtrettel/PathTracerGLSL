// Pinhole camera
// Requires: TAN_FOV (define), u_imageSize, u_cameraPosition, u_cameraTarget

Ray camera_generateRay(vec2 pixel, vec2 xi) {
    vec2 jittered_pixel = pixel + (xi - 0.5);
    vec2 ndc = (2.0 * jittered_pixel / u_imageSize) - 1.0;
    float aspect = u_imageSize.x / u_imageSize.y;
    ndc.x *= aspect;

    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);

    vec3 dir = normalize(forward + ndc.x * TAN_FOV * right + ndc.y * TAN_FOV * up);

    return make_ray(u_cameraPosition, dir);   // tmin = EPSILON, tmax = MAX_DIST
}
