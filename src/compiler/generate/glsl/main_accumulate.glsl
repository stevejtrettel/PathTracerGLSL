// Main function with progressive accumulation
// Requires: u_pixelOffset, u_frameIndex, u_sampleCount, u_previous

void main() {
    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;
    // Seed with the GLOBAL pixel (tile offset included) — seeding with the local
    // gl_FragCoord replays the identical RNG stream in every tile of a tiled render.
    hash_init(uvec2(pixel), uint(u_frameIndex));

    vec2 xi = random2();
    Ray ray = camera_generateRay(pixel, xi);
    vec3 color = transport_trace(ray);

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
