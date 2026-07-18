// Fisheye camera — radial projection. Every fisheye maps the image radially about the
// optical axis: the polar angle off the axis, theta, is a function of the image radius rho.
// The four radial maps below share everything else (frame, azimuth, direction assembly) —
// the compiler aliases FISHEYE_THETA to the one `projection` selects (a value #define, like
// TAN_FOV; the r(θ) forms + what each preserves are in fisheye.md). Ignores xiLens.
// Requires: u_imageSize, u_cameraPosition, u_cameraForward/Right/Up, u_fisheyeFov (full angular field),
//           FISHEYE_THETA (aliased by the compiler to one of the four below).

// theta(rho, tmax), normalized so rho = 1 ↔ theta = tmax. The sin-based maps clamp their
// asin argument so corners (rho > 1) pin at the rim instead of NaN-ing.
float fisheye_theta_equidistant(float rho, float tmax)   { return rho * tmax; }                                // r = f·θ        angle-linear
float fisheye_theta_equisolid(float rho, float tmax)     { return 2.0 * asin(clamp(rho * sin(tmax * 0.5), 0.0, 1.0)); }  // r = 2f·sin(θ/2) solid-angle-true
float fisheye_theta_stereographic(float rho, float tmax) { return 2.0 * atan(rho * tan(tmax * 0.5)); }          // r = 2f·tan(θ/2) conformal
float fisheye_theta_orthographic(float rho, float tmax)  { return asin(clamp(rho * sin(tmax), 0.0, 1.0)); }     // r = f·sin θ     hemisphere flat

Ray camera_generateRay(vec2 film, vec2 xiLens) {
    // Aspect-corrected centered coords: |c| = 1 at the top/bottom edge (the inscribed
    // circle rim, where theta = theta_max). Corners (|c| > 1) extend past it.
    vec2 c = (2.0 * film / u_imageSize) - 1.0;
    c.x *= u_imageSize.x / u_imageSize.y;

    float rho = length(c);
    float tmax = u_fisheyeFov * 0.5;   // theta_max = half the full angular field

    // Look-at frame precomputed on the CPU (components/camera/basis.ts), shipped as
    // uniforms — no per-ray normalize/cross (the up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    if (rho < 1e-6) return make_ray(u_cameraPosition, forward);   // center pixel: on axis

    float theta = FISHEYE_THETA(rho, tmax);   // radial map (aliased per projection)
    vec2 t = c / rho;                          // unit azimuth direction in the image plane
    vec3 dir = cos(theta) * forward + sin(theta) * (t.x * right + t.y * up);
    return make_ray(u_cameraPosition, normalize(dir));
}
