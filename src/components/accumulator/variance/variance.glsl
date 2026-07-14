// Main function: progressive mean + per-channel running sample variance (Welford).
// Attachment 0 (fragColor) = the running mean — the IDENTICAL update to
// accumulate_average; the mean is untouched by instrumentation.
// Attachment 1 (fragMoment) = population variance of the SAMPLES, v = M2/n.
// Variance of the accumulated MEAN ≈ v/n — readers divide (they know n).
// Requires: u_pixelOffset, u_sampleCount, u_resetSalt, u_previous, u_previousMoment

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
        fragMoment = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        ivec2 coord = ivec2(gl_FragCoord.xy);
        vec3 previous = texelFetch(u_previous, coord, 0).rgb;
        vec3 prev_var = texelFetch(u_previousMoment, coord, 0).rgb;
        float n = float(u_sampleCount);
        float new_weight = 1.0 / (n + 1.0);
        // Welford in normalized form: with v = M2/n, both updates are the same
        // running-average shape — mean' = mix(mean, x, 1/n') and
        // v' = mix(v, delta·delta', 1/n') where delta = x − mean, delta' = x − mean'.
        // The delta·delta' cross product is the cancellation-free form; the naive
        // E[x²] − mean² collapses in fp32 exactly on nearly-converged pixels.
        vec3 mean_new = mix(previous, color, new_weight);
        vec3 delta = color - previous;
        vec3 delta_new = color - mean_new;
        fragColor = vec4(mean_new, 1.0);
        fragMoment = vec4(mix(prev_var, delta * delta_new, new_weight), 1.0);
    }
}
