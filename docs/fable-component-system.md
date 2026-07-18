# The component system: authoring → SceneDescription → GLSL

**Status: owner-commissioned July 17 2026; REFRESHED at the July 17 close-out** to the
as-built system (kinds, symbol rename, cylinder, materials-§7, naming N1–N5, lights
struct-alignment, ease batch A1–A6, shape-not-backend B1, emission unification B2).
Every emitted-GLSL excerpt in §4 is REAL compiler output for the walkthrough scene in
§3 — compiled, not sketched. Verification state: vitest + glslang; the GPU witness
sweep over the batch set is owner-run. §3.2's authoring-language form is the one
DRAFT-aligned section. Companion doc: `fable-geometry-materials-target.md`.

---

## 1. The philosophy

Five rules generate everything below:

1. **Authored math lives in `.glsl` files and takes struct arguments. Generated code
   (plumbing, tables, dispatch, and the STRUCTS THEMSELVES) splices literals and
   uniforms freely.** The struct is the calling convention where scene data crosses
   into hand-written math — and since A1 the struct *declaration* is generated from
   the descriptor rows, so the shape of the record has exactly one source. The GPU
   driver inlines and constant-folds, so this compiles to the same machine code as
   hand-specialization; the rule buys static checkability, error-mapping,
   readability, and tier portability at zero runtime cost.

2. **A component is one folder: `{<name>.glsl, <name>.ts}` + one registry line —
   full stop.** The GLSL is the math (a small function surface, type-first symbols:
   `sphere_sdf`, `lambert_eval`, `quad_light_sample`; NO struct declaration — that
   is generated). The descriptor declares FACTS — schema rows, capabilities,
   derived fields, desugar rules — and returns numbers, never GLSL strings, never
   composition. Generators own all composition. There are no type unions to touch:
   the registries are the gatekeepers and unknown ids get diagnostics.

3. **Schemas own the vocabulary.** A row is the single declaration from which
   everything derives: the generated struct field (typedef-disciplined — `point` →
   `Point`, `direction` → `Direction`, radiometric → `Spectrum`), the constructor,
   resolution (`authored ?? row.default`), the constant-transform fold, driven ×s
   scaling, the uniform, and validation. No compiler type names a property.

4. **Identity is structural; names are provenance.** Objects, regions, materials,
   and lights are numbered by authored order — renaming changes nothing
   radiometric. Names flow into diagnostics and emitted symbols (`sdf_pillar`,
   `shape_pillar`) so the shader reads like the scene.

5. **Every value lives at the cheapest tier that carries it, and the AUTHOR never
   picks machinery.** Constants fold to literals; `{param}` values become live
   uniforms (zero recompiles); the engine backend is the COMPILER's choice
   (analytic if the primitive provides it, else the marcher — `backend:` pins
   exist for research/coverage); radiometric quantities are authored as ONE word,
   `emission` (Le for area emitters, radiant intensity for delta lights — power in
   watts is authoring-layer sugar, since power is per-object, never per-material).

The enforcement ladder, cheapest first: **contract tests** (registry facts ↔ GLSL
symbols, derived-field declarations ↔ values, reserved-key collisions) →
**glslang** static compile of every registry pair PLUS the registry kitchen sink (a
scene synthesized from the registries themselves — every primitive on both backends,
constant and driven, every material/phase/light kind — so a new occupant is
compile-covered the moment its registry line lands) → **snapshots** → **witnesses**
(`npm run witness`, the numeric GPU truth).

---

## 2. Authoring a new component

### 2.1 A geometry primitive (cylinder — the whole thing, as landed)

```glsl
// components/geometry/cylinder/cylinder.glsl — FUNCTIONS ONLY (struct is generated)
float cylinder_sdf(vec3 p, Cylinder c) {
    vec3 q = p - c.center;
    vec2 d = vec2(length(q.xz) - c.radius, abs(q.y) - c.halfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
```

```ts
// components/geometry/cylinder/cylinder.ts
export const cylinderDescriptor: PrimitiveDescriptor = {
    type: 'cylinder',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'halfHeight', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: cylinderGLSL,
    provides: { sdf: true, analytic: false },
};
```

Plus one registry line. Nothing else — no type-union word, no struct declaration, no
demo entry needed for compile coverage (the kitchen sink picks it up). `struct
Cylinder { Point center; float radius; float halfHeight; }` is EMITTED from the rows.
Note what else is absent: no axis parameter (orientation is *placement* — a tilted
cylinder is `transform.rotation` through the compiler's wrapper tiers), no fold
(kind-derived), no emission code.

Contract per slot: `<type>_sdf` iff `provides.sdf` (sign = containment truth; never
overestimates world distance; ≈ exact near the surface — approximate SDFs legal
under those clauses); `<type>_intersect` + `<type>_normal` iff `provides.analytic`;
every primitive provides sdf XOR declares `thin`. Derived compile-time fields (the
quad's baked one-sided normal) are DECLARED (`derivedFields`) and computed
(`derivedCtorFields`) as a pair the contract test keeps honest.

### 2.2 A material model (lambert, as landed)

```glsl
// components/materials/lambert/lambert.glsl — reads the GENERATED scene-scoped struct
Spectrum lambert_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    if (ambient_dot(wi, hit.frame.n, hit.p) * ambient_dot(wo, hit.frame.n, hit.p) <= 0.0)
        return SPECTRUM_ZERO;
    return mp.albedo * (1.0 / PI);
}
// + lambert_sample / lambert_pdf / lambert_emission, same file
```

```ts
export const lambertDescriptor: MaterialModelDescriptor = {
    id: 'lambert',
    glsl: lambertGLSL,
    properties: [   // rows ARE the vocabulary; defaults are NUMBERS (GLSL spelling derived)
        { name: 'albedo', glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo', default: 0.8, storage: 'field' },
        { name: 'emission', glslType: 'Spectrum', semantic: 'radiometric', source: 'emission', default: 0, storage: 'field' },
    ],
    capabilities: { nonDeltaLobes: true, transmission: false, emissive: true },
};
```

A new model with a NEW property (`sheen: 0.7`) is one folder + one registry line:
the row declares the key (the authored record is open — `MaterialDescription` takes
any schema-declared key), and resolution, the union-struct field, the lookup arm,
the uniform path, and validation all derive. `ior`-style region-table fields are
found *structurally* (the transmission capability ⇒ a `storage: 'region-table'`
row); `emission` is the one policy-read name (`EMISSION_KEY`, paired with
`capabilities.emissive` — both pairings registry-tested).

### 2.3 A light kind (quad, as landed)

The light file carries BOTH halves of the kind's math as **adjacent functions** over
the generated struct — the §6.1 sampler↔pdf mirror is two functions in one file:

```glsl
// struct QuadLight — GENERATED from the rows + derivedFields
LightSample quad_light_sample(QuadLight l, Point p, vec2 xi) { ... }
float       quad_light_pdf(QuadLight l, Point p, Point light_p, Direction wi) { ... }
```

```ts
export const quadLightDescriptor: LightKindDescriptor = {
    kind: 'quad',
    glsl: lightQuadGLSL,
    delta: false,
    params: [
        { name: 'corner', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'edge1', shape: 'vec3', semantic: 'geometric', kind: 'vector' },
        { name: 'edge2', shape: 'vec3', semantic: 'geometric', kind: 'vector' },
        { name: 'radiance', shape: 'vec3', semantic: 'radiometric' },
    ],
    derivedFields: [
        { name: 'normal', kind: 'direction', shape: 'vec3' },   // geometry's quadNormal — the
        { name: 'area', kind: 'length', shape: 'number' },      //   bit-exact one-sided pin
    ],
    derivedCtorFields: (v) => [quadNormal(v.edge1, v.edge2), quadArea(v.edge1, v.edge2)],
    power: (v) => Math.max(1e-8, Math.PI * quadArea(v.edge1, v.edge2) * radiantScalar(v.radiance)),
    // DESUGAR FACTS (the lights door): how an authored light lowers — no Planner branches.
    toValues: (a, product) => ({ corner: a.corner, edge1: a.edge1, edge2: a.edge2, radiance: product }),
    region: { primitive: 'quad', parameters: (a) => ({ corner: a.corner, edge1: a.edge1, edge2: a.edge2 }) },
    valuesFromRegion: (p, Le) => ({ corner: p.corner, edge1: p.edge1, edge2: p.edge2, radiance: Le }),
    validateAuthored: (a) => quadArea(a.edge1, a.edge2) < 1e-8 ? ['quad edges are parallel...'] : [],
};
```

Both authoring routes — the explicit light AND a `sampleAsLight` emissive object —
lower through this one definition.

---

## 3. The interchange: SceneDescription

### 3.1 The flat IR (what any authoring layer must produce)

SceneDescription is deliberately FLAT and dumb — groups, prefabs, classes live in
the authoring layer above it (`flattenGroups` composes trees to one transform per
leaf). Objects describe SHAPE; the compiler picks the engine. This is the
walkthrough scene:

```ts
{
    id: 'walkthrough', name: 'Walkthrough', ambientSpace: { type: 'euclidean' },
    objects: [
        // constant position — everything folds to compile-time literals
        { type: 'cylinder', name: 'pillar',
          parameters: { radius: 0.3, halfHeight: 0.5 },
          material: 'clay',
          transform: { position: [-0.8, 0.5, 0] } },

        // uniform-controlled position — a live slider, zero recompiles.
        // `backend: 'sdf'` is the RESEARCH PIN (auto would pick analytic here).
        { type: 'sphere', name: 'orb',
          parameters: { radius: 0.35 },
          material: 'marbleite',
          backend: 'sdf',
          transform: { position: { param: 'orb.position', default: [0.7, 0.6, 0.2] } } },
    ],
    materials: {
        clay: { model: 'lambert', albedo: [0.55, 0.35, 0.24] },
        // procedural: spatially-varying color + uniform-driven roughness
        marbleite: { model: 'ggx',
          f0: { kind: 'glsl', source: 'mix(vec3(0.9, 0.6, 0.2), vec3(0.2, 0.4, 0.9), 0.5 + 0.5 * sin(6.0 * p.x))' },
          roughness: { param: 'marbleite.roughness', default: 0.35, min: 0.05, max: 1.0 } },
    },
    lights: [
        // ONE radiometric word: emission (Le for area kinds; scalar broadcasts)
        { kind: 'quad', corner: [-0.5, 1.98, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1],
          emission: [12, 11.4, 10.8] },
    ],
    environment: { type: 'constant', color: [0.05, 0.06, 0.08], intensity: 1.0 },
    // (env `intensity` is the LIVE Sky-intensity slider — a runtime dial, not factoring)
}
```

Three value forms, the whole story of "how alive is this number": a **constant**
(folds to a literal), a **`{param}`** (a uniform + a slider; the author owns the
name — reserved prefixes like `engine.` are Validator-checked), and a
**`{kind:'glsl'}` expression** (spliced where a shading point exists; illegal for
region-indexed values and transforms).

### 3.2 The eventual authoring language [DRAFT-ALIGNED, NOT BUILT]

Per `fable-authoring-language.md`'s decisions (classes, make-and-add, labels,
construction-only mutation), plausibly:

```ts
const clay = new Lambert({ albedo: [0.55, 0.35, 0.24] });
const marbleite = new GGX({ f0: glsl`mix(...)`, roughness: param('marbleite.roughness', 0.35) });

scene.add(new Cylinder({ radius: 0.3, halfHeight: 0.5 }, clay).at(-0.8, 0.5, 0));
scene.add(new Sphere({ radius: 0.35 }, marbleite).at(param('orb.position', [0.7, 0.6, 0.2])));
scene.add(new QuadLight({ corner: [...], edge1: [...], edge2: [...], power: 60 }));  // power → Le at authoring time
```

Whatever the final syntax, it compiles to §3.1's flat record — the IR is the
contract; the language is sugar over it.

---

## 4. What the compiler builds (all REAL output for §3.1)

The cast after Analyze → Validate → Plan (backend RESOLVED per object):

| authored | backend | region | material id | emitted symbols |
|---|---|---|---|---|
| `pillar` (cylinder, constant) | auto → sdf (sdf-only) | 0 | clay = 0 | `shape_pillar`, `sdf_pillar` |
| `orb` (sphere, driven) | **pinned** sdf | 1 | marbleite = 1 | `sdf_orb`, `u_object1PlacementQ/TS` |
| quad light (desugared) | analytic region | 2 | `__light_2` = 2 | `light_0` (QuadLight const) |

### 4.1 Geometry — generated structs, then placement at the cheapest tier

```glsl
// Generated primitive structs (rows are the single source — A1)
struct Sphere {
    Point center;
    float radius;
};
struct Quad {
    Point corner;
    vec3 edge1;
    vec3 edge2;
    Direction normal;
};
struct Cylinder {
    Point center;
    float radius;
    float halfHeight;
};

const Cylinder shape_pillar = Cylinder(vec3(0.0, 0.0, 0.0), 0.3, 0.5);

// Generated SDF dispatch
float sdf_pillar(vec3 p) {
    p = p - vec3(-0.8, 0.5, 0.0);                    // constant transform → folded translation
    return cylinder_sdf(p, shape_pillar);
}

float sdf_orb(vec3 p) {
    p = placement_rigid(u_object1PlacementQ, u_object1PlacementTS, p);   // live rigid frame
    float s = placement_scale(u_object1PlacementTS);
    return sphere_sdf(p, Sphere(s * vec3(0.0, 0.0, 0.0), s * 0.35));     // params absorb s → world-exact
}

int scene_region_at(vec3 p) {         // §2.7 innermost-wins containment
    ...
    d = sdf_pillar(p);
    if (d < 0.0 && d > best) { best = d; region = 0; }
    d = sdf_orb(p);
    ...
}
```

Same `cylinder_sdf`/`sphere_sdf` as §2.1 — the math never learns its tier. The
light's backing region rides the analytic dispatch (`quad_intersect` over the
generated `Quad`), and `material_of` spans all three regions.

### 4.2 Materials — the union struct and the three value forms

```glsl
struct MaterialProperties {      // GENERATED: the union of fields the PRESENT models read
    Spectrum albedo;             // lambert
    Spectrum emission;           // lambert
    Spectrum f0;                 // ggx
    float roughness;             // ggx
};

MaterialProperties scene_material_properties(int id, vec3 p) {
    MaterialProperties props;
    props.albedo = Spectrum(0.8);        // defaults DERIVED from the rows' numbers
    ...
    if (id == 0) {
        props.albedo = vec3(0.55, 0.35, 0.24);                     // CONSTANT → folded literal
    }
    else if (id == 1) {
        props.f0 = mix(vec3(0.9, 0.6, 0.2), vec3(0.2, 0.4, 0.9),
                       0.5 + 0.5 * sin(6.0 * p.x));                // EXPRESSION → spliced, sees p
        props.roughness = u_marbleite_roughness;                   // {param} → live uniform
    }
    else if (id == 2) {
        props.albedo = vec3(0.0, 0.0, 0.0);                        // the desugared emitter
        props.emission = vec3(12.0, 11.4, 10.8);                   // = the authored Le, verbatim
    }
    return props;
}

Spectrum interaction_surface_eval(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    if (mat == 0 || mat == 2) return lambert_eval(wi, wo, hit, mp);
    return ggx_eval(wi, wo, hit, mp);
}
bool material_is_emissive(int mat) { return mat == 2; }            // the emission gate, folded
```

### 4.3 The light — one construction site, three readers

```glsl
const QuadLight light_0 = QuadLight(vec3(-0.5, 1.98, -0.5), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0),
                                    vec3(12.0, 11.4, 10.8),                 // the authored emission
                                    vec3(0.0, -1.0, 0.0), 1.0);             // DERIVED normal + area

LightSample lighting_sample(Point p, vec2 xi) {
    LightSample ls;
    ls = quad_light_sample(light_0, p, xi);
    ls.light_id = 0;
    return ls;
}
...
    if (light_id == 0) return 1.0 * quad_light_pdf(light_0, p, light_hit.p, wi);   // MIS query
```

The derived normal `vec3(0,-1,0)` is the SAME compile-time number geometry's `Quad`
struct carries — one TS function produced both, so the side you can hit and the
side NEE samples agree bit-exactly. And since B2, the emitted Le is the authored
number verbatim — the desugar invariant is one field read twice.

### 4.4 The live channel — what the sliders touch

| uniform | fed by | what moves |
|---|---|---|
| `u_object1PlacementQ`, `u_object1PlacementTS` | `orb.position` (fp64 host inverse) | the orb, live |
| `u_marbleite_roughness` | `marbleite.roughness` | the orb's gloss, live |
| `u_environment_intensity` | `environment.intensity` | the sky dial |
| `u_cameraPosition` / `u_cameraTarget` | `camera.position` / `camera.target` | orbiting |

Everything else is a compile-time literal; the driver's folding erases the
difference between the hand-written functions and fully specialized code.

---

## 5. The extension invariant

| add a… | you write | proven by |
|---|---|---|
| geometry primitive | math fns + rows + registry line | cylinder (July 17) |
| material model (even w/ new property) | 4 math fns + rows + registry line | GGX; the schema reorg |
| light kind | sampler+pdf fns + rows/desugar facts + registry line | the struct-alignment + door batches |
| phase model | 3 math fns + rows + registry line | draine |
| camera model | one fn + descriptor + registry line | six occupants |
| transport technique | one file + registry line | equiangular |

Everything else — structs, validation, resolution, dispatch, placement tiers,
regions, selection CDFs, uniforms, contract tests, glslang coverage (the kitchen
sink), dump visibility (`npm run dump:shaders -- --scene <module>`) — derives from
the registry. **When a change requires touching a generator to add a component,
that is a bug in the system, not a cost of the component.** (One honest residue:
a new LIGHT KIND still adds its authored-input interface to `LightDescription` —
the scene-side union is the authoring language's business.)
