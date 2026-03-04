// Running Average Accumulator
// Progressive accumulation via running average with ping-pong buffers
// Uniforms: u_accumulator_radiance_previous (sampler2D), u_accumulator_reset (bool)
// Depends on: u_sample_count (engine uniform)

uniform sampler2D u_accumulator_radiance_previous;
uniform bool u_accumulator_reset;

Radiance accumulator_accumulate(Spectrum new_sample, vec2 pixel) {
    if (u_sample_count == 0 || u_accumulator_reset) {
        return Radiance(new_sample);
    }

    ivec2 coord = ivec2(gl_FragCoord.xy);
    vec3 previous = texelFetch(u_accumulator_radiance_previous, coord, 0).rgb;

    float n = float(u_sample_count);
    float new_weight = 1.0 / (n + 1.0);

    return Radiance(mix(previous, new_sample, new_weight));
}
