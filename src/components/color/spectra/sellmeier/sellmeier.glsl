// B is dimensionless; C is in micrometres². The carrier is in nm.
float sellmeier_index(vec3 B, vec3 C, float lambdaNM) {
    float lambda2 = (lambdaNM * 0.001) * (lambdaNM * 0.001);
    vec3 terms = B * lambda2 / (vec3(lambda2) - C);
    return sqrt(1.0 + terms.x + terms.y + terms.z);
}
