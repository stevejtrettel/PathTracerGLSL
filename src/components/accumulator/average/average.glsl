// Main function with progressive accumulation
// Requires: u_pixelOffset, u_sampleCount, u_resetSalt, u_previous

void main() {
    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;
    // Seed with the GLOBAL pixel (tile offset included) — seeding with the local
    // gl_FragCoord replays the identical RNG stream in every tile of a tiled render.
    // sampleCount decorrelates samples within a render; resetSalt (bumped per
    // accumulation reset) decorrelates across resets (§2.11).
    rng_init(uvec2(pixel), uint(u_sampleCount), uint(u_resetSalt));

    vec2 film = pixel_sample(pixel, random2());   // sub-pixel placement (pixel/ footprint)
    vec2 xiLens = random2();                       // lens-disk sample — cameras without aperture ignore it
    Ray ray = camera_generateRay(film, xiLens);
    vec3 color = sensor_response(film, ray.direction) * transport_trace(ray);   // We · L (measurement)

    if (u_sampleCount == 0) {
        fragColor = vec4(color, 1.0);
    } else {
        ivec2 coord = ivec2(gl_FragCoord.xy);
        vec3 previous = texelFetch(u_previous, coord, 0).rgb;
        float n = float(u_sampleCount);
        float new_weight = 1.0 / (n + 1.0);
        fragColor = vec4(mix(previous, color, new_weight), 1.0);
    }
}
