// tonemap 'hable' — the Uncharted 2 filmic curve (John Hable, 2010). A classic filmic
// toe/shoulder operator; here at Hable's published constants (white point W = 11.2,
// exposure bias 2.0). Output is display-referred LINEAR; the shared sRGB OETF encodes it
// (encodesToDisplay).

vec3 hable_partial(vec3 x) {
    const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
    return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

vec3 hable_curve(vec3 x) {
    const float W = 11.2;
    vec3 current = hable_partial(x * 2.0);
    vec3 whiteScale = vec3(1.0) / hable_partial(vec3(W));
    return current * whiteScale;
}
