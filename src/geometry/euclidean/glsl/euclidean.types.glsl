/* geometry.types — Euclidean v0 (foundational types) */
#define Point vec3
#define Dir   vec3

struct Tangent { Point p; Dir v; };   // vector at basepoint
struct Ray     { Point o; Dir d; };   // geodesic seed (same layout for now)

struct Frame   { Point p; Dir f; Dir u; Dir r; }; // position, forward, up, right
