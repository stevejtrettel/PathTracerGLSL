// Passthrough Developer
// No tonemapping -- passes linear radiance directly

RGB developer_develop(Radiance radiance) {
    return RGB(radiance);
}
