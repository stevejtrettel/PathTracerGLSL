# T1 — kernel sampling: what it computes and why

One draw serving two estimator terms: `kernel_sample_continuation` draws the next
direction from the material kernel (`interaction_surface_sample`), and that single
ray is BOTH the recursion's next segment AND a sample of the direct-lighting term —
whatever emission it lands on is a direct-light estimate drawn with the kernel's
density.

**The deferred-scoring structure** (why this file has two kinds of sites):
the MIS weight for T1's direct estimate is a function of the path EDGE — it needs
`lighting_pdf` at the endpoint the ray FINDS, which doesn't exist at the vertex where
the ray is drawn. So sampling and scoring are one bounce apart:

- **Sampling sites** write the carried record via the generated
  `kernel_record(s, pdf, p, is_delta)` — ONE writer for both sites (the pinned
  single-emitter rule): `kernel_sample_continuation` (surface: records `bs.pdf`,
  `hit.p`, the `LOBE_DELTA` flag) and `kernel_sample_phase` (medium: `ps.pdf`,
  `p_evt`, delta = false; also advances `s.ray` via `make_ray` — no surface offset
  at a volume event).
- **Deferred scoring sites** settle the estimate with that record:
  `kernel_score_emitter_hit` (emission keyed on `region_to`, §6.2 — you receive
  emission from the region AHEAD, which differs from the owner at exits) and
  `kernel_score_miss` (the environment is the same term's boundary case). Both
  multiply the combiner's weight (`combiner_w_emitter` / `combiner_w_env`) — under
  plain `pt` those bodies are `return 1.0` and T1 owns the terms outright.

`kernel_sample_continuation` returns false on a black sample (`spectrum_is_black
(bs.weight)`) — the walk breaks; `throughput *= bs.weight` is the §2.1
sample-returns-weight contract (f·|cos|/pdf, pre-cancelled by the material).

Static-file rule: this file touches only `PathState`'s pinned core
(ray/throughput/radiance); the record fields exist only in some programs and are
reachable only through `kernel_record`'s generated body.
