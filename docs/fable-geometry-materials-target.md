# Geometry & materials: the target shape, before and after the compiler

**Status: owner-commissioned July 16 2026; REFRESHED at the July 17 close-out — nearly everything below is now BUILT (kinds, symbol rename, cylinder, materials-§7 reorg, naming, lights struct-alignment, generated structs A1, shape-not-backend B1, emission B2). Verification: vitest + glslang; the GPU sweep over the batch set is owner-run. Current worked examples live in fable-component-system.md.** Tags: **[BUILT]**,
**[APPROVED]** (owner-decided, not yet executed), **[ASPIRATIONAL]** (proposed,
undecided). Every emitted-GLSL example below is copied from the real snapshot suite
(`tests/compiler/__snapshots__/generated-glsl.snapshot.test.ts.snap`, the `mixed`
scene: a Cornell room of SDF planes + a box, plus an analytic glass sphere) except
where marked otherwise.

---

## 0. The one rule [BUILT — re-affirmed Jul 16 2026]

> **Authored math lives in `.glsl` files and takes struct arguments. Generated code
> (plumbing, tables, dispatch) splices literals and uniforms freely. The struct is
> the calling convention where scene data crosses into authored math.**

The driver inlines the functions and folds the constructors, so this compiles to the
same machine code as full inlining — the rule is about keeping math statically
checkable, error-mappable, and tier-portable, at zero runtime cost.

Two multiplicities decide the emitted shape:
- **Objects are enumerable at compile time** → per-object generated functions.
- **Material identity is a runtime value** (the hit decides) → id-switched lookups.

---

## 1. Geometry

### 1.1 Before the compiler: what a scene author writes [BUILT]

```ts
objects: [
    // SDF box, constant placement (translation folds into the wrapper)
    { type: 'box', parameters: { halfSize: [0.3, 0.6, 0.3] },
      material: 'white', transform: { position: [-0.5, 0.6, -0.5] } },   // sdf-only → marcher

    // analytic glass sphere, constant (transform would fold into the parameters)
    { type: 'sphere', parameters: { center: [0.35, 1.0, 0.3], radius: 0.5 },
      material: 'glass' },   // auto → analytic (B1: shape, not backend; `backend:` pins for research)

    // driven: sliders move it with ZERO recompiles
    { type: 'sphere', parameters: { radius: 0.4 }, material: 'clay', backend: 'sdf',
      transform: { position: { param: 'ball.position', default: [0, 1, 0] },
                   rotation: { axis: [0, 1, 0], angle: { param: 'ball.theta', default: 0 } } } },
]
```

Groups exist only in the authoring layer (`flattenGroups` composes constant trees to
one TRS per leaf). **SceneDescription stays flat forever.**

### 1.2 Before the compiler: what a library author writes

One folder per primitive: `components/geometry/sphere/{sphere.glsl, sphere.ts}` +
one registry line + one word in the input union.

**The GLSL file [BUILT]** — this is the entire hand-written cost of the sphere
(`sphere.glsl`, verbatim minus comments):

```glsl
struct Sphere {
    vec3 center;
    float radius;
};

float sphere_sdf(vec3 p, Sphere sp) {
    return length(p - sp.center) - sp.radius;
}

bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 oc = ray.origin - sp.center;
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - sp.radius * sp.radius;
    float disc = b * b - c;
    if (disc < 0.0) return false;
    float s = sqrt(disc);
    t = (c < 0.0) ? (-b + s) : (-b - s);   // root by INSIDE test, never by t-threshold
    return (t > EPSILON);
}

vec3 sphere_normal(vec3 p, Sphere sp) {
    return normalize(p - sp.center);
}
```

**The slot contract** the file satisfies (enforced by `geometryContract.test.ts`):

| slot | required | consumers |
|---|---|---|
| `struct <Type>` (fields = row order + derived) | always | all slots |
| `<type>_sdf(p, T)` | **iff not thin** | marcher bound · containment (both backends) · FD normals |
| `<type>_intersect(Ray, T, out t)` | iff analytic | generated analytic dispatch |
| `<type>_normal(p, T)` | iff analytic | analytic hit frames |
| `<type>_uv(p, T)` | future slot | today hit.uv is a hardcoded planar map |

**The sdf slot's three clauses [BUILT — the region_T slot is CUT; sdf is
the sole containment provider]:** (1) sign is containment truth everywhere;
(2) magnitude never overestimates world distance (marching validity); (3) magnitude
≈ true world distance near the surface (epsilon discipline; §2.7 innermost-wins
compares depths *across objects*). Approximate SDFs are legal when they satisfy all
three — the ellipsoid ships an F/|∇F|-style approximation. **Dichotomy: every
primitive provides sdf XOR declares thin.**

**The TS descriptor.** The PRE-KINDS form (historical — replaced Jul 17 2026):

```ts
export const sphereDescriptor: PrimitiveDescriptor = {
    type: 'sphere',
    params: [
        { name: 'center', shape: 'vec3',   required: false, scales: true, default: [0, 0, 0] },
        { name: 'radius', shape: 'number', required: true,  scales: true, default: 1.0,
          constraint: { kind: 'positive' } },
    ],
    glsl: sphereGLSL,
    hasSdf: true,
    analytic: {
        thin: false,
        samplableAsLight: true,
        fold: (v, g) => ({ ...v, center: similarityApplyPoint(g, v.center), radius: g.scale * v.radius }),
    },
};
```

Note the duplication: `scales: true` and the hand-written `fold` encode the same
geometric fact twice. **[BUILT Jul 17 2026 — T1–T5 executed]**: rows typed by geometric
**kind**, from which BOTH derive (illustrative spelling; T3 rewrites the four
descriptors, exact shape is the owner's at STOP 1):

```ts
export const sphereDescriptor: PrimitiveDescriptor = {
    type: 'sphere',
    params: [
        { name: 'center', kind: 'point',  required: false, default: [0, 0, 0] },
        { name: 'radius', kind: 'length', required: true,  constraint: { kind: 'positive' } },
    ],
    glsl: sphereGLSL,
    provides: { sdf: true, analytic: true },   // declare-and-verify, both directions (T4)
    thin: false,
    samplableAsLight: true,
    // fold DERIVED from kinds: point → g·p, length → s·ℓ, direction → R·d.
    // Plane keeps its coupled-fold override; non-separable families declare a closure gate.
};
```

Irregular compile-time data stays a declared hook — quad's baked one-sided normal
(`derivedCtorFields`), a compile-time literal shared bit-exactly with the quad
light's sampler.

### 1.3 After the compiler: what the emitted program contains [BUILT]

The scene from §1.1 emits (real snapshot output):

```glsl
// Generated SDF dispatch — one function per object; placement tier inlined
float sdf_object_6(vec3 p) {
    p = p - vec3(-0.5, 0.6, -0.5);                     // translation tier
    return box_sdf(p, Box(vec3(0.0, 0.0, 0.0), vec3(0.3, 0.6, 0.3)));
}

// Generated analytic dispatch — unrolled arms, struct built from folded literals
bool analytic_intersect(Ray ray, inout Hit hit) {
    bool found = false;
    float t;
    {
        Sphere shape = Sphere(vec3(0.35, 1.0, 0.3), 0.5);
        if (sphere_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.frame = ambient_frame(hit.p, sphere_normal(hit.p, shape));
            hit.region_owner = 7;
            hit.uv = vec2(hit.p.x * 0.1, hit.p.z * 0.1);
        }
    }
    return found;
}

// Generated point classification (§2.7 innermost-wins) — spans both backends
int scene_region_at(vec3 p) {
    int region = -1;
    float best = -1.0e20;
    float d;
    d = sdf_object_6(p);   // (named objects emit sdf_<name> — N5)
    if (d < 0.0 && d > best) { best = d; region = 6; }
    d = sphere_sdf(p, Sphere(vec3(0.35, 1.0, 0.3), 0.5));   // analytic containment = same sdf
    if (d < 0.0 && d > best) { best = d; region = 7; }
    return region;
}

// Generated region → material / IOR tables
int material_of(int region) { if (region == 6) return 3; if (region == 7) return 0; /*…*/ return -1; }
float ior_of(int region)    { if (region == 7) return 1.5; return 1.0; }
```

The **driven** object gets the rigid-frame tier instead (emitter output,
`intersection.ts:163`; the two vec4 uniforms carry `q_inv` and `(−Rᵀt, s)`,
recomputed host-side in fp64 on every slider move):

```glsl
float sdf_object_8(vec3 p) {
    p = placement_rigid(u_object8PlacementQ, u_object8PlacementTS, p);
    float s = placement_scale(u_object8PlacementTS);
    return sphere_sdf(p, Sphere(s * vec3(0.0, 0.0, 0.0), s * 0.4));   // params absorb s → world-exact distances
}
```

The full placement tier table (the shape's math never knows its tier):

| tier | mechanism | what the sphere's ctor looks like |
|---|---|---|
| constant + analytic | fold at plan time (similarity-closed) | `Sphere(vec3(0.35, 1.0, 0.3), 0.5)` — transform already in the numbers |
| constant + SDF | conjugate query point (identity/translation/mat3/mat3÷s + `s·d` out) | ctor unchanged; lines before the call |
| driven | rigid-frame ABI; length-like params × s in-shader | `Sphere(s * vec3(0.0), s * 0.4)` |
| batch [ASPIRATIONAL] | UBO table, one loop per homogeneous batch | `u_spheres[i]` |

**[BUILT — naming N5]** same code, named after the authored objects (struct consts hoisted for named constant objects):

```glsl
const Sphere glass_ball = Sphere(vec3(0.35, 1.0, 0.3), 0.5);   // once, referenced everywhere
float sdf_white_box(vec3 p) { … }
```

**Custom geometry [APPROVED in principle]**: a user-authored SDF/intersector emits as
a bespoke per-object body filling the same `sdf_object_i` / arm surface (written
once, used once — inlining is correct there). It must declare the same facts a
descriptor declares: the three sdf clauses bind it, thin must be stated, analytic
customs supply a normal.

---

## 2. Materials

### 2.1 Before the compiler: what a scene author writes [BUILT]

```ts
materials: {
    white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
    red:   { model: 'lambert', albedo: { param: 'walls.red', default: [0.65, 0.05, 0.05] } }, // live uniform
    glass: { model: 'dielectric', ior: 1.5, transmittance: [1, 1, 1] },
}
```

Constants bake; `{param}`s become uniforms (`u_walls_red`) with slider metadata. A
`{param}` on a field the model doesn't read is a Validator warning (silent-inert
rule). `medium: {…}` makes the material also describe its interior (§3.5);
`model: 'none'` is a null interface and requires one.

### 2.2 Before the compiler: what a library author writes

**The GLSL file [BUILT]** — the model's math over `MaterialProperties`, in the
(uc, u) sampler form (`lambert.glsl`, eval verbatim):

```glsl
Spectrum lambert_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    if (ambient_dot(wi, hit.frame.n, hit.p) * ambient_dot(wo, hit.frame.n, hit.p) <= 0.0)
        return SPECTRUM_ZERO;
    return mp.albedo * (1.0 / PI);
}
// + lambert_sample / lambert_pdf / lambert_emission — same file
```

**The TS descriptor [BUILT]** (`lambert.ts`, verbatim core):

```ts
export const lambertDescriptor: MaterialModelDescriptor = {
    id: 'lambert',
    glsl: lambertGLSL,
    properties: [   // the fields this model READS → they exist in the scene's struct
        { name: 'albedo',   glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo',   default: 'Spectrum(0.8)', storage: 'field' },
        { name: 'emission', glslType: 'Spectrum', semantic: 'radiometric', source: 'emission', default: 'SPECTRUM_ZERO', storage: 'field' },
    ],
    capabilities: { nonDeltaLobes: true, transmission: false, emissive: true },
};
```

**[BUILT Jul 17 — the materials-§7 reorg]** Formerly:
`source:` must name one of six fields hardcoded in `PlannedMaterial`, the Planner
resolves all six for every material, and defaults live twice (Planner number +
schema string). Target: **the schema rows ARE the property vocabulary** — an open
authored record, like geometry's `PrimitiveValues`. A new model with a NEW property
then touches no compiler type:

```ts
// aspirational: sheen is a NEW property no compiler type knows about
export const sheenDescriptor: MaterialModelDescriptor = {
    id: 'sheen',
    glsl: sheenGLSL,
    properties: [
        { name: 'albedo', glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo', default: 'Spectrum(0.8)', storage: 'field' },
        { name: 'sheen',  glslType: 'float',    semantic: 'geometric',   source: 'sheen',  default: '0.0',           storage: 'field' },
    ],
    capabilities: { nonDeltaLobes: true, transmission: false, emissive: false },
};
// scene side becomes legal automatically, schema-validated like primitive params:
//   velvet: { model: 'sheen', albedo: [0.6, 0.1, 0.1], sheen: 0.7 }
```

Invariants preserved on the way: union-assigned = union-declared (one truth, two
readers); a program contains no field nothing reads (§3.4); stable material ids
(naming P1) replace today's name-sort.

### 2.3 After the compiler: what the emitted program contains [BUILT]

All real output for the `mixed` scene (materials: glass=0, green=1, red=2, white=3):

```glsl
// Generated MaterialProperties — the union of fields the models PRESENT read (§3.4)
struct MaterialProperties {
    Spectrum albedo;            // lambert reads it
    Spectrum emission;          // lambert reads it
    Spectrum transmittance;     // dielectric reads it — NO roughness/f0: no ggx present
};

// Generated lookup — schema-driven assignment; constants baked, {param}s would be u_… refs
MaterialProperties scene_material_properties(int id, vec3 p) {
    MaterialProperties props;
    props.albedo = Spectrum(0.8);
    props.emission = SPECTRUM_ZERO;
    props.transmittance = SPECTRUM_ONE;
    if      (id == 0) { props.transmittance = vec3(1.0, 1.0, 1.0); }
    else if (id == 1) { props.albedo = vec3(0.12, 0.45, 0.15); }
    else if (id == 2) { props.albedo = vec3(0.65, 0.05, 0.05); }
    else if (id == 3) { props.albedo = vec3(0.73, 0.73, 0.73); }
    return props;
}

// Generated §3.3 dispatch — grouped by model, last model is the fall-through
InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    if (mat == 0) return dielectric_sample(wo, hit, mp, uc, u);
    return lambert_sample(wo, hit, mp, uc, u);
}
// eval emitted iff NEE links it; pdf iff MIS links it (seam decisions)

// Generated capability tables — constant-fold when the scene is uniform
bool material_has_nondelta_lobes(int mat) {
    if (mat == 0) return false;    // dielectric is pure delta → NEE skips the shadow ray
    return true;
}
```

`storage: 'region-table'` fields become region-indexed tables instead of struct
fields (`ior_of` in §1.3 — the far side of a boundary has no shading point).

---

## 3. The symmetry, stated once

| | geometry | materials |
|---|---|---|
| authored math | `T_sdf / T_intersect / T_normal` over `struct <Type>` | `<id>_eval/sample/pdf/emission` over `MaterialProperties` |
| authored facts | kind-typed rows; provides / thin / samplableAsLight; folds | property schemas; capabilities |
| struct scope | per primitive type (compile-time carrier) | per scene, union of present models (runtime carrier) |
| generated plumbing | per-object functions (enumerable) | id-switched lookups (runtime id) |
| generated policy | backends present, placement tiers, thin, region tables | seam-gated ops, folded capability tables |
| extension cost | folder + registry line (no union — B1) | folder + registry line (no union — the July 2026 union→string batch; new properties are schema rows, A6) |

Media are the second tenant of the materials pattern (`MediumProperties`, same
schema machinery) **[BUILT]**. Lights are the known deviant — samplers still take
loose args — **struct-aligned + door-finished Jul 17** (PointLight/QuadLight/SphereLight, adjacent sampler/pdf functions, descriptor desugar facts).

---

## 4. Ledger (as of the July 17 close-out)

**[BUILT]** everything above except the items below — including, since the original
draft: descriptor kinds (T1–T5), type-first symbols, cylinder, generated structs
from rows (A1 — occupant GLSL declares functions only), the death of every
registry-shadow type union (A2), the lights door (A3 desugar facts), the registry
kitchen-sink compile test (A4), open material vocabulary (A6), shape-not-backend
(B1 — `backend:` pins remain on minimal + submerged as deliberate marcher
coverage), and one authored radiometric word (B2 `emission`; the environment's
`intensity` survives as the live slider).
**[ASPIRATIONAL]** batch/UBO tier; mesh backend; `T_uv` + the ShadingPoint property
signature (one coupled design); marched-hit exact normals via `T_normal`;
gradient-fallback normals; `Value<T>` light params (the light structs are now the
ABI for it); C2 default-assignment elision in the material lookup; nested-vs-flat
authored records (authoring-language-era); the `LightDescription` input union
(per-kind — the authoring language's business).

**[BUILT — the doors-close batch, July 17 2026]** (post-review follow-up): the LIGHTS
door finished for real — census/planning/validation kind branches all registry-derived
(`brdfModels` now derives from PLANNED materials, so the desugared backing model flows
alone), unknown light kinds rejected (never silently skipped), authored-light input
schemas (`authoredParams` + the generic Validator loop + the desugar-totality contract
test), and the door test (`tests/compiler/lightsDoor.test.ts`: a synthetic registry-only
kind compiles + glslang-links end to end). `MaterialModel` union → string (the B1
treatment — materials were the last unioned family; 'disney' vocabulary died with it);
ior/region-table Validator rules made structural (capability + row, no model names);
the fixed-struct-era `emission_strength` rider merged away (its product was identically
`emission`); required XOR default pinned on geometry rows (contract-test-enforced).

**Verification state:** vitest (850+) + glslang (every pair + the kitchen sink + the
lights door); the GPU witness sweep over the batch sets is owner-run and pending
(the strength merge is a provable semantic no-op but touches lambert.glsl + every
generated struct — snapshots re-goldened, diff verified to be exactly the rider).
