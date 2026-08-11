// Bottle — a rounded-cylinder body and neck, smooth-unioned, hollowed to a glass shell
// and chopped open at the lip, with a punt dimple pushed up into the base.
//
// The point of having it here: it is the first occupant that is a CONSTRUCTION rather
// than a formula — five operators over two primitives — and it costs the compiler
// exactly what a sphere costs. Everything it needs is in this file, prefixed and
// file-private, exactly like the vendored knob's helpers: a shape's internal maths is
// its own business. (Composing shapes at the SCENE level is a different question, and
// a deliberately open one — nothing here anticipates it.)
//
// Fill it with a dielectric and the interior-marching path (|d| stepping, region
// classification) is what renders the glass.
//
// The local frame: origin at the CENTRE of the body cylinder, +Y up the neck. So the
// body spans y ∈ [−baseHeight, +baseHeight] and the neck sits on top of it — see
// bottle.ts, whose bound is derived from exactly these extents.
// Provides (struct + march/normal GENERATED — A1, fable-sdf-contract §4): bottle_sdf().

// ---- the operators this shape is built from (file-private) ------------------
// All three are 1-Lipschitz in 1-Lipschitz operands, which is what keeps the composed
// field safe to march: a 1-Lipschitz function vanishing on the surface can never
// OVERESTIMATE the distance to it (moving to the nearest zero changes the value by at
// most the distance travelled). For the quadratic smooth union that holds because its
// gradient is a convex combination of its operands' — ∂/∂a = 1−u, ∂/∂b = u with
// u = ½(k−|a−b|)/k ∈ [0, ½].
//
// Blends do move the SURFACE: a smooth union is up to k/4 LARGER than the hard one, a
// smooth intersection up to k/4 smaller. bottle.ts pays that k/4 in the bound.

float bottle_smooth_union(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0);
    return min(a, b) - 0.25 * h * h / k;
}

float bottle_smooth_intersect(float a, float b, float k) {
    return -bottle_smooth_union(-a, -b, k);
}

// Rounded capped cylinder about the canonical Y axis. The fillet is inset from BOTH the
// radius and the half-height, so the extents are exactly (radius, halfHeight) whatever
// `rounded` is — the other convention (inset radially, added axially) would make every
// derived bound rounded-dependent in one axis only. Requires rounded ≤ min(radius,
// halfHeight), which bottle.ts checks.
float bottle_cylinder(vec3 p, float radius, float halfHeight, float rounded) {
    vec2 q = vec2(length(p.xz), p.y);
    vec2 w = abs(q) - vec2(radius - rounded, halfHeight - rounded);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - rounded;
}

// ---- the shape --------------------------------------------------------------

// The SOLID profile, before hollowing — the shared source for the shell and (later, if
// a liquid region wants it) the cavity, so the two can never drift.
float bottle_solid(vec3 q, Bottle b) {
    float body = bottle_cylinder(q, b.baseRadius, b.baseHeight, b.rounded);
    vec3 qn = q - vec3(0.0, b.baseHeight + b.neckHeight, 0.0);
    float neck = bottle_cylinder(qn, b.neckRadius, b.neckHeight, b.rounded);
    float solid = bottle_smooth_union(body, neck, b.smoothJoin);
    if (b.punt > 0.0) {
        // The dimple: a sphere pushed up into the underside of the body.
        float dimple = length(q + vec3(0.0, b.baseHeight, 0.0)) - b.punt;
        solid = bottle_smooth_intersect(solid, -dimple, b.smoothJoin);
    }
    return solid;
}

// The glass SHELL: the solid hollowed to a wall of `thickness` (|d| − t, the onion),
// neck chopped open a third of a neck-height above the lip joint. Both the chop and the
// punt SHRINK the solid — a smooth intersection can only add to the field — so the
// extent is the solid's plus the onion's one `thickness` outward, which is what makes
// bottle.ts's bound derivable.
float bottle_sdf(vec3 p, Bottle b) {
    float shell = abs(bottle_solid(p, b)) - b.thickness;
    float top = p.y - (b.baseHeight + b.neckHeight + b.neckHeight / 3.0);
    return bottle_smooth_intersect(shell, top, b.thickness);
}

// Marching (`bottle_sdf_intersect`) and the gradient normal (`bottle_sdf_normal`) are
// GENERATED from bottle_sdf when a program marches this shape — fable-sdf-contract §4.
// A shell this thin is exactly the case the gradient normal exists for: no face of it
// has a closed form.
