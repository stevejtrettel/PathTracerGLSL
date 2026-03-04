
# Module Contracts v3.1 – Scene, Material, Lights, Interaction, Transport

## 0. High-Level Picture

At runtime, the path tracer sees **five GLSL modules**:

1. `scene.glsl` – geometry & material IDs in space.
2. `material.glsl` – `mat_id → MaterialProperties`.
3. `lights.glsl` – explicit lights & environment, sampling + PDFs.
4. `interaction.glsl` – BSDF / phase math given MaterialProperties.
5. `transport.glsl` – the path tracer that calls all of the above.

    On the **TypeScript side**, you have **three “described” systems** that get compiled:

    * `SceneDescription` → `SceneCompiler` → `scene.glsl` module.
* `MaterialSystemDescription` → `MaterialCompiler` → `material.glsl` module.
* `LightingDescription` → `LightsCompiler` → `lights.glsl` module.

    `Interaction` and `Transport` are mostly static GLSL libraries that link against those modules.

    All three description systems share a **parameter pattern**:

```ts
type Value<T> = T | { param: string };    // literal or parameter reference
```

and a global

    ```ts
interface ParameterMetadata {
  type: 'float' | 'int' | 'vec3' | 'color' /* ... */;
  default: number | [number, number, number] /* ... */;
  // (plus UI info)
}
```

---

## 1. Scene Module

### 1.1 Runtime GLSL Contract

    ```glsl
// Types assumed to exist
struct Ray {
    vec3 origin;
    vec3 direction;
};

struct Frame {
    vec3 n;  // normal
    vec3 t;  // tangent
    vec3 b;  // bitangent
};

struct Hit {
    vec3  p;      // world-space hit point
    vec3  n;      // geometric or shading normal
    vec2  uv;     // surface coordinates if available, else (0,0)
    float t;      // ray parameter (distance)
    int   material_from;  // material ID ray was in before hit
    int   material_to;    // material ID ray enters after hit
    Frame frame;          // local shading frame
};

// Primary ray intersection
bool scene_intersect(Ray ray, out Hit hit);

// Occlusion query (e.g. shadow rays)
bool scene_intersect_any(Ray ray, float max_t);

// Spatial classification: which material fills space at this point?
int scene_material_at(vec3 p);

// Scene-scale hint for environment sampling, camera, etc.
float scene_bounding_radius();
```

**Semantics:**

* `scene_intersect`:

* Returns `true` and fills `hit` with the *closest* intersection.
* Must correctly set `material_from` and `material_to` according to the regions the ray is leaving/entering.
* `scene_intersect_any`:

* Returns `true` if *any* object intersects the ray within `max_t`.
* `scene_material_at`:

* Returns the `mat_id` of the medium filling `p` (air, smoke, water, etc.).
* `scene_bounding_radius`:

* Returns a radius ( R ) such that non-environment geometry is contained in a ball of radius ( R ).

    Scene does **not** look up BSDFs, volumes, or lights.

---

### 1.2 TS-Side Description & Compiler

#### 1.2.1 SceneDescription

    ```ts
type Vec3 = [number, number, number];

interface SphereObject {
  type: 'sphere';
  id: string;
  material: string;              // material name, resolved by Material module
  center: Value<Vec3>;
  radius: Value<number>;
}

interface BoxObject {
  type: 'box';
  id: string;
  material: string;
  center: Value<Vec3>;
  halfExtents: Value<Vec3>;
}

interface AlgebraicVarietyObject {
  type: 'algebraicVariety';
  id: string;
  material: string;

  center: Value<Vec3>;
  size:   Value<number>;
  bound:  'box' | 'sphere' | 'none';

  /**
   * GLSL expression in terms of `q` (local coords) defining f(q).
   * e.g. "dot(q,q) - 1.0".
   */
  equation: string;
}

type SceneObject =
  | SphereObject
  | BoxObject
  | AlgebraicVarietyObject; // (later: MeshObject, InstanceCloudObject, etc.)

interface SceneDescription {
  objects: SceneObject[];
  // Scene doesn’t own materials; it only references them by name.
  parameters?: Record<string, ParameterMetadata>;
}
```

**Key idea:**
Scene just knows **where material names live** in space; **Material** resolves names → physical parameters.

#### 1.2.2 SceneCompiler responsibilities

    `SceneCompiler.compile(description: SceneDescription): ModuleDescriptor`

* **Parameter analysis**

* Walk all `SceneObject`s, find every `Value<T>` that is `{ param: 'path' }`.
* Infer GLSL type from context (`center` = vec3, `radius` = float, etc.) and/or `ParameterMetadata`.
* Build `paramUsage: Map<string, 'float' | 'vec3' | ...>`.

* **Uniform generation**

* For each entry in `paramUsage`:

* Generate `uniform <type> u_scene_<path_with_dots_replaced_by_underscores>;`

* **SDF / intersection code**

* For each object:

    * Dispatch on `obj.type` and generate object-specific SDF / hit code.
* Use uniforms or literals depending on whether fields are parameterized.

    Example for a sphere:

    ```glsl
  float sdf_sphere_ball(vec3 p) {
      vec3 center = u_scene_ball_center;
      float radius = u_scene_ball_radius;
      return length(p - center) - radius;
  }
  ```

    * **scene_intersect / scene_intersect_any / scene_material_at**

    * Emit implementations that:

    * Traverse your internal object list / BVH.
* Call the correct SDFs / intersection routines.
* Compute `material_from` / `material_to` via region classification.

* **Uniform bindings**

* For each `paramPath`:

* Add an entry telling the engine how to fill `u_scene_...` from `parameters[paramPath]`.

---

## 2. Material Module (NEW)

Material is a new, standalone module that:

    * Owns **material IDs** and their mapping to physical properties.
* Talks to the TS material descriptions + parameter system.
* Is independent of geometry.

### 2.1 Runtime GLSL Contract

    ```glsl
struct MaterialProperties {
    // Surface BRDF parameters
    vec3  base_color;
    float roughness;
    float metallic;
    float ior;
    float specular;      // optional; could also be derived

    // Volume parameters
    vec3  sigma_s;       // scattering
    vec3  sigma_a;       // absorption
    float phase_g;       // HG parameter

    // Local emission (surface/volume glow)
    vec3  emission;
    float emission_strength;

    // Packed flags / metadata
    int   flags;
};

// Query full parameter set
MaterialProperties material_get_properties(int mat_id, vec3 p);

// Classification
bool material_has_volume(int mat_id);
bool material_is_emissive(int mat_id);
// Optional: bool material_is_delta(int mat_id), etc.
```

**Semantics:**

* `material_get_properties`:

* Returns **all** parameters needed for Interaction, at point `p`.
* May be spatially varying (textures, procedural).
* `material_has_volume`:

* True if this material defines a medium in its interior (for volumetric transport).
* `material_is_emissive`:

* True if this material has nonzero emission that should be treated as a light source locally (for e.g. glowing surfaces or media).

Material module **does not** know about scene geometry or explicit light geometry.

---

### 2.2 TS-Side Description

We separate **description of one material** and the **material system**.

```ts
type Vec3 = [number, number, number];

type MaterialPropertyValue<T> =
  | T
  | { param: string }
  | { glsl: string }; // optional: purely procedural expression

interface SurfacePropertiesDescription {
  baseColor?: MaterialPropertyValue<Vec3>;   // default [1,1,1]
  roughness?: MaterialPropertyValue<number>; // default 0.5
  metallic?:  MaterialPropertyValue<number>; // default 0.0
  ior?:       MaterialPropertyValue<number>; // default 1.5
  specular?:  MaterialPropertyValue<number>; // optional
}

interface VolumePropertiesDescription {
  sigmaS?: MaterialPropertyValue<Vec3>;
  sigmaA?: MaterialPropertyValue<Vec3>;
  phaseG?: MaterialPropertyValue<number>;
}

interface EmissionPropertiesDescription {
  emission?:          MaterialPropertyValue<Vec3>;
  emissionStrength?:  MaterialPropertyValue<number>;
}

interface MaterialDescription {
  // Optional high-level model hints (Lambert, GGX, etc.)
  model?: 'lambert' | 'ggx' | 'glass' | 'custom';

  surface?:  SurfacePropertiesDescription;
  volume?:   VolumePropertiesDescription;
  emission?: EmissionPropertiesDescription;

  // Optional flags (e.g. explicitly mark as volume, emissive, etc.)
  flags?: {
    hasVolume?: boolean;
    isEmissive?: boolean;
  };
}

interface MaterialSystemDescription {
  /** Map from material name to its description. */
  materials: Map<string, MaterialDescription>;

  /** Parameters used by materials (for uniforms). */
  parameters?: Record<string, ParameterMetadata>;
}
```

**Notes:**

* `MaterialPropertyValue<T>` allows:

    * a literal,
* a parameter reference,
* or a procedural GLSL expression (nice to have, you already do this in your current scene system).
* `flags` can override or confirm behavior if you want fast classification.

---

### 2.3 MaterialCompiler Responsibilities

    `MaterialCompiler.compile(desc: MaterialSystemDescription): ModuleDescriptor`

* **Material ID mapping**

* Assign each material name a stable `mat_id` index.
* Emit compile-time `#define` constants for those IDs:

    ```glsl
    #define MAT_AIR   0
    #define MAT_GLASS 1
    #define MAT_SMOKE 2
    ```

    * **Parameter analysis**

* Walk all `MaterialDescription`s.

* For each `MaterialPropertyValue` that’s `{ param: 'path' }`, record type and path:

    * `'mat.glass.ior'` → `float`
* `'mat.smoke.sigmaS'` → `vec3`

* Build `paramUsage: Map<string, 'float' | 'vec3' | ...>`.

* **Uniform declarations**

* For each param path, emit:

```glsl
    uniform float u_material_mat_glass_ior;
    ```

* Using the same path→uniform naming convention:

    * `u_material_<path_with_dots_replaced_by_underscores>`.

* **MaterialProperties construction**

* Generate `material_get_properties(int mat_id, vec3 p)` with a cascade of `if`/`else` (or `switch`) on `mat_id`:

Conceptually:

    ```glsl
    MaterialProperties material_get_properties(int mat_id, vec3 p) {
        MaterialProperties mp;

        // Defaults for safety
        mp.base_color = vec3(1.0);
        mp.roughness = 0.5;
        mp.metallic = 0.0;
        mp.ior = 1.5;
        mp.specular = 0.0;
        mp.sigma_s = vec3(0.0);
        mp.sigma_a = vec3(0.0);
        mp.phase_g = 0.0;
        mp.emission = vec3(0.0);
        mp.emission_strength = 0.0;
        mp.flags = 0;

        if (mat_id == MAT_GLASS) {
            // Fill from surface/volume/emission descriptions
            mp.base_color = /* uniform or literal or glsl(...) */;
            mp.ior        = /* ... */;
            // ...
        } else if (mat_id == MAT_SMOKE) {
            mp.sigma_s    = /* ... */;
            mp.sigma_a    = /* ... */;
            mp.phase_g    = /* ... */;
        }

        return mp;
    }
    ```

    * For each field:

    * If the description had a literal → inline the literal.
* If `{ param: '...' }` → use the corresponding `u_material_...` uniform.
* If `{ glsl: '...' }` → inline that expression directly.

* **Classification helpers**

* Generate:

    ```glsl
    bool material_has_volume(int mat_id) {
        if (mat_id == MAT_SMOKE) return true;
        if (mat_id == MAT_WATER) return true;
        return false;
    }

    bool material_is_emissive(int mat_id) {
        if (mat_id == MAT_EMISSIVE_PANEL) return true;
        return false;
    }
    ```

    * Or derive from description `flags` + emission fields.

* **Uniform bindings**

* For each `paramPath` in `paramUsage`:

* Build a binding:

    ```ts
      {
        uniform: 'u_material_mat_glass_ior',
        parameters: ['mat.glass.ior'],
        type: 'float',
        compute: (params) => params['mat.glass.ior'] ?? 1.5,
      }
      ```

MaterialCompiler has **no idea** about Scene objects or Lights; it just knows “material name → mat_id” and how to fill `MaterialProperties`.

---

## 3. Lights Module

### 3.1 Runtime GLSL Contract

Same conceptual interface as earlier, consistent with your current `LightsCompiler`:

```glsl
struct LightData {
    vec3 radiance;      // color * intensity
    int  sampling_type; // SAMPLING_POINT, SAMPLING_SPHERE, SAMPLING_QUAD, etc.
    vec4 param0;
    vec4 param1;
    vec4 param2;
};

struct LightSample {
    vec3 wi;        // direction to light
    vec3 position;  // point on light surface (for area lights)
    float distance;
    vec3 radiance;
    float pdf;
};

int  lighting_count();
bool lighting_has_environment();

LightData  lighting_get_light(int light_id);

LightSample lighting_sample(vec3 p);      // choose a light & sample it
float       lighting_pdf(vec3 p, vec3 wi);

vec3  lighting_environment(vec3 dir);     // env radiance
float lighting_environment_pdf(vec3 p, vec3 wi);
LightSample lighting_sample_environment(vec3 p);
```

Exactly signatures can match your current code; the key idea is that this module is self-contained and uses its own set of uniforms (`u_light_*`) derived from TS descriptions.

---

### 3.2 TS-Side Description (what you already have, reframed)

```ts
type Vec3 = [number, number, number];

type LightPropertyValue<T> = T | { param: string };
type EmissionPropertyValue<T> = T | { param: string };

interface EmissionProfile {
  color:     EmissionPropertyValue<Vec3>;
  intensity: EmissionPropertyValue<number>;
}

interface PointLightGeometry {
  type: 'point';
  id: string;
  emissionProfile: string;
  position: LightPropertyValue<Vec3>;
}

interface SphereLightGeometry {
  type: 'sphere';
  id: string;
  emissionProfile: string;
  position: LightPropertyValue<Vec3>;
  radius:   LightPropertyValue<number>;
}

interface QuadLightGeometry {
  type: 'quad';
  id: string;
  emissionProfile: string;
  center:     LightPropertyValue<Vec3>;
  width:      LightPropertyValue<number>;
  height:     LightPropertyValue<number>;
  direction1: LightPropertyValue<Vec3>;
  direction2: LightPropertyValue<Vec3>;
}

type LightGeometry = PointLightGeometry | SphereLightGeometry | QuadLightGeometry;

interface EnvironmentDescription {
  type: 'constant' | 'hdri';
  color?: Vec3;
  intensity?: number;
  hdriPath?: string;
}

interface LightingDescription {
  lights: LightGeometry[];
  emissionProfiles: Map<string, EmissionProfile>;
  environment?: EnvironmentDescription;
  parameters?: Record<string, ParameterMetadata>;
}
```

And `LightsCompiler` is essentially already doing:

    * Parameter analysis (for geometry + emission).
* Uniform generation (`u_light_*`).
* `LightData` packing (`lighting_get_light`).
* Per-type sampler generation.
* `lighting_sample` & `lighting_pdf`.
* Uniform bindings.

---

## 4. Interaction Module

### 4.1 Runtime GLSL Contract

Interaction is a mostly static library, parameterized by `MaterialProperties`.

    Surface interface:

```glsl
Spectrum interaction_surface_eval(
    const MaterialProperties mp,
    vec3 wi,
    vec3 wo,
    Frame frame
);

Spectrum interaction_surface_sample(
    const MaterialProperties mp,
    vec3 wi,
    Frame frame,
    vec2 u_bsdf,
    out vec3 wo,
    out float pdf
);
```

Volume interface:

```glsl
Spectrum interaction_volume_eval(
    const MaterialProperties mp,
    vec3 wi,
    vec3 wo
);

Spectrum interaction_volume_sample(
    const MaterialProperties mp,
    vec3 wi,
    vec2 u_phase,
    out vec3 wo,
    out float pdf
);
```

Internal implementation can:

    * Check flags in `MaterialProperties` (metallic, specular, hasVolume, etc.)
* Dispatch to specific BSDF/phase types.

    No TS-side description needed right now; it’s a static GLSL library.

---

## 5. Transport Module

### 5.1 Runtime GLSL Contract

    `transport.glsl` is the path tracer that expects the previous four modules to exist. Think:

```glsl
vec3 path_tracer_radiance(Ray rayPrimary, sampler2D rngState, ...);
```

Inside, it:

* Generates camera rays.
* Loops over bounces:

    * Calls `scene_intersect`, `scene_intersect_any`.
* Calls `material_get_properties`, `material_has_volume`, `material_is_emissive`.
* Uses `interaction_surface_*` or `interaction_volume_*`.
* Uses `lighting_sample`, `lighting_pdf`, `lighting_environment`.
* Manages Russian roulette, throughput, MIS weights, etc.

    TS-side, Transport is mostly fixed; you might have options:

    ```ts
interface TransportOptions {
  maxBounces: number;
  useNEE: boolean;
  useMIS: boolean;
  // etc.
}
```

But it doesn’t have a “description” in the sense Scene/Material/Lights do; it’s mostly code with a few options.

---

## 6. How it all fits together

At **world-build time** (in TS):

1. You construct:

    * `SceneDescription`
* `MaterialSystemDescription`
* `LightingDescription`
* (Plus parameter metadata and maybe Transport options.)

2. You run:

    * `SceneCompiler.compile(sceneDesc)` → `sceneModule`
* `MaterialCompiler.compile(materialDesc)` → `materialModule`
* `LightsCompiler.compile(lightingDesc)` → `lightsModule`

Each returns a `ModuleDescriptor` with:

* `id` (kind/name/version),
* `fragment: { constants, uniforms, functions }`,
* `uniformBindings`,
* `parameters`.

3. Engine links:

    * `sceneModule`, `materialModule`, `lightsModule`,
* `interaction.glsl` (static),
* `transport.glsl` (static),
    into one big fragment shader (or several, depending on your architecture).

4. At runtime:

    * The UI / parameter system maintains the current parameter values.
* For each frame, engine:

* Runs `uniformBindings` from each module to push updated values to GPU.
* Dispatches rendering using Transport.

---

    If you want, next step we can zoom in specifically on the **MaterialCompiler API** in TS (file layout, naming, how it plugs into your existing `ModuleDescriptor` and engine pipeline), or write a small “example world” that uses all three descriptions (Scene/Material/Lights) to render a simple test: red sphere, glass jar of smoke, and a quad light.
