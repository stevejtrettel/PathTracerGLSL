// T1's medium sampling site (included when scattering media exist).
// Provides: kernel_sample_phase().
// Depends on: PathState core, kernel_record (generated), scene_medium_properties,
//             make_ray, interaction_medium_sample (generated dispatch over the
//             registered phase models).

void kernel_sample_phase(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase sample (§3.5): both current occupants (hg, rayleigh) sample their density
    // exactly, so weight is SPECTRUM_ONE; an inexact phase sampler would carry its
    // ratio in ps.weight and this line already honors it.
    InteractionSample ps = interaction_medium_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());
    s.throughput *= ps.weight;
    kernel_record(s, ps.pdf, light_query_medium(p_evt), false);
    s.ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset
}
