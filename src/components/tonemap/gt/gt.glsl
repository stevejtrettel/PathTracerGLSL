// tonemap 'gt' — the Gran Turismo curve (Hajime Uchimura, 2017, "HDR theory and the
// float"). A parameterized filmic operator with an explicit linear midsection between a
// power toe and an exponential shoulder; here at Uchimura's default constants. Output is
// display-referred LINEAR; the shared sRGB OETF encodes it (encodesToDisplay).

float gt_channel(float x) {
    const float P = 1.0;   // maximum display brightness
    const float a = 1.0;   // contrast
    const float m = 0.22;  // linear section start
    const float l = 0.4;   // linear section length
    const float c = 1.33;  // black tightness
    const float b = 0.0;   // pedestal

    float l0 = (P - m) * l / a;
    float S0 = m + l0;
    float S1 = m + a * l0;
    float C2 = a * P / (P - S1);
    float CP = -C2 / P;

    float w0 = 1.0 - smoothstep(0.0, m, x);
    float w2 = step(m + l0, x);
    float w1 = 1.0 - w0 - w2;

    float T = m * pow(x / m, c) + b;                 // toe
    float L = m + a * (x - m);                       // linear midsection
    float S = P - (P - S1) * exp(CP * (x - S0));     // shoulder
    return T * w0 + L * w1 + S * w2;
}

vec3 gt_curve(vec3 x) {
    return vec3(gt_channel(x.r), gt_channel(x.g), gt_channel(x.b));
}
