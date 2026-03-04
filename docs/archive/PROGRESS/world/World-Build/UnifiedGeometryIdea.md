

## 0. Big picture: one “geometry plugin” type, multiple **capabilities**

Instead of “one geometry kind field with 50 variants”, imagine:

* Each geometry type is a TS module that implements **some subset** of capabilities:

    * SDF backend (with optional multi-region).
    * Ray backend (triangles/BVH or analytic).
    * Instance backend (sphere clouds, instanced meshes, etc.).

The core interface becomes something like:

```ts
export interface GeometryCodegenContext {
  // value helpers that hook into your parameter system:
  float(v: GeometryValue<number>, defaultParamPath?: string): string;
  vec3(v: GeometryValue<[number, number, number]>, defaultParamPath?: string): string;
  // etc…
}

// SDF side (simple + multi-region)
export interface SdfInstanceCode {
  distanceFnName: string;
  glsl: string;
  regions?: GeometryRegionInfo; // optional
}

// Triangle / BVH side
export interface RayInstanceCode {
  // how to intersect this shape/range using ray tracing
  intersectFnName: string;   // Hit intersect_ray(Ray ray)
  anyHitFnName?: string;
  // indices / offsets into global BVH/triangle buffers
  bvhRootIndex?: number;
  firstTriangleIndex?: number;
  triangleCount?: number;
}

// “Cloud of instances” (sphere clouds, instanced meshes, etc.)
export interface InstanceInstanceCode {
  // intersection over many internal instances of some primitive
  intersectFnName: string;   // Hit intersect_instances(Ray ray)
  anyHitFnName?: string;
  // indices into global instance buffers
  firstInstanceIndex: number;
  instanceCount: number;
}

export interface GeometryInstanceCode {
  // always have an AABB or bounding sphere if you can:
  bounds?: { min: [number, number, number]; max: [number, number, number] };

  sdf?: SdfInstanceCode;
  ray?: RayInstanceCode;
  instances?: InstanceInstanceCode;
}

export interface GeometryType<TOptions> {
  readonly typeId: string;

  build(
    objectId: string,
    options: TOptions,
    ctx: GeometryCodegenContext
  ): GeometryInstanceCode;
}
```

Key idea: a **geometry plugin** can populate whichever backends make sense:

* Simple SDF sphere: only `sdf`.
* Multi-region SDF object: `sdf` with `regions`.
* Mesh: only `ray` (and maybe `instances` if you support instanced mesh).
* Sphere cloud: `instances` (and optionally `sdf` if you want a cheap SDF envelope).

Then:

* The **SDF scene compiler** uses only the `sdf` capability.
* The **mesh/BVH compiler** uses only the `ray` and `instances` capabilities.
* The **world compiler** knows how to glue all of them into final scene + acceleration structures.

No big switch on “kind”; just “does this geometry instance have sdf? ray? instances?”

---

## 1. Simple + multi-region objects (recap, but now in this framework)

You already have:

* Simple SDF objects (one material).
* Multi-region SDF objects (shared expensive bases + cheap region predicates, region→material mapping, and classification `region_at(p)`).

Both fit under `sdf?: SdfInstanceCode`:

```ts
// simple sphere
const SphereType: GeometryType<SphereOptions> = {
  typeId: 'sphere',

  build(objectId, options, ctx) {
    const centerExpr = ctx.vec3(options.center, `geom.${objectId}.center`);
    const radiusExpr = ctx.float(options.radius, `geom.${objectId}.radius`);
    const fn = `sdf_${objectId}`;

    return {
      sdf: {
        distanceFnName: fn,
        glsl: `
          float ${fn}(vec3 p) {
            vec3 center = ${centerExpr};
            float radius = ${radiusExpr};
            return length(p - center) - radius;
          }
        `,
        // no regions → single-material
      },
    };
  },
};
```

Multi-region geometry:

```ts
const MultiRegionThing: GeometryType<MultiRegionOptions> = {
  typeId: 'multi_region',

  build(objectId, options, ctx) {
    // codegen expensive base fields + cheap region predicates, per your doc
    const distanceFn = `distance_${objectId}`;
    const distanceAndRegionFn = `distance_and_region_${objectId}`;
    const regionAtFn = `region_at_${objectId}`;

    return {
      sdf: {
        distanceFnName: distanceFn,
        glsl: `
          // distance, region classification, region_at code...
        `,
        regions: {
          regionCount: options.regions.length,
          distanceAndRegionFnName: distanceAndRegionFn,
          regionAtFnName: regionAtFn,
        },
      },
    };
  },
};
```

SceneCompiler:

* For the **SDF module**, looks only at `instance.sdf`.
* If `sdf.regions` exists, wires up region→material mapping and the `material_from` / `material_to` classification logic you already described.

So far this is all SDF-only land.

---

## 2. Meshes + BVH

Now let’s bring in **triangle meshes**, which usually want:

* A global **triangle array**.
* A global **BVH** (or some accel, like QBVH).
* Some notion of:

    * a **mesh asset** (shared vertex/index data),
    * and **instances** (transform + material).

### 2.1. Representing mesh assets and instances in TS

I’d separate:

* **MeshAsset** – shared geometry data (vertices, indices, maybe per-vertex normals/UVs).
* **MeshInstance** – one use of an asset in the scene (transform, material, maybe region → material for multi-material meshes).

You don’t need to store all vertex data in the `SceneDescription` itself; you can reference assets.

Example:

```ts
export interface MeshAssetRef {
  meshId: string; // key into some asset registry
}

export interface MeshOptions {
  asset: MeshAssetRef;
  transform: GeometryValue<{
    translation: [number, number, number];
    rotation: [number, number, number]; // Euler or quat
    scale: [number, number, number];
  }>;
  // maybe a bounding sphere AABB as constants/params
}
```

Then:

```ts
export const MeshType: GeometryType<MeshOptions> = {
  typeId: 'mesh',

  build(objectId, options, ctx) {
    // This is where you **record** “hey, we need mesh asset X”.
    // The world compiler can collect these and build a BVH later.

    const bvhSlot = reserveMeshSlotForAsset(options.asset.meshId);

    const intersectFn = `intersect_mesh_${objectId}`;

    return {
      ray: {
        intersectFnName: intersectFn,
        glsl: `
          Hit ${intersectFn}(Ray ray) {
            // look up transform + BVH slot
            // use global mesh BVH / triangle buffers
          }
        `,
        bvhRootIndex: bvhSlot.rootIndex,
        firstTriangleIndex: bvhSlot.firstTriangleIndex,
        triangleCount: bvhSlot.triangleCount,
      },
      bounds: computeWorldBoundsOfMesh(options, /* asset info */),
    };
  },
};
```

**Where does the BVH actually get built?**

* Your **world compiler** (or a dedicated `MeshCompiler`) runs over all mesh geometry instances:

    * Loads the triangle data for each referenced MeshAsset.
    * Builds a global BVH over them (or per-mesh BVHs + top-level BVH).
    * Flattens these into arrays (WebGL: textures/uniform buffers; WebGPU: buffers/SSBOs).
* It then hands those arrays and indexing info back to:

    * the **RayInstanceCode** (`bvhRootIndex`, etc.),
    * and to the **runtime bindings** (so you can call `gl.uniform*` / bind buffers).

The geometry plugin only *describes* what’s needed; the world compiler decides how to pack it.

---

## 3. Instanced objects

There are two common flavors you’ll want:

1. **TS-level instancing:** just generate many SceneObjects that share the same geometry type/options, each with its own transform/material. (Simple, but can be heavy if you have 100k instances.)
2. **GPU-level instancing / sphere clouds:** one geometry plugin that represents a *cloud of primitives* inside a single object, with per-instance data in a buffer/UBO, plus its own acceleration.

### 3.1. TS-level instancing (easy mode)

You can already do:

```ts
function makeSphereInstances(materialId: string, centers: vec3[], radius: number): SceneObject<any>[] {
  return centers.map((center, i) =>
    Sphere(`sphere_${i}`, materialId, {
      center,
      radius,
    })
  );
}
```

This uses `SphereType` as before; world compiler just sees a ton of objects.

**Pros:**

* Simple.
* Each instance participates in SDF or BVH exactly like a single object.

**Cons:**

* Too many objects → overhead in intersection, memory, etc.

Still worth having as a first step.

### 3.2. Geometry plugin for “clouds” of primitives (sphere clouds / instanced meshes)

For **path tracing big clouds of spheres**, you probably want:

* A GPU buffer with all centers/radii/material indices.
* A small BVH over those spheres.
* A single intersection function that traverses that structure.

Perfect use case for the `instances?: InstanceInstanceCode` capability.

```ts
export interface SphereCloudOptions {
  // TS side: either constants, param-backed, or loaded from file
  spheres: Array<{
    center: [number, number, number];
    radius: number;
    materialId: string; // or index into a palette
  }>;
  // later: maybe allow procedural generation of spheres here
}

export const SphereCloudType: GeometryType<SphereCloudOptions> = {
  typeId: 'sphere_cloud',

  build(objectId, options, ctx) {
    const { spheres } = options;
    const cloudSlot = reserveSphereCloudSlot(spheres); // world-compiler hook

    const intersectFn = `intersect_sphere_cloud_${objectId}`;

    return {
      instances: {
        intersectFnName: intersectFn,
        anyHitFnName: `${intersectFn}_any`,
        firstInstanceIndex: cloudSlot.firstInstanceIndex,
        instanceCount: spheres.length,
      },
      bounds: cloudSlot.bounds,
      // (maybe also an SDF envelope in sdf?: for approximate distance)
    };
  },
};
```

World-compiler:

* Collects all `SphereCloudType` geometry.
* Packs their per-sphere data into global arrays/UBOs/textures.
* Builds a BVH over them.
* Assigns `firstInstanceIndex` / `instanceCount` / root node indices.

The ray tracer then has a specialized `trace_sphere_clouds()` stage that uses the global buffers and calls each cloud’s `intersectFnName` to traverse the right chunk.

Instanced **meshes** are similar:

* A “mesh instance cloud” geometry plugin that:

    * References a mesh asset.
    * Holds per-instance transforms and maybe per-instance material overrides.
    * World-compiler builds a two-level BVH:

        * top: over instance bounding boxes,
        * bottom: per-mesh BVHs.

The plugin returns `instances` code that knows how to traverse the top-level instance BVH and then call into a shared “mesh/triangle intersection” function.

---

## 4. How the path tracer sees all this

The transport / tracing layer doesn’t have to know about our geometry plugin zoo. It just sees:

* An **SDF scene module**: `scene_sdf_distance(p)`, `scene_sdf_intersect(ray)`, maybe `scene_sdf_region_at(p)`.
* A **mesh/BVH scene module**: `scene_ray_intersect(ray)`.
* An **instance/aggregate scene module**: `scene_instances_intersect(ray)`.

These modules internally:

* Are generated from the geometry plugins.
* Use global arrays/BVHs built by the world compiler.
* Deal with `material_from` / `material_to` according to regions or instance data.

The path tracer can then:

* Choose which backends to use per ray (e.g., SDF only, mesh only, both and take nearest).
* Or have a unified `scene_intersect(ray)` that calls all enabled backends and picks the closest hit.

Your existing **multi-tracing** notes actually lean in this direction: different tracers (SDF, triangle, etc.) that can be combined.

The geometry plugin system just makes sure *all* those tracers can be fed from a single, coherent TS description of the world.

---

## 5. Migration path from now → full system

To keep this practical:

1. **Now (SDF only):**

    * Implement `GeometryType<T>` with only the `sdf` capability.
    * Have `SphereType`, `BoxType`, `CustomSDFType`, `MultiRegionThing`.
    * Hook SceneCompiler to `instance.sdf`.

2. **Next: multi-region SDF objects:**

    * Extend `SdfInstanceCode` with `regions`.
    * Implement one multi-region geometry plugin and integrate the `material_from` / `material_to` classifier as per your doc.

3. **Then: meshes + BVH:**

    * Add the `ray?: RayInstanceCode` capability.
    * Introduce a `MeshType` that references assets; write a mesh/BVH compiler that gathers these, builds a BVH, fills in `RayInstanceCode` and GPU buffers.

4. **Later: instanced clouds:**

    * Add `instances?: InstanceInstanceCode`.
    * Implement `SphereCloudType` first (simplest).
    * Build a dedicated instance BVH and intersection function.

All of that happens **without** changing the external `SceneObject` authoring experience much—you’re still:

> “building an object by attaching some geometry to a material”

It’s just that “some geometry” can now be:

* a simple SDF sphere,
* a multi-region SDF object,
* a mesh instance,
* or a sphere cloud / instanced mesh.

And each of those is its own little TS module, not an entry in a giant discriminated union.

---

If you’d like, next step we can:

* Sketch concrete TS types for `GeometryInstanceCode` + `GeometryType<T>` that match your existing parameter system types.
* Then wire a minimal `MeshType` and `SphereCloudType` into your current world compiler as stubs (even before building a full BVH), just to get the data flowing end-to-end.
