// interaction.glsl — the unified scattering-event contract (§3.1/§3.2).
// One InteractionSample serves surface BSDFs and (later) medium phase functions.
// Depends on: structs.glsl (Direction, Spectrum typedefs).

// Lobe / event flags. A flag earns its place only if transport branches on it.
const uint LOBE_REFLECTION   = 1u;   // wi on the same side of the surface as wo
const uint LOBE_TRANSMISSION = 2u;   // wi on the far side (drives medium update + offset sign)
const uint LOBE_DELTA        = 4u;   // pdf is a Dirac delta; the pdf field is 0
const uint LOBE_MEDIUM       = 8u;   // phase-function event, no surface (transport skips the cosine)
// dropped LOBE_NULL      -> compile-time is_null_interface(hit) predicate (arrives with media, §3.6)
// deferred LOBE_GLOSSY/DIFFUSE -> add when path regularization/guiding has a reader

struct InteractionSample {
    Direction wi;       // sampled next direction, world space
    Spectrum  weight;   // throughput factor: f·|cosθi|/pdf (surface); phase/pdf (medium)
    float     pdf;      // solid-angle pdf of the non-delta part; 0.0 for delta lobes
    uint      flags;
};
