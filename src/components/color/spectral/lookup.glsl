// Row zero stores linearly interpolated CIE XYZ and luminance-normalized D65.
vec4 spectral_curves(float lambda) {
    float x = (lambda - 360.0) / 5.0;
    int i = min(int(x), 93);
    return mix(texelFetch(u_spectralCurves, ivec2(i, 0), 0),
               texelFetch(u_spectralCurves, ivec2(i + 1, 0), 0), x - float(i));
}

vec3 spectral_node(int channel, int x, int y, int z) {
    int index = ((channel * 64 + z) * 64 + y) * 64 + x;
    return texelFetch(u_spectralCoefficients, ivec2(index % 2048, index / 2048), 0).xyz;
}

// Largest-channel ties choose the first channel, identically on CPU and GPU.
vec3 spectral_coefficients(vec3 rgb) {
    int channel = rgb.x >= rgb.y && rgb.x >= rgb.z ? 0 : (rgb.y >= rgb.z ? 1 : 2);
    float z = rgb[channel];
    vec2 xy = vec2(rgb[(channel + 1) % 3], rgb[(channel + 2) % 3]) * (63.0 / z);
    ivec2 cell = min(ivec2(xy), ivec2(62));
    vec2 f = xy - vec2(cell);
    int lo = 0, hi = 63;
    for (int step = 0; step < 6; ++step) {
        int mid = (lo + hi) / 2;
        if (texelFetch(u_spectralCurves, ivec2(mid, 1), 0).x <= z) lo = mid;
        else hi = mid;
    }
    float z0 = texelFetch(u_spectralCurves, ivec2(lo, 1), 0).x;
    float z1 = texelFetch(u_spectralCurves, ivec2(lo + 1, 1), 0).x;
    float fz = (z - z0) / (z1 - z0);
    vec3 a = mix(mix(spectral_node(channel, cell.x, cell.y, lo), spectral_node(channel, cell.x + 1, cell.y, lo), f.x),
                 mix(spectral_node(channel, cell.x, cell.y + 1, lo), spectral_node(channel, cell.x + 1, cell.y + 1, lo), f.x), f.y);
    vec3 b = mix(mix(spectral_node(channel, cell.x, cell.y, lo + 1), spectral_node(channel, cell.x + 1, cell.y, lo + 1), f.x),
                 mix(spectral_node(channel, cell.x, cell.y + 1, lo + 1), spectral_node(channel, cell.x + 1, cell.y + 1, lo + 1), f.x), f.y);
    return mix(a, b, fz);
}

Spectrum spectral_bounded(vec3 rgb, Wavelengths wl) {
    // Exact grey includes black and white, without infinite inverse-sigmoid coefficients.
    if (rgb.x == rgb.y && rgb.y == rgb.z) return Spectrum(rgb.x);
    vec3 c = spectral_coefficients(rgb);
    vec4 t = (wl.lambda - 360.0) / 470.0;
    vec4 p = (c.x * t + c.y) * t + c.z;
    // Enforce the sigmoid's mathematical range after floating-point evaluation.
    return clamp(0.5 + 0.5 * p / sqrt(1.0 + p * p), 0.0, 1.0);
}

Spectrum color_lift_reflectance(vec3 rgb, Wavelengths wl) {
    return spectral_bounded(rgb, wl);
}
Spectrum color_lift_coefficient(vec3 rgb, Wavelengths wl) {
    float scale = 2.0 * max(rgb.x, max(rgb.y, rgb.z));
    if (scale == 0.0) return SPECTRUM_ZERO;
    return scale * spectral_bounded(rgb / scale, wl);
}
Spectrum color_lift_emission(vec3 rgb, Wavelengths wl) {
    vec4 d65;
    for (int i = 0; i < 4; ++i) d65[i] = spectral_curves(wl.lambda[i]).w;
    return color_lift_coefficient(rgb, wl) * d65;
}
