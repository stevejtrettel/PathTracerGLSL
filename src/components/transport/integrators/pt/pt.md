# pt — the recursive walk: what it computes and why

The path-tracing integrator: recursively estimate the transport equation by following
one path per sample, invoking the techniques at each event. This is a TS *generator*
(`pt.ts`) — it emits the walk specialized to the program (the emitted shape is
fable-transport-glsl-target.md; dump any pair to read it).

What the walk owns (and techniques don't):

- **State**: the generated `PathState` (§3.4-style union — fields exist only when the
  program's parts declare them) + `path_state_init`.
- **Path advance**: `scene_intersect` per bounce; in media programs the segment runs
  the volumetric call site first — `medium_sample` decides scatter-vs-boundary, with
  the per-segment equiangular site (when selected) BEFORE it at segment-start
  throughput.
- **Region discipline**: §4.4 self-heal (`hit.region_from != current_medium` repairs
  one mistracked segment), null-interface crossings (`is_null_interface` — pass
  through, `bounce--`, own safety counter), transmission tracking
  (`current_medium = hit.region_to`, `eta_scale` accumulation).
- **Termination**: the bounce budget (`measurement.maxBounces` — a declared
  truncation) and the generated `roulette` — §7.2 pinned: once per iteration, AFTER
  `throughput *= weight`, survival keyed on post-weight throughput (η²-corrected when
  transmission exists), ONE function for both call sites.
- **Spawning**: `ray_spawn(hit, bs.wi)` — escape to wi's side along the geodesic.

The event order at a surface is the estimator's anatomy in four lines:
settle T1's deferred estimate (`kernel_score_emitter_hit`) → run T2 locally
(`light_sample_direct`) → draw T1's next sample (`kernel_sample_continuation`) →
terminate/spawn. Medium events mirror it without the cosine and without a surface
offset.

New integrators (one-shot, Whitted, debug probes) are new walks HERE composing the
same technique functions — the techniques and combiner don't change.
