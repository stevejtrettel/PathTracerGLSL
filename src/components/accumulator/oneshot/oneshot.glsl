// Main function — NON-accumulating. Each frame renders the current sample fresh and writes
// it directly; no blend with history, so the image live-updates (noisy) instead of
// converging. The single-frame / interactive-preview occupant. (Distinct from the reserved
// `exponential` occupant, which is a decaying blend of past frames.)
//
// Reuses the standard accumulation pipeline (ping-pong buffers; display reads the swapped
// buffer), so it needs no pipeline changes — it simply never reads u_previous. u_sampleCount
// still increments per frame, so the RNG stream decorrelates and the grain animates.
// Requires: u_pixelOffset, u_sampleCount, u_resetSalt.

void main() {
    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;
    // Seed with the GLOBAL pixel (tile offset included); sampleCount decorrelates frames,
    // resetSalt decorrelates across accumulation resets (§2.11). Same seed contract as the
    // accumulating occupants — only the write differs.
    rng_init(uvec2(pixel), uint(u_sampleCount), uint(u_resetSalt));

    vec2 film = pixel_sample(pixel, random2());   // sub-pixel placement (pixel/ footprint)
    vec2 xiLens = random2();                        // lens-disk sample — cameras without aperture ignore it
    Ray ray = camera_generateRay(film, xiLens);

    fragColor = vec4(sensor_response(film, ray.direction) * transport_trace(ray), 1.0);   // We · L, current frame only
}
