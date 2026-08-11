// Menger sponge — IQ's classic, as an ordinary occupant. `size` is the half-extent of
// the enclosing cube (the sponge is that cube, carved down).
//
// The construction is subtractive, which is what makes it cheap: start with a box, then
// at each scale fold space into a 3×3×3 cell (`mod(q·s, 2) − 1`) and MAX out a cross of
// three square tubes. Each iteration triples s, so the holes get three times finer.
// Seven levels is past the point where more resolves on screen at ordinary framing.
//
// SUBTRACTIVE ⇒ THE BOUND IS FREE, the same argument the eroded shapes make: max() only
// raises the field, so the sponge never leaves its cube and `marchBound` is that cube
// exactly (menger.ts). The reference library bounded it with a sphere of radius 1.9·size
// — 6× the volume, all of it empty corner.
// Provides (struct + march/normal GENERATED — A1, fable-sdf-contract §4): menger_sdf().

// The cheap max-form box the sponge's own iteration is tuned around (file-private).
// NOT box_sdf: that one is exact, this one underestimates outside the box — legal under
// the sdf clauses (never overestimates), and the DE's tuning assumes it.
float menger_cell_box(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), length(max(d, 0.0)));
}

float menger_sdf(vec3 p, Menger m) {
    vec3 q = p / m.size;
    float d = menger_cell_box(q, vec3(1.0));
    float s = 1.0;
    for (int i = 0; i < int(m.iterations); i++) {
        vec3 a = mod(q * s, 2.0) - 1.0;
        s *= 3.0;
        vec3 r = abs(1.0 - 3.0 * abs(a));
        // the cross of three square tubes carved out of this cell
        float da = max(r.x, r.y);
        float db = max(r.y, r.z);
        float dc = max(r.z, r.x);
        d = max(d, (min(da, min(db, dc)) - 1.0) / s);
    }
    return m.size * d;   // back to world units — a field in q-space is a distance in q-space
}

// Marching (`menger_sdf_intersect`) and the gradient normal (`menger_sdf_normal`) are
// GENERATED from menger_sdf when a program marches this shape — fable-sdf-contract §4.
// The sponge is flat-faced everywhere, so the gradient taps read a face normal except
// exactly on an edge.
