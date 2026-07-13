// Sampling-technique registry (fable-components §7, the technique-centric carve — the
// axis this family optimizes: A NEW TECHNIQUE IS ONE FILE + ONE LINE HERE).
//
// A technique declares four facts: where it samples (surface/medium events), how it
// scores (locally, or deferred with carried state), its pdf (so the combiner can weight
// it against rivals), and the seams its emitted code calls. THE GUARDRAIL applies:
// technique files declare facts about ONE technique — composition and ordering live in
// the integrator (integrators/pt.ts), weights in the combiner (../combiner.ts).
//
// Known next occupant: equiangular medium NEE — a light-sampling placement variant
// (impl-plan-media deferred table); it lands as one file beside light.ts.

export * as kernel from './kernel.js';
export * as light from './light.js';
