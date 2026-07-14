// tonemap 'khronos' — the Khronos PBR Neutral Tone Mapper (Khronos 3D Formats WG, 2024).
// Purpose-built for material preview: preserves hue and saturation with no filmic contrast
// swing — the right default when judging material correctness rather than making pretty
// pictures. Output is display-referred LINEAR; the shared sRGB OETF encodes it
// (encodesToDisplay). Transcribed from the Khronos reference implementation.

vec3 khronos_curve(vec3 color) {
    const float startCompression = 0.8 - 0.04;
    const float desaturation = 0.15;

    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;

    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;

    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;

    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, newPeak * vec3(1.0), g);
}
