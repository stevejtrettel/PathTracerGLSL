// The TS twin of conductor_fresnel (glsl/core/math.glsl) for one wavelength lane: the exact
// unpolarized Fresnel reflectance of a conductor with complex relative index η + iκ at incidence
// cosine c ∈ [0, 1]. Line-for-line transcription (Mitsuba 3's fresnel_conductor); change one,
// change both. Read by the conductor tests and by the witness fixtures' expected values.

export function conductorFresnel(cosI: number, eta: number, k: number): number {
    const c2 = cosI * cosI;
    const s2 = 1 - c2;
    const s4 = s2 * s2;
    const t = eta * eta - k * k - s2;
    const A = Math.sqrt(t * t + 4 * eta * eta * k * k);
    const a = Math.sqrt(Math.max(0.5 * (A + t), 0));
    const term1 = A + c2;
    const term2 = 2 * cosI * a;
    const rS = (term1 - term2) / (term1 + term2);
    const term3 = A * c2 + s4;
    const term4 = term2 * s2;
    const rP = rS * (term3 - term4) / (term3 + term4);
    return 0.5 * (rS + rP);
}
