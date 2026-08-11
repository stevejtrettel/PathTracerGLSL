// Knob — a VENDORED model from NVIDIA's sdf-explorer corpus, and the family's first.
//
// VENDORED, NOT OURS. The copyright and licence block below is verbatim and governs the
// maths under it. This file was chosen deliberately: most of that corpus is CC BY-NC-SA
// 3.0, and this one is MIT, so it can sit in the library on the same terms as everything
// else. A CC-licensed model would need its own answer before it lands here.
//
// PORTED, minimally, and the port is entirely mechanical:
//   · every helper is PREFIXED (`knob_sd_sphere`, `knob_rot`, …). The corpus was written
//     to be compiled ONE MODEL AT A TIME and its helper names collide across files; here
//     every occupant's file is included wholesale into one program, so the prefix is what
//     makes a second vendored model possible at all.
//   · the bare `sdf(vec3)` became `knob_sdf(vec3, Knob)`, reading `radius` off the
//     struct — the corpus has no placement or scale of its own (position/rotation are
//     placement's, per the canonical-field rule — fable-sdf-contract §2).
//   · `pi` (a host global there) became the core PI.
// Nothing inside the maths was touched, including the vendored file's own smooth
// operators — a vendored model brings its own vocabulary, and swapping in shared
// operators would quietly change the model.
//
// THE BOUND IS MEASURED, not guessed (knob.ts): the corpus documents no per-model
// extent, so the field was transcribed to TS and sampled — the same twin the containment
// vitest runs. That is the recipe every future vendored model follows.
// Provides (struct + march/normal GENERATED — A1, fable-sdf-contract §4): knob_sdf().

/*******************************************************************************
 * The MIT License (MIT)
 * Copyright (c) 2021, NVIDIA CORPORATION.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 ******************************************************************************/

// ---- helper maths (vendored) ------------------------------------------------

mat3 knob_rot(vec3 axis, float angle) {
    // http://www.neilmendoza.com/glsl-rotation-about-an-arbitrary-axis/
    axis = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat3(oc*axis.x*axis.x+c,         oc*axis.x*axis.y-axis.z*s,  oc*axis.z*axis.x+axis.y*s,
                oc*axis.x*axis.y+axis.z*s,  oc*axis.y*axis.y+c,         oc*axis.y*axis.z-axis.x*s,
                oc*axis.z*axis.x-axis.y*s,  oc*axis.y*axis.z+axis.x*s,  oc*axis.z*axis.z+c);
}

// distance functions, from https://iquilezles.org/articles/distfunctions/
float knob_sd_sphere(vec3 v, float r) {
    return length(v) - r;
}

float knob_sd_torus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float knob_sd_cone(vec3 p, vec2 c) {
    // c is the sin/cos of the angle
    float q = length(p.xy);
    return dot(c, vec2(q, p.z));
}

float knob_sd_capped_cylinder(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(h, r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float knob_sd_tri_prism(vec3 p, vec2 h) {
    vec3 q = abs(p);
    return max(q.z - h.y, max(q.x*0.866025 + p.y*0.5, -p.y) - h.x*0.5);
}

float knob_smooth_union(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5*(d2 - d1)/k, 0.0, 1.0);
    return mix(d2, d1, h) - k*h*(1.0 - h);
}

float knob_ssub(float d1, float d2, float k) {
    float h = clamp(0.5 - 0.5*(d2 + d1)/k, 0.0, 1.0);
    return mix(d2, -d1, h) + k*h*(1.0 - h);
}

// ---- the model (vendored) ---------------------------------------------------

float knob_base(vec3 p) {
    // Intersect two cones
    float base = knob_smooth_union(knob_sd_cone((p + vec3(0.0, 0.9, 0.0)) * knob_rot(vec3(1.0, 0.0, 0.0), -PI/2.0),
                                                vec2(PI/3.0, PI/3.0)),
                                   knob_sd_cone((p - vec3(0.0, 0.9, 0.0)) * knob_rot(vec3(1.0, 0.0, 0.0), PI/2.0),
                                                vec2(PI/3.0, PI/3.0)),
                                   0.02);
    // Bound the base radius
    base = max(base, knob_sd_capped_cylinder(p, 1.1, 0.25)) * 0.7;
    // Dig out the center
    base = max(-knob_sd_capped_cylinder(p, 0.6, 0.3), base);
    // Cut a slice of the pie
    base = max(-knob_sd_tri_prism((p + vec3(0.0, 0.0, -1.0)) * knob_rot(vec3(1.0, 0.0, 0.0), PI/2.0), vec2(1.2, 0.3)), base);
    return base;
}

float knob_shape(vec3 p) {
    float sphere = knob_sd_sphere(p, 1.0);
    float cutout = knob_sd_sphere(p - vec3(0.0, 0.5, 0.5), 0.7);
    float cutout_etch = knob_sd_torus((p - vec3(0.0, 0.2, 0.2)) * knob_rot(vec3(1.0, 0.0, 0.0), -PI/4.0), vec2(1.0, 0.05));
    float innersphere = knob_sd_sphere(p - vec3(0.0, 0.0, 0.0), 0.75);

    // Cutout sphere
    float d = knob_ssub(cutout, sphere, 0.1);

    // Add eye, etch the sphere
    d = min(d, innersphere);
    d = max(-cutout_etch, d);

    // Add base
    d = min(knob_ssub(sphere, knob_base(p - vec3(0.0, -0.775, 0.0)), 0.1), d);
    return d;
}

// ---- ours: placement + the marched intersect --------------------------------

// `radius` is the model's own unit sphere in world units: the corpus model is authored
// at radius 1 (its 0.8 internal scale is part of the vendored maths and stays inside).
float knob_sdf(vec3 p, Knob k) {
    vec3 q = p / k.radius;
    const float scale = 0.8;
    return knob_shape(q / scale) * scale * k.radius;
}

// Marching (`knob_sdf_intersect`) and the gradient normal (`knob_sdf_normal`) are
// GENERATED from knob_sdf when a program marches this shape — fable-sdf-contract §4.
