# Unified Object & Light Description System (v1)

> **Goal:**
> Have **one coherent pattern** for describing:
>
> * scene **objects** (geometry + material), and
> * **lights** (geometry + emission),
    >   where both can be driven by UI parameters (uniforms), and we can cover everything from simple spheres and boxes to algebraic varieties and area lights.

We’ll first define the **data model** (what authors write in TS), then how the **compilers** turn that into GLSL + uniforms, and finally walk through concrete examples:

* Objects: sphere, box, algebraic variety
* Lights: point, sphere, quad

We *do not* use a plugin system yet; this is the “standard model”. A plugin system can be layered on later.

---

## 1. Core Concepts

### 1.1 Parameters and values

We assume each project has a global **parameter dictionary**:

```ts
parameters: Record<string, ParameterMetadata>;
```

Each parameter has at least:

```ts
interface ParameterMetadata {
  type: 'float' | 'int' | 'vec3' | 'color' /* ... */;
  default: number | [number, number, number] /* ... */;
  // plus UI info: min, max, label, etc.
}
```

Anywhere in the scene/lighting descriptions, a property can be either:

* a **literal value** (number, vec3, etc.), or
* a **parameter reference** `{ param: "path.to.param" }`.

We capture this with a generic:

```ts
type Value<T> = T | { param: string };
```

This is the *only* pattern we need to handle “this thing is controlled by a uniform”.

---

### 1.2 Modules and prefixes

We have separate **runtime modules**:

* **Scene**: objects + material IDs → `scene_intersect`, `scene_normal`, etc.
* **Lights**: light geometry + emission → `lighting_sample`, `lighting_pdf`, etc.
* **Materials** (already existing): material IDs → surface/volume properties.

Each compiler generates its own `uniform` declarations with module-specific prefixes, e.g.:

* Scene: `u_scene_<path_with_dots_replaced_by_underscores>`
* Lights: `u_light_<path_with_dots_replaced_by_underscores>`

Examples:

* `'sphere1.center'` → `u_scene_sphere1_center`
* `'key.intensity'` → `u_light_key_intensity`

Each compiler also returns **uniform bindings** telling the engine how to fill those uniforms from the global `parameters` object.

---

## 2. Object Model

### 2.1 Scene description

At a high level:

```ts
interface SceneDescription {
  objects: SceneObject[];
  materials: Map<string, MaterialDescription>;
  parameters?: Record<string, ParameterMetadata>;
}
```

We introduce a **discriminated union** for objects, but keep the built-in set small:

```ts
type SceneObject =
  | SphereObject
  | BoxObject
  | AlgebraicVarietyObject;
  // (later: MeshObject, InstanceCloudObject, etc.)
```

#### Sphere

```ts
interface SphereObject {
  type: 'sphere';
  id: string;
  material: string;          // name of material
  center: Value<[number, number, number]>;
  radius: Value<number>;
}
```

#### Box (axis-aligned, for v1)

```ts
interface BoxObject {
  type: 'box';
  id: string;
  material: string;
  center: Value<[number, number, number]>;
  halfExtents: Value<[number, number, number]>;  // half-size in each axis
}
```

#### Algebraic variety

One powerful generic primitive:

```ts
interface AlgebraicVarietyObject {
  type: 'algebraicVariety';
  id: string;
  material: string;

  center: Value<[number, number, number]>;
  size:   Value<number>;  // or vec3 if we want anisotropic scaling later
  bound:  'box' | 'sphere' | 'none';

  /**
   * A GLSL expression in terms of q (local coordinates) that defines
   * the variety f(q) = 0.
   * Example: "dot(q,q) - 1.0" or "q.x*q.x - q.y*q.y - q.z".
   */
  equation: string;
}
```

Given this:

* We can represent many shapes with a *single* object type by varying `equation`.
* `center` and `size` are used to map world-space ( p ) to local coordinates ( q ) before applying the equation.

---

### 2.2 What SceneCompiler does

For each object:

1. **Parameter analysis**

   It inspects every `Value<T>` field:

    * If it’s `{ param: 'sphere1.center' }`, record:

      ```text
      "sphere1.center" → "vec3"
      ```
    * If it’s `{ param: 'sphere1.radius' }`, record:

      ```text
      "sphere1.radius" → "float"
      ```
    * Types come either from:

        * field context (center is vec3, radius is float), or
        * `ParameterMetadata.type`.

   Result: a map `paramUsage: Map<string, 'float' | 'vec3' | ...>`.

2. **Uniform declarations**

   For each `paramPath` in `paramUsage`, generate a uniform:

   ```glsl
   uniform vec3  u_scene_sphere1_center;
   uniform float u_scene_sphere1_radius;
   ```

3. **Object SDF / intersection generation**

   For each object, dispatch on `obj.type`:

   #### Sphere case

   ```glsl
   float sdf_sphere1(vec3 p) {
     vec3 center = u_scene_sphere1_center; // or literal if not param
     float radius = u_scene_sphere1_radius;
     return length(p - center) - radius;
   }
   ```

   (for literal values, directly embed numbers instead of uniforms)

   #### Box case

   ```glsl
   float sdf_box1(vec3 p) {
     vec3 center = /* uniform or literal */;
     vec3 halfExtents = /* uniform or literal */;

     vec3 q = abs(p - center) - halfExtents;
     float outside = length(max(q, 0.0));
     float inside = min(max(q.x, max(q.y, q.z)), 0.0);
     return outside + inside;  // standard box SDF
   }
   ```

   #### Algebraic variety case

   For `algebraicVariety`:

   ```glsl
   float sdf_variety1(vec3 p) {
     vec3 center = /* uniform or literal for variety1.center */;
     float size = /* uniform or literal for variety1.size */;

     // Local coordinates
     vec3 q = (p - center) / size;

     // User equation in q; e.g. "dot(q,q) - 1.0"
     float f = dot(q,q) - 1.0;  // from obj.equation

     // Optional bounding logic based on bound:
     // - If bound == 'sphere': we know |q| < R, etc.
     // - If bound == 'box': early-outs using |q| or halfExtents.
     // For v1, this can just be "return f;" if we ignore bounds.

     return f;
   }
   ```

4. **Uniform bindings**

   For each `paramPath`:

    * Map it to its uniform name (`u_scene_<...>`),
    * Generate a binding that knows how to read from `parameters[paramPath]` at runtime and upload the value.

   Example:

   ```ts
   {
     uniform: 'u_scene_sphere1_radius',
     parameters: ['sphere1.radius'],
     type: 'float',
     compute: (params) => params['sphere1.radius'] ?? 0.5
   }
   ```

At runtime, when UI changes `parameters['sphere1.radius']`, the engine updates `u_scene_sphere1_radius`; the sphere grows/shrinks.

---

## 3. Light Model

### 3.1 Lighting description

We keep the structure you already have, but describe it in this unified “Value<T>” way:

```ts
interface LightingDescription {
  lights: LightGeometry[];
  emissionProfiles: Map<string, EmissionProfile>;
  environment?: EnvironmentDescription;
  parameters?: Record<string, ParameterMetadata>;
}
```

### 3.2 Light types

```ts
type LightGeometry =
  | PointLightGeometry
  | SphereLightGeometry
  | QuadLightGeometry;
```

#### Point light

```ts
interface PointLightGeometry {
  type: 'point';
  id: string;
  emissionProfile: string;               // name in emissionProfiles
  position: Value<[number, number, number]>;
}
```

#### Sphere light

```ts
interface SphereLightGeometry {
  type: 'sphere';
  id: string;
  emissionProfile: string;
  position: Value<[number, number, number]>;
  radius:   Value<number>;
}
```

#### Quad light

```ts
interface QuadLightGeometry {
  type: 'quad';
  id: string;
  emissionProfile: string;
  center:     Value<[number, number, number]>;
  width:      Value<number>;
  height:     Value<number>;
  direction1: Value<[number, number, number]>; // will be normalized & scaled
  direction2: Value<[number, number, number]>;
}
```

### 3.3 Emission profiles

Parallel to materials, but for lights:

```ts
type EmissionPropertyValue<T> = T | { param: string };

interface EmissionProfile {
  color:     EmissionPropertyValue<[number, number, number]>;
  intensity: EmissionPropertyValue<number>;
}
```

---

### 3.4 What LightsCompiler does

For each `LightingDescription`:

1. **Parameter analysis**

   Same idea: `Value<T> = literal | { param }`.

    * Look through `emissionProfiles` for `{ param }` in `color`, `intensity`.
    * Look through `lights` for `{ param }` in `position`, `radius`, `center`, `width`, `height`, `direction1`, `direction2`.

   Build `paramUsage: Map<string, 'vec3' | 'float'>`.

2. **Uniform declarations**

   For each param path (e.g. `'lights.key.center'`), generate:

   ```glsl
   uniform vec3 u_light_lights_key_center;
   ```

3. **Emission profile lookup**

   Generate:

   ```glsl
   struct EmissionData {
     vec3 color;
     float intensity;
   };

   EmissionData emission_profile_data(int profile_id) {
     EmissionData data;
     data.color = vec3(1.0, 0.0, 1.0); // default magenta
     data.intensity = 1.0;

     if (profile_id == EMISSION_KEY) {
       data.color = u_light_lights_key_color;       // or literal
       data.intensity = u_light_lights_key_intensity;
     }
     // ... other profiles

     return data;
   }
   ```

4. **LightData packing**

   For each light, switch on `light.type`:

   #### Point

   ```glsl
   LightData lighting_get_light(int light_id) {
     if (light_id == 0) {
       EmissionData emission = emission_profile_data(EMISSION_KEY);
       vec3 radiance = emission.color * emission.intensity;

       vec3 position = u_light_lights_key_position; // or literal

       return LightData(
         radiance,
         SAMPLING_POINT,
         vec4(position, 0.0),
         vec4(0.0),
         vec4(0.0)
       );
     }
     // ...
   }
   ```

   #### Sphere

   ```glsl
   if (light_id == i_sphere) {
     EmissionData emission = emission_profile_data(...);
     vec3 radiance = emission.color * emission.intensity;

     vec3 position = /* uniform or literal */;
     float radius  = /* uniform or literal */;

     return LightData(
       radiance,
       SAMPLING_SPHERE,
       vec4(position, radius),
       vec4(0.0),
       vec4(0.0)
     );
   }
   ```

   #### Quad

   ```glsl
   if (light_id == i_quad) {
     EmissionData emission = emission_profile_data(...);
     vec3 radiance = emission.color * emission.intensity;

     vec3 center = /* uniform or literal */;
     vec3 e1 = /* direction1 * width, using uniforms or literals */;
     vec3 e2 = /* direction2 * height */;

     return LightData(
       radiance,
       SAMPLING_QUAD,
       vec4(center, 0.0),
       vec4(e1,    0.0),
       vec4(e2,    0.0)
     );
   }
   ```

5. **Sampling & PDF**

   Using `LightData`, the compiler or hand-written code provides:

   ```glsl
   LightSample lighting_sample(Point p);
   float       lighting_pdf(Point p, Direction wi);
   ```

   This part doesn’t need to know about parameters; it just uses the values already packed into `LightData`.

6. **Uniform bindings**

   Same pattern as Scene:

   ```ts
   {
     uniform: 'u_light_lights_key_intensity',
     parameters: ['lights.key.intensity'],
     type: 'float',
     compute: (params) => params['lights.key.intensity'] ?? 20.0,
   }
   ```

---

## 4. Example Use Cases

### 4.1 Scene: A sphere and a box, both param-driven

```ts
const scene: SceneDescription = {
  objects: [
    {
      type: 'sphere',
      id: 'ball',
      material: 'mat.red',
      center: { param: 'ball.center' },
      radius: { param: 'ball.radius' },
    },
    {
      type: 'box',
      id: 'floorBox',
      material: 'mat.floor',
      center: [0, -1, 0],
      halfExtents: { param: 'floor.size' },
    }
  ],

  materials: new Map([
    ['mat.red', {
      albedo:     { param: 'mat.red.albedo' },
      roughness:  0.3,
      metallic:   0.0,
      ior:        1.5,
      emission:   [0, 0, 0],
      emission_strength: 0.0,
    }],
    ['mat.floor', {
      albedo:     [0.8, 0.8, 0.8],
      roughness:  { param: 'mat.floor.roughness' },
      metallic:   0.0,
      ior:        1.0,
      emission:   [0, 0, 0],
      emission_strength: 0.0,
    }]
  ]),

  parameters: {
    'ball.center':       { type: 'vec3',  default: [0, 0.5, 0] },
    'ball.radius':       { type: 'float', default: 0.5 },
    'floor.size':        { type: 'vec3',  default: [5, 0.1, 5] },
    'mat.red.albedo':    { type: 'color', default: [1, 0.2, 0.2] },
    'mat.floor.roughness': { type: 'float', default: 0.6 },
  }
};
```

* Sphere’s center & radius are uniforms.
* Box’s size is a uniform.
* Material albedos/roughness are also uniforms.

SceneCompiler generates all necessary `u_scene_*` uniforms and uses them in SDF + material code.

---

### 4.2 Scene: Two different algebraic varieties

```ts
const scene: SceneDescription = {
  objects: [
    {
      type: 'algebraicVariety',
      id: 'var1',
      material: 'mat.glass',
      center: { param: 'var1.center' },
      size:   1.0,
      bound:  'box',
      equation: 'dot(q,q) - 1.0', // unit sphere in local coords
    },
    {
      type: 'algebraicVariety',
      id: 'var2',
      material: 'mat.metal',
      center: [2, 0, 0],
      size:   { param: 'var2.size' },
      bound:  'sphere',
      equation: 'q.x*q.x*q.x - 3.0*q.x*q.y*q.y + q.z', // some cubic
    }
  ],

  materials: /* ... */,
  parameters: {
    'var1.center': { type: 'vec3',  default: [0, 0, 0] },
    'var2.size':   { type: 'float', default: 1.0 },
    // plus material params...
  }
};
```

* One object uses an equation that describes a sphere.
* The other uses a more complex equation.
* Both share the same `algebraicVariety` type; only `equation`, `center`, `size` differ.

SceneCompiler:

* Generates `sdf_var1` and `sdf_var2` with the appropriate center/size transforms and equations.
* Hoists `var1.center` and `var2.size` as uniforms.

---

### 4.3 Lights: point, sphere, and quad in one scene

```ts
const lighting: LightingDescription = {
  lights: [
    // Point light with param position
    {
      type: 'point',
      id: 'bulb',
      emissionProfile: 'bulbProfile',
      position: { param: 'lights.bulb.position' },
    },

    // Sphere area light with param radius
    {
      type: 'sphere',
      id: 'ballLight',
      emissionProfile: 'ballProfile',
      position: [0, 3, 0],
      radius:   { param: 'lights.ball.radius' },
    },

    // Quad area light with param center & intensity
    {
      type: 'quad',
      id: 'key',
      emissionProfile: 'keyProfile',
      center: { param: 'lights.key.center' },
      width:  2.0,
      height: 1.0,
      direction1: [1, 0, 0],
      direction2: [0, -1, 0],
    }
  ],

  emissionProfiles: new Map([
    ['bulbProfile', {
      color:     [1, 0.8, 0.7],
      intensity: { param: 'lights.bulb.intensity' },
    }],
    ['ballProfile', {
      color:     [0.7, 0.8, 1.0],
      intensity: 10,
    }],
    ['keyProfile', {
      color:     { param: 'lights.key.color' },
      intensity: { param: 'lights.key.intensity' },
    }],
  ]),

  parameters: {
    'lights.bulb.position':  { type: 'vec3',  default: [0, 2, 0] },
    'lights.bulb.intensity': { type: 'float', default: 50 },
    'lights.ball.radius':    { type: 'float', default: 0.3 },
    'lights.key.center':     { type: 'vec3',  default: [-2, 3, 1] },
    'lights.key.color':      { type: 'color', default: [1.0, 0.95, 0.9] },
    'lights.key.intensity':  { type: 'float', default: 20 },
  }
};
```

LightsCompiler:

* Creates `u_light_lights_bulb_position`, `u_light_lights_ball_radius`, etc.
* Packs each light into `LightData` with uniforms and/or literals.
* Uses `emission_profile_data` to compute radiance from color/intensity uniforms.

---

## 5. Summary

This v1 design gives you:

* A **unified, simple pattern** for everything that can be uniform-driven:

    * `Value<T> = T | { param: string }`.
* A small, explicit list of **built-in object types**:

    * `sphere`, `box`, `algebraicVariety` (with `equation` string).
* A small, explicit list of **built-in light types**:

    * `point`, `sphere`, `quad`.
* Compilers for Scene and Lights:

    * Scan for `{ param }` uses,
    * Generate `uniform`s with clear module prefixes,
    * Generate GLSL that uses those uniforms or literals,
    * Provide uniform bindings so the engine can push parameter values.

Later, you can:

* Add more object kinds (mesh, instance clouds, multi-region) to the discriminated union,
* And/or add a **plugin system** on top of this for exotic one-off shapes, without changing the core parameter/uniform story.
