// Pinhole Camera
// Generates rays from camera position through image plane with jittered sampling
// Uniforms: u_camera_position (vec3), u_camera_frame (mat3), u_camera_tan_fov (float)
// Depends on: u_image_size (engine uniform)

uniform vec3 u_camera_position;
uniform mat3 u_camera_frame;
uniform float u_camera_tan_fov;

Ray camera_generateRay(vec2 pixel, vec2 xi) {
    vec2 jittered_pixel = pixel + (xi - 0.5);
    vec2 ndc = (2.0 * jittered_pixel / u_image_size) - 1.0;

    float aspect = u_image_size.x / u_image_size.y;
    ndc.x *= aspect;

    vec3 camera_dir = vec3(
        ndc.x * u_camera_tan_fov,
        ndc.y * u_camera_tan_fov,
        -1.0
    );

    camera_dir = normalize(camera_dir);
    Direction world_dir = u_camera_frame * camera_dir;

    Ray ray;
    ray.origin = u_camera_position;
    ray.direction = world_dir;
    ray.tmin = 0.001;
    ray.tmax = 1000.0;

    return ray;
}
