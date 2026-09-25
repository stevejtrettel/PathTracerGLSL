// Mesh area light (fable-mesh-lights) — the family's first DATA-DRIVEN kind: uniform-area
// sampling over a triangle mesh via a cumulative-area CDF texture. Struct rows (generated):
// radiance (Le), area (WORLD total — the identity-free pdf's one constant), triCount.
// Rail v2 (fable-data-rail): reads the shared index channel (tbase = the mesh's index
// region), the WORLD-position bake (a `vertices`-channel region at wposBase), and the
// normalized cumulative world-area CDF (a `records`-channel region at cdfBase; one texel
// per triangle, BVH-reordered order — the ONE order truth). All bases are baked literal
// args from the ledger.
// ONE-SIDED: emits from the cross(b−a, c−a) side (the quad pin; similarity placement with
// s > 0 and det R = +1 preserves the authored winding, so the hit side agrees).
// The §6.1 BYTE-MATCH INVARIANT: mesh_light_pdf mirrors mesh_light_sample's density —
// uniform-area over the union makes it INDEPENDENT of which triangle: d²/(A_total·cosθ).
// Pitfall 1: radiance carries NO 1/d². Pitfall 2: back-face samples/queries → pdf = 0.
// METRIC EXEMPTION (trace-loop contract): raw dot() — Euclidean closed forms (§5.3).
// Depends on: data_texel1d (glsl/core/data_texture.glsl).
// Provides: mesh_light_sample(), mesh_light_pdf().

LightSample mesh_light_sample(MeshLight l, sampler2D idxTex, sampler2D wposTex, sampler2D cdfTex, int tbase, int wposBase, int cdfBase, int triCount, Point p, vec2 xi) {
    // Binary search the normalized cumulative-area CDF: smallest tri with cdf[tri] > xi.x.
    // STRICTLY greater: a zero-area triangle has cdf[k] = cdf[k−1] and so can never be picked
    // (with >=, ξ = 0 picked triangle 0 whatever its area — a degenerate one normalized a zero
    // vector into a NaN sample that stuck in the pixel).
    int lo = 0, hi = triCount - 1;
    while (lo < hi) {
        int mid = (lo + hi) / 2;
        if (texelFetch(cdfTex, data_texel1d(uint(cdfBase + mid)), 0).x <= xi.x) lo = mid + 1;
        else hi = mid;
    }
    int tri = lo;
    // Rescale xi.x within the triangle's CDF span (pitfall 4: never reuse the selection
    // random raw — recover a fresh stratified coordinate).
    float c0 = tri > 0 ? texelFetch(cdfTex, data_texel1d(uint(cdfBase + tri - 1)), 0).x : 0.0;
    float c1 = texelFetch(cdfTex, data_texel1d(uint(cdfBase + tri)), 0).x;
    float xr = clamp((xi.x - c0) / max(c1 - c0, 1.0e-12), 0.0, 0.9999999);

    // Uniform point in the triangle (the sqrt trick), on WORLD vertices.
    uvec3 t = uvec3(texelFetch(idxTex, data_texel1d(uint(tbase + tri)), 0).xyz);
    vec3 a = texelFetch(wposTex, data_texel1d(uint(wposBase) + t.x), 0).xyz;
    vec3 b = texelFetch(wposTex, data_texel1d(uint(wposBase) + t.y), 0).xyz;
    vec3 c = texelFetch(wposTex, data_texel1d(uint(wposBase) + t.z), 0).xyz;
    float su = sqrt(xr);
    Point q = a * (1.0 - su) + b * (su * (1.0 - xi.y)) + c * (su * xi.y);

    vec3 d = q - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    vec3 gn = cross(b - a, c - a);          // outward by winding (one-sided pin)
    float cos_l = dot(normalize(gn), -ls.wi);
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the face: invalid sample

    // Uniform-area over the WHOLE mesh: pdf_area = 1/A_total, converted to solid angle.
    ls.pdf = d2 / (l.area * cos_l);
    return ls;
}

// The MIS density with which mesh_light_sample(l, p, ·) would have produced wi toward the
// hit point — uniform-area makes it triangle-identity-FREE: only the hit geometry + the
// baked total area. The emitter-hit's shading frame n IS the face's outward normal (flat
// or smooth-consistent), so the caller passes the geometric cosine via the Hit.
float mesh_light_pdf(MeshLight l, Point p, Point light_p, Direction light_n, Direction wi) {
    float cos_l = dot(light_n, -wi);
    if (cos_l <= 0.0) return 0.0;
    vec3 d = light_p - p;
    return dot(d, d) / (l.area * cos_l);
}
