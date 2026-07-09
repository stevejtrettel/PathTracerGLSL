# Impl plan — §10.1 item 2: Hit struct → regions + material_of()

Replace the slice's per-object **material** tracking with **region** tracking, so the
`Hit` carries region identity and materials are derived via a generated `material_of()`
table. Priority-ordered next after item 1 (interaction reshape, committed).

**Provenance:** transcribed from `fable-compiler-contracts.md` §4.1 (the `Hit` struct),
§2.3 (region identity primary; `material_of` table; region disambiguation forbidden),
and §4.3 (the marcher reports the owner region). The §10.1 item-2 note: *"per-object
material tracking in `scene_sdf` becomes region tracking (trivial while every object is
one region)."*

**Why it matters (§2.3):** materials must be *derived* from regions, never stored
ambiguously — two white walls sharing one material are two distinct regions. Keying
shading on material id (the current slice) is the archive's forbidden "Solution A": it
breaks the moment two objects share a material *and* need to be told apart (media,
per-region emission, IOR). This item makes region identity primary.

---

## Target shapes (§4.1 / §2.3)

```glsl
struct Hit {
    float t;
    Point p;
    Frame frame;
    int   region_from;  // region on the incoming side (-1 = ambient)
    int   region_to;    // region on the far side
    vec2  uv;
};

int material_of(int region_id);   // generated constant table; material_of(-1) = -1 (vacuum)
```

**Shading rule (§4.1, PINNED):** the surface material is `material_of(owner)`, where
`owner` is the region whose SDF produced the hit. **For item 2 `owner == region_to`** —
every object is a single region hit from outside (Lambert reflect-only, no transmission),
so `region_to` *is* the owner. The `owner ≠ region_to` case (dielectric exits, where
`region_to = -1` but the surface is still glass) is **deferred to the dielectric item**.

**Region ids:** while every object is one region, `region_id = object index`
(`PlannedSDFObject.index`), and `material_of(index) = obj.materialId`. Multi-region
objects (one object → several regions) are a later concern.

---

## In scope for item 2 (the 4-file change)

1. **`structs.glsl`** — `Hit`: `int material_to; int material_from;` → `int region_from; int region_to;`.
2. **`intersection.ts`** —
   - `scene_sdf(p, out int material)` → `scene_sdf(p, out int region)`; the arg-min sets
     `region = obj.index` (the **owner**), not `obj.materialId`.
   - add generated **`int material_of(int region)`** (region → material id; `-1 → -1`),
     placed after `scene_sdf` (before transport, which consumes it).
3. **`raymarch.glsl`** `scene_intersect` — `int region = -1;`, `scene_sdf(p, region)`,
   `hit.region_to = region;` `hit.region_from = -1;` (ambient — no transmission in item 2).
4. **`path_trace.glsl`** — `int mat = hit.material_to;` → `int mat = material_of(hit.region_to);`
   (feeds the §3.3 dispatcher + `scene_material_properties`, both unchanged — they stay
   material-keyed).

**Behavior-preserving:** the material id reaching `scene_material_properties` is identical
(`obj.index → material_of → obj.materialId` = the old direct `obj.materialId`). Cornell must
render the same image, same mean — exactly as item 1 did.

---

## Deferred — NOT in item 2, mapped to later items

| Deferred piece | Why not now | Lands in |
|---|---|---|
| **`scene_region_at(p)` + epsilon interface classification** (§4.2) — `region_from = scene_region_at(p − ε·dir)` | item 2 has no transmission → the ray is always in ambient, so `region_from = -1` is exact | media / dielectric item (§4.2/§4.4) |
| **`owner` distinct from `region_to`** (dielectric exits) — add `owner` to `Hit` | `owner == region_to` for single-region opaque objects hit from outside | dielectric item |
| **Medium tracking** (`current_medium` ground-truthed by `scene_region_at`, §4.4) | no media | media item |
| **`light_of(region)` table** (§2.3 family) | light identity is geometric; consumed by NEE/emission MIS | §10.1 **item 3** (LightSample → CDF) |
| **`ior_of(region)` table** (§2.3 family) | needed only by the dielectric's η ratio | dielectric item |
| **Multi-region objects** (one object → several regions; predicate order §2.7) | every object is one region today | later |
| **Ambient medium** — `material_of(-1)` = declared `ambientMedium`'s id | no `ambientMedium` in the scene; `-1 → -1` (vacuum) | media item (§2.4) |
| **Thin / open 2D surfaces in air** (paper, membranes, minimal surfaces) | shading is *ready* (see note); blocked only on geometry | `owner` field → dielectric item; open-surface **marching** → a future intersection-method item |

**Note — 2D surfaces in air are a *geometry* gap, not a shading one.** The region/`owner`
model already shades them correctly: a zero-thickness sheet in air has
`region_from == region_to == -1` (air both sides), `owner` = the sheet, so
`material_of(owner)` shades it, `current_medium` is unchanged (no volume entered), and the
BSDF is two-sided (§3.2 "hit from either side"). What's missing is purely *finding* the
surface: a sphere-tracer needs a **signed** interior to detect a crossing, and a true 2D
sheet's field is **unsigned** (never < 0). So open surfaces need either thickening (→ a thin
solid, supported now) or a different **intersection method** — direct/analytic tracing for
the surfaces that admit it (e.g. an analytic quad, or a parametric/implicit math surface),
selected per object. Implicit *signed* surfaces (gyroid & other triply-periodic minimal
surfaces, `F(p)=0` with ± lobes) already get regions for free. This item ships solids +
half-spaces; the `owner` split (needed for both dielectric exits and 2D surfaces) is the
one shared prerequisite.

---

## Verification

- **Snapshot** will diff (Hit struct, `scene_sdf` region + `material_of` table, `raymarch`,
  `path_trace`). Review = exactly the region rename + `material_of` indirection, then `-u`.
- **Typecheck** clean (only `intersection.ts` changes: the `scene_sdf` out-param rename +
  `material_of` generator).
- **Live GPU (the gate):** Cornell renders identically and converges to the same mean
  (~1.216, NaN=0) — behavior-preserving, since the derived material ids are unchanged.

---

## Open decisions for implementation

1. **`region_id = object index`** (recommended) — simplest while one region per object;
   a dedicated region-id space is only needed for multi-region objects (later).
2. **`material_of` lives in `intersection.ts`** (recommended) — it derives from
   `plan.objects` (`index`, `materialId`) and belongs with the region/geometry codegen,
   declared before transport consumes it. (Alternative: `materials.ts`.)
3. **Do NOT add `owner` to `Hit` yet** (recommended, per the no-unused-code lesson) —
   `region_to` == owner suffices for item 2; add `owner` when dielectric transmission makes
   them differ. (Contrast: `prev_was_delta` was included in item 1 because it had an
   imminent, cheap MIS use; `owner` has no reader until dielectrics.)

Related: `fable-compiler-contracts.md` §2.3, §4.1–4.4; `docs/impl-plan-interaction-reshape.md`
(item 1, committed).
