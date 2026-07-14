// tonemap 'aces' — Narkowicz fitted approximation of the ACES RRT+ODT filmic curve
// (Krzysztof Narkowicz 2016, "ACES Filmic Tone Mapping Curve"). A cheap one-function fit,
// the filmic workhorse. Output is display-referred LINEAR — the shared sRGB OETF encodes
// it (encodesToDisplay). KNOWN CAVEAT: skews saturated hues toward the fit's primaries;
// 'agx' and 'khronos' are the hue-faithful alternatives.

vec3 aces_curve(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
