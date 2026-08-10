// Marching tolerances — the shared vocabulary every marched shape is written against
// (impl-plan-sdf-as-shape T1). Included only when some object is intersected by
// marching, and BEFORE the primitive files, which call march_epsilon() inside their
// own <type>_sdf_intersect. These are numeric knobs, not structural gates: the
// compiler never overrides them (making one compiler-ownable later = emit it and
// delete the line here).
//
// Lives in core/ beside EPSILON/EPS_INTERFACE because it is the same family of fact:
// EPS_INTERFACE's "10× MARCH_EPSILON" comment in math.glsl has always referred to this
// number, and the two must be read together.

#define MAX_MARCH_STEPS 512
#define MARCH_EPSILON 0.0001
#define NORMAL_EPSILON 0.001

// Acceptance threshold grows with travel distance (pixel-footprint scaling: a fixed 1e-4 at
// t = 40 resolves geometry far below one pixel and just burns steps) but stays CAPPED at half
// of EPS_INTERFACE, so the §4.2 classification probes always clear the accepted residual.
#define MARCH_EPSILON_MAX 0.0005
float march_epsilon(float t) { return min(MARCH_EPSILON_MAX, MARCH_EPSILON * (1.0 + t)); }
