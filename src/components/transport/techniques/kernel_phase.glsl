// T1's medium sampling site (included when scattering media exist).
// Provides: kernel_sample_phase().
// Depends on: PathState core, kernel_record (generated), hg_sample,
//             scene_medium_properties, make_ray.

void kernel_sample_phase(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase sample (§3.5): weight is SPECTRUM_ONE exactly — HG sampling is exact.
    InteractionSample ps = hg_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());
    s.throughput *= ps.weight;
    kernel_record(s, ps.pdf, p_evt, false);
    s.ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset
}
