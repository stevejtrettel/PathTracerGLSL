// Provides: vec3 display(vec3 hdr)
// Purpose: Map HDR linear radiance to displayable sRGB (0..1)

// Simple Reinhard tone map in linear space
vec3 tonemapReinhard(vec3 x) {
    return x / (x + vec3(1.0));
}

// Linear → sRGB (IEC 61966-2-1 OETF)
vec3 linear_to_srgb(vec3 c) {
    vec3 a = 12.92 * c;
    vec3 b = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(a, b, step(vec3(0.0031308), c));
}

vec3 display(vec3 hdr) {
    vec3 ldr = tonemapReinhard(hdr);
    ldr = clamp(ldr, 0.0, 1.0);
    return linear_to_srgb(ldr);
}
