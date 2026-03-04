// Gamma Developer
// Simple gamma 2.2 correction for LDR display

#define GAMMA 2.2
#define INV_GAMMA (1.0 / 2.2)

RGB developer_develop(Radiance radiance) {
    vec3 clamped = clamp(radiance, 0.0, 1.0);
    vec3 gamma_corrected = pow(clamped, vec3(INV_GAMMA));
    return RGB(gamma_corrected);
}
