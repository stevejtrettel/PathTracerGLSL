# Volumetric Transport Architecture: Scene Exports, Transport Imports

## 1. Overview and Key Insight

### 1.1. The Core Problem

Volumetric rendering requires specialized transport logic (scattering, absorption, phase functions) that needs efficient access to geometry (containment checks, boundary crossing). The challenge is organizing this without:
- Duplicating transport logic across generated functions
- Paying dispatch overhead at every volume step
- Creating circular dependencies between modules

### 1.2. The Solution: Reversed Dependencies

**Key insight**: Scene compiles first and exports geometry query functions. Transport compiles second, sees what volumetric regions exist, and generates handlers that call Scene's functions.

```
Material (compiles 1st)
    ↓ (exports material IDs)
Scene (compiles 2nd)
    ↓ (exports geometry functions + metadata)
Transport (compiles 3rd)
    ↓ (imports Scene, generates handlers)
Engine (compiles 4th)
```

**Dependency direction**: Transport depends on Scene (higher-level depends on lower-level). Clean and natural.

**Performance**: Scene provides specialized geometry functions per region. Transport calls them directly - no dispatch overhead at volume steps.

**Modularity**: All transport physics lives in Transport's code generator. Scene knows nothing about scattering, phase functions, or Beer's law.

---

## 2. Module Responsibilities

### 2.1. Scene Module

**Compiles**: After Material, before Transport

**Inputs**:
- Scene description (objects, geometry)
- Material module metadata (material IDs)

**Analyzes**:
- Which objects/regions are volumetric (based on material properties)
- Geometry for each volumetric region

**Generates**:
- Standard functions: `scene_intersect()`, `scene_material_properties()`, etc.
- Per-object distance functions: `sdf_{object}_distance()`
- **Per-volumetric-region geometry functions**: `sdf_region_{ID}_*()` (see §3)

**Exports**:
- All GLSL functions
- **Metadata**: List of volumetric regions with IDs and material IDs

**Does NOT**:
- Generate transport logic
- Know about scattering, phase functions, Russian roulette
- Call Transport functions

### 2.2. Transport Module

**Compiles**: After Scene

**Inputs**:
- Scene module (as import)
- Scene metadata (volumetric regions list)
- Transport configuration (max bounces, sampling strategies)

**Analyzes**:
- Which volume handlers need to be generated (from Scene metadata)

**Generates**:
- Volume handler functions: `handle_volume_{ID}()` for each volumetric region
- Path tracing loop: `pathTrace()` with dispatch to handlers
- All transport logic: scattering, phase functions, absorption, Russian roulette

**Imports** (from Scene):
- Geometry query functions for each region
- `scene_intersect()`
- Material query functions

**Does NOT**:
- Generate geometry functions
- Know about specific SDF formulas

---

## 3. Scene Exports for Volumetric Regions

### 3.1. Region Identification

During scene compilation, Scene analyzes materials to identify volumetric regions:

```typescript
// In Scene compiler
import { MaterialModuleOutput } from './material-compiler';

function analyzeVolumetricRegions(
  scene: SceneDescription,
  materials: MaterialModuleOutput
): VolumetricRegion[] {
  const volumetricRegions: VolumetricRegion[] = [];
  
  for (const object of scene.objects) {
    // Get material properties
    const materialId = materials.materialIdMap[object.material];
    const matProps = materials.materialProperties[materialId];
    
    // Check if volumetric (has scattering)
    if (hasScattering(matProps)) {
      volumetricRegions.push({
        regionId: assignRegionId(),
        objectId: object.id,
        materialId: materialId,
        geometry: object.geometry
      });
    }
    
    // For multi-region objects, check each region
    if (isMultiRegion(object)) {
      for (const region of object.geometry.regions) {
        const matId = materials.materialIdMap[object.materials[region.materialSlot]];
        const matProps = materials.materialProperties[matId];
        
        if (hasScattering(matProps)) {
          volumetricRegions.push({
            regionId: assignRegionId(),
            objectId: object.id,
            regionName: region.name,
            materialId: matId,
            geometry: object.geometry,
            regionInfo: region
          });
        }
      }
    }
  }
  
  return volumetricRegions;
}

function hasScattering(matProps: MaterialProperties): boolean {
  // Material is volumetric if scattering coefficient is non-zero
  return matProps.scattering && length(matProps.scattering) > 0.0;
}
```

### 3.2. Generated Geometry Functions

For each volumetric region, Scene generates a suite of geometry query functions:

#### Distance Function
```glsl
float sdf_region_{ID}_distance(vec3 p) {
  // Inline the SDF for this region
  // Example for a box at (0,2,0) with size (1,1,1):
  return box_sdf(p, vec3(0.0, 2.0, 0.0), vec3(1.0, 1.0, 1.0));
}
```

#### Containment Check
```glsl
bool sdf_region_{ID}_contains(vec3 p) {
  return sdf_region_{ID}_distance(p) < 0.0;
}
```

**Note**: This is a simple wrapper, but it provides a clear semantic interface. Transport calls "contains" not "distance < 0".

#### Exit Marching
```glsl
float sdf_region_{ID}_march_exit(vec3 p, vec3 dir) {
  // March from p along dir until we exit (distance > 0)
  const float MAX_DIST = 10.0;
  const float STEP = 0.01;
  
  for (float t = 0.001; t < MAX_DIST; t += STEP) {
    vec3 test_p = p + t * dir;
    if (sdf_region_{ID}_distance(test_p) > 0.0) {
      // Refine with binary search
      float t_min = t - STEP;
      float t_max = t;
      
      for (int i = 0; i < 8; i++) {
        float t_mid = (t_min + t_max) * 0.5;
        if (sdf_region_{ID}_distance(p + t_mid * dir) < 0.0) {
          t_min = t_mid;
        } else {
          t_max = t_mid;
        }
      }
      
      return t_max;
    }
  }
  
  return MAX_DIST;
}
```

**Note**: This march starts from **inside** the volume and finds the exit. Different from the marching in `scene_intersect` which marches from outside.

#### Normal Computation
```glsl
vec3 sdf_region_{ID}_normal(vec3 p) {
  const float h = 0.0001;
  float d = sdf_region_{ID}_distance(p);
  
  return normalize(vec3(
    sdf_region_{ID}_distance(p + vec3(h, 0.0, 0.0)) - d,
    sdf_region_{ID}_distance(p + vec3(0.0, h, 0.0)) - d,
    sdf_region_{ID}_distance(p + vec3(0.0, 0.0, h)) - d
  ));
}
```

### 3.3. Multi-Region Objects

For multi-region objects like a snow globe with volumetric water inside:

```glsl
// Region 3: water inside snow globe
float sdf_region_3_distance(vec3 p) {
  vec3 center = vec3(0.0, 1.0, 0.0);
  vec3 centered = p - center;
  float r = length(centered);
  
  float outer_r = 1.2;
  float inner_r = outer_r - 0.08;  // glass thickness
  
  // Distance to inner sphere (water boundary)
  float d_inner = r - inner_r;
  
  // Distance to water level plane
  float water_cutoff = center.y + 0.75 * inner_r;
  float d_water_level = p.y - water_cutoff;
  
  // Union of constraints: inside inner sphere AND below water level
  return max(d_inner, d_water_level);
}
```

The other functions (`contains`, `march_exit`, `normal`) are generated using this distance function.

### 3.4. Metadata Export

Scene exports structured metadata about volumetric regions:

```typescript
interface SceneModuleOutput {
  module: ModuleDescriptor;  // GLSL code
  
  metadata: {
    volumetricRegions: VolumetricRegionMetadata[];
    // ... other metadata
  };
}

interface VolumetricRegionMetadata {
  regionId: number;           // Globally unique ID
  objectId: string;           // Source object
  regionName?: string;        // For multi-region objects
  materialId: number;         // Which material (for Transport to query properties)
  functionPrefix: string;     // e.g., 'sdf_region_3'
}
```

**Example**:
```typescript
{
  volumetricRegions: [
    {
      regionId: 3,
      objectId: 'smoke_cube',
      materialId: 5,
      functionPrefix: 'sdf_region_3'
    },
    {
      regionId: 7,
      objectId: 'snow_globe',
      regionName: 'water',
      materialId: 8,
      functionPrefix: 'sdf_region_7'
    }
  ]
}
```

---

## 4. Transport Code Generation

### 4.1. Volume Handler Template

Transport defines the **template logic** for volume scattering as a code generator:

```typescript
// In Transport compiler
function generateVolumeHandler(region: VolumetricRegionMetadata): string {
  const id = region.regionId;
  const prefix = region.functionPrefix;
  
  return `
void handle_volume_${id}(inout Ray ray, inout vec3 throughput, inout vec3 radiance) {
  vec3 pos = ray.origin;
  vec3 dir = ray.direction;
  
  // Get material properties
  MaterialProperties mat = scene_material_properties(${region.materialId}, pos);
  
  // Volume transport loop
  for (int step = 0; step < MAX_VOLUME_STEPS; step++) {
    // Sample scattering distance (Transport logic)
    float sigma_t = length(mat.scattering) + length(mat.absorption);
    float t_scatter = -log(max(random(), 1e-6)) / sigma_t;
    
    vec3 next_pos = pos + t_scatter * dir;
    
    // Check if still inside volume (Scene geometry)
    if (!${prefix}_contains(next_pos)) {
      // Exiting volume - find exact boundary
      float t_exit = ${prefix}_march_exit(pos, dir);
      pos = pos + t_exit * dir;
      
      // Apply absorption to boundary (Transport logic)
      vec3 transmittance = exp(-mat.absorption * t_exit);
      throughput *= transmittance;
      
      // Refract at boundary (Transport logic)
      vec3 n = ${prefix}_normal(pos);
      float eta_ratio = mat.ior / 1.0;  // exiting to air
      vec3 refracted = refract(dir, n, eta_ratio);
      
      if (length(refracted) > 0.0) {
        dir = refracted;
      } else {
        // Total internal reflection
        dir = reflect(dir, n);
      }
      
      // Exit handler - ray is now outside
      ray.origin = pos + 0.001 * dir;
      ray.direction = dir;
      return;
    }
    
    // Scattering event inside volume (Transport logic)
    pos = next_pos;
    
    // Apply transmittance
    vec3 transmittance = exp(-mat.absorption * t_scatter);
    throughput *= transmittance * mat.scattering / sigma_t;
    
    // Sample phase function
    dir = sample_henyey_greenstein(dir, mat.phase_g);
    
    // Russian roulette
    float survival_prob = max_component(throughput);
    if (survival_prob < 0.1) {
      if (random() > survival_prob) {
        throughput = vec3(0.0);
        return;
      }
      throughput /= survival_prob;
    }
  }
  
  // Exceeded max steps - terminate
  ray.origin = pos;
  ray.direction = dir;
}
`;
}
```

**Key properties**:
- All transport logic (sampling, scattering, absorption, Russian roulette) is in the template
- Geometry queries call Scene's functions via `${prefix}_contains()`, `${prefix}_march_exit()`, etc.
- Template instantiated once per volumetric region

### 4.2. Path Tracer Generation

Transport also generates the main path tracing loop, parameterized by the scene:

```typescript
function generatePathTracer(volumetricRegions: VolumetricRegionMetadata[]): string {
  // Generate dispatch cases
  const dispatchCases = volumetricRegions.map(region => 
    `if (hit.region_id == ${region.regionId}) {
      handle_volume_${region.regionId}(ray, throughput, radiance);
      continue;  // Back to top of bounce loop
    }`
  ).join(' else ');
  
  return `
vec3 pathTrace(Ray initial_ray) {
  Ray ray = initial_ray;
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  
  for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    Hit hit;
    if (!scene_intersect(ray, hit)) {
      // Missed - sample environment
      radiance += throughput * sample_environment(ray.direction);
      break;
    }
    
    ray.origin = hit.p;
    
    // Get material properties
    MaterialProperties mat = scene_material_properties(hit.material_to, hit.p);
    
    // Dispatch to volume handlers
    ${dispatchCases}
    
    // If we get here, it's a surface interaction
    
    // Add emission
    if (length(mat.emission) > 0.0) {
      radiance += throughput * mat.emission * mat.emission_strength;
    }
    
    // Sample BRDF
    vec3 brdf_value;
    float pdf;
    vec3 new_dir = sample_brdf(mat, -ray.direction, hit.n, brdf_value, pdf);
    
    if (pdf < 1e-6) break;
    
    throughput *= brdf_value / pdf;
    ray.direction = new_dir;
    
    // Russian roulette
    float survival_prob = max_component(throughput);
    if (survival_prob < 0.1) {
      if (random() > survival_prob) break;
      throughput /= survival_prob;
    }
  }
  
  return radiance;
}
`;
}
```

### 4.3. Compilation Flow

```typescript
// Transport compiler main function
export function compileTransport(
  sceneModule: SceneModuleOutput,
  transportConfig: TransportConfig
): TransportModuleOutput {
  
  const functions: string[] = [];
  
  // Generate volume handlers from Scene metadata
  for (const region of sceneModule.metadata.volumetricRegions) {
    const handler = generateVolumeHandler(region);
    functions.push(handler);
  }
  
  // Generate path tracer (dispatches to handlers)
  const pathTracer = generatePathTracer(sceneModule.metadata.volumetricRegions);
  functions.push(pathTracer);
  
  // Generate helper functions (phase sampling, BRDF, etc.)
  functions.push(generateHelperFunctions());
  
  // Build module descriptor
  return {
    module: {
      id: { kind: 'transport', name: 'path_tracing', version: '1.0.0' },
      fragment: {
        functions: functions.join('\n\n'),
        // No uniforms - Scene and Material handle those
      },
      imports: [
        sceneModule.module.id,        // Import Scene functions
        materialModule.module.id      // Import Material functions
      ],
      exports: ['pathTrace']
    }
  };
}
```

---

## 5. Performance Analysis

### 5.1. Cost of Volume Handler Dispatch

**When**: Once per volume entry
**Cost**: One conditional per volumetric region (if-else chain or switch)

Example with 3 volumetric regions:
```glsl
if (hit.region_id == 3) {
  handle_volume_3(ray, throughput, radiance);
} else if (hit.region_id == 7) {
  handle_volume_7(ray, throughput, radiance);
} else if (hit.region_id == 12) {
  handle_volume_12(ray, throughput, radiance);
}
```

For scenes with many volumetric objects, could use switch:
```glsl
switch (hit.region_id) {
  case 3: handle_volume_3(ray, throughput, radiance); break;
  case 7: handle_volume_7(ray, throughput, radiance); break;
  case 12: handle_volume_12(ray, throughput, radiance); break;
}
```

**Frequency**: Happens once when ray enters volume, not at every scatter step.

### 5.2. Cost Inside Volume Handler

Inside `handle_volume_3`, at each scatter step:

```glsl
// Containment check
if (!sdf_region_3_contains(next_pos)) {
  // which expands to:
  if (!(box_sdf(next_pos, center, size) < 0.0)) {
```

**Cost**: Direct function call to `sdf_region_3_contains()` which calls `sdf_region_3_distance()`.

**Compiler optimization**: These are simple functions with no branching - the compiler can inline them. Result is essentially:
```glsl
if (!(box_sdf(next_pos, center, size) < 0.0)) {
```

No dispatch, no switch, just the SDF evaluation.

**Frequency**: Once per scatter step. For a ray taking 50 steps through fog, that's 50 evaluations of `box_sdf`, not 50 switches over all objects.

### 5.3. Comparison to Alternatives

**Alternative 1: Generic containment query with dispatch**
```glsl
// Bad: dispatches at every step
if (!inside_region(next_pos, current_region_id)) {
  // inside_region internally does:
  switch (region_id) { ... }  // switch on EVERY step
}
```
**Cost**: Switch statement at every volume step

**Our approach**:
```glsl
// Good: direct call, compiler can inline
if (!sdf_region_3_contains(next_pos)) {
  // Direct call to known function, no dispatch
}
```
**Cost**: Function call (inlined) at every volume step

**Alternative 2: Fully generic volume handler**
```glsl
void handle_volume_generic(int region_id, ...) {
  while (true) {
    // Need to dispatch for EVERY geometry query
    if (!inside_region(next_pos, region_id)) { ... }  // dispatch
    vec3 n = compute_normal(pos, region_id); // dispatch
    float t = march_exit(pos, dir, region_id); // dispatch
  }
}
```
**Cost**: Multiple dispatches at every step

**Our approach**: Zero dispatches inside handler, just direct calls.

---

## 6. Benefits

### 6.1. Clean Module Separation

**Scene**:
- Knows geometry
- Generates distance/containment/exit functions
- Exports metadata about what exists

**Transport**:
- Knows physics
- Generates transport handlers
- Uses Scene's geometry functions

No circular dependencies, no crossing concerns.

### 6.2. No Code Duplication

All transport logic lives in **one place**: the template generator in Transport compilation.

Scattering logic:
```typescript
// Written once in Transport compiler
dir = sample_henyey_greenstein(dir, mat.phase_g);
```

Gets instantiated into every handler, but it's the **same source**, not copied-and-pasted GLSL.

### 6.3. Performance

- Single dispatch when entering volume (acceptable)
- Direct function calls for geometry (fast, inlineable)
- No per-step dispatching (critical)

### 6.4. Extensibility

**Adding new volume handler behavior**:
Just modify the template generator in Transport. All handlers regenerate with new logic.

**Adding new geometry types**:
Scene generates the same interface functions (`distance`, `contains`, `march_exit`, `normal`) regardless of underlying representation (SDF, mesh, implicit surface, etc.). Transport doesn't care.

### 6.5. Debuggability

Generated code is readable:
```glsl
void handle_volume_3(inout Ray ray, ...) {
  // Clear structure: setup, loop, scattering, exit
  // Calls named functions: sdf_region_3_contains()
}
```

Not a switch statement with 100 cases.

---

## 7. Implementation Details

### 7.1. Scene Compilation Phase

```typescript
// In scene-compiler.ts

export function compileScene(
  sceneDesc: SceneDescription,
  materialModule: MaterialModuleOutput
): SceneModuleOutput {
  
  // Phase 1: Identify volumetric regions
  const volumetricRegions = analyzeVolumetricRegions(sceneDesc, materialModule);
  
  // Phase 2: Generate standard functions
  const intersectCode = generateSceneIntersect(sceneDesc);
  const materialQueryCode = generateMaterialQuery(sceneDesc);
  
  // Phase 3: Generate per-region geometry functions
  const regionFunctions: string[] = [];
  for (const region of volumetricRegions) {
    regionFunctions.push(generateRegionDistance(region));
    regionFunctions.push(generateRegionContains(region));
    regionFunctions.push(generateRegionMarchExit(region));
    regionFunctions.push(generateRegionNormal(region));
  }
  
  // Phase 4: Assemble module
  const module: ModuleDescriptor = {
    id: { kind: 'scene', name: 'scene', version: '1.0.0' },
    fragment: {
      functions: [
        intersectCode,
        materialQueryCode,
        ...regionFunctions
      ].join('\n\n')
    },
    exports: [
      'scene_intersect',
      ...volumetricRegions.map(r => `${r.functionPrefix}_distance`),
      ...volumetricRegions.map(r => `${r.functionPrefix}_contains`),
      ...volumetricRegions.map(r => `${r.functionPrefix}_march_exit`),
      ...volumetricRegions.map(r => `${r.functionPrefix}_normal`)
    ]
  };
  
  return {
    module,
    metadata: {
      volumetricRegions,
      // ... other metadata
    }
  };
}
```

### 7.2. Transport Compilation Phase

```typescript
// In transport-compiler.ts

export function compileTransport(
  sceneModule: SceneModuleOutput,
  materialModule: MaterialModuleOutput,
  config: TransportConfig
): TransportModuleOutput {
  
  const functions: string[] = [];
  
  // Import Scene and Material modules
  const imports = [sceneModule.module.id, materialModule.module.id];
  
  // Generate volume handlers
  for (const region of sceneModule.metadata.volumetricRegions) {
    functions.push(generateVolumeHandler(region));
  }
  
  // Generate path tracer
  functions.push(generatePathTracer(
    sceneModule.metadata.volumetricRegions,
    config
  ));
  
  // Generate helper functions
  functions.push(generatePhaseFunction());
  functions.push(generateBRDFSampling());
  functions.push(generateRussianRoulette());
  
  return {
    module: {
      id: { kind: 'transport', name: 'path_tracing', version: '1.0.0' },
      fragment: {
        functions: functions.join('\n\n')
      },
      imports,
      exports: ['pathTrace']
    }
  };
}
```

### 7.3. Shader Assembly

The final shader is assembled by combining modules:

```glsl
// Assembled shader

// === Material module ===
struct MaterialProperties { ... };
MaterialProperties scene_material_properties(int mat_id, vec3 p) { ... }

// === Scene module ===
bool scene_intersect(Ray ray, out Hit hit) { ... }
float sdf_region_3_distance(vec3 p) { ... }
bool sdf_region_3_contains(vec3 p) { ... }
float sdf_region_3_march_exit(vec3 p, vec3 dir) { ... }
vec3 sdf_region_3_normal(vec3 p) { ... }

// === Transport module ===
void handle_volume_3(inout Ray ray, ...) {
  // Calls sdf_region_3_* functions above
}

vec3 pathTrace(Ray ray) {
  // Calls scene_intersect, handle_volume_*, etc.
}

// === Engine module ===
void main() {
  Ray ray = generateCameraRay();
  vec3 color = pathTrace(ray);
  fragColor = vec4(color, 1.0);
}
```

---

## 8. Edge Cases and Considerations

### 8.1. Nested Volumes

**Example**: Glass sphere with smoke inside

**Solution**: Model as multi-region object with two volumetric regions:
- Region 3: glass shell (volumetric if frosted, else use glass trace)
- Region 7: interior smoke

Each gets its own handler. When ray exits smoke and hits inner glass surface, `scene_intersect` is called again, which returns the glass region, dispatches to `handle_volume_3`.

### 8.2. Non-Volumetric Materials in Same Object

**Example**: Snow globe with glass shell (non-scattering) and water (scattering)

**Solution**: Scene only generates volume handlers for scattering regions. Glass shell is handled as surface interaction (refraction at boundaries). Hit struct differentiates:
```glsl
if (hit.region_id == glass_shell_region) {
  // Surface refraction
  ray.direction = refract(ray.direction, hit.n, ...);
} else if (hit.region_id == water_region) {
  // Volume handler
  handle_volume_7(ray, ...);
}
```

### 8.3. Thin Volumetric Shells

**Example**: Thin layer of fog around an object

The geometry functions handle this naturally:
```glsl
float sdf_region_5_distance(vec3 p) {
  float outer = sphere_sdf(p, center, outer_radius);
  float inner = sphere_sdf(p, center, inner_radius);
  return max(outer, -inner);  // shell SDF
}
```

The `march_exit` function will quickly find the exit (shell is thin), and transport logic accumulates appropriate transmittance.

### 8.4. Exit Refraction

When exiting a volume, need to handle refraction at the boundary:

```glsl
// In generated handler
vec3 n = sdf_region_3_normal(pos);
float eta_ratio = mat.ior / 1.0;  // volume to air
vec3 refracted = refract(dir, n, eta_ratio);

if (length(refracted) > 0.0) {
  dir = refracted;
} else {
  // Total internal reflection - stay inside!
  dir = reflect(dir, n);
  // Don't exit, continue scattering
  continue;
}
```

This logic is in the template, so all handlers get it.

### 8.5. Multiple Materials with Same Region

If two different volumetric regions use the same material (e.g., two separate smoke clouds), they still get separate handlers because their **geometry** differs:

```glsl
// Smoke cloud 1 (region 3)
bool sdf_region_3_contains(vec3 p) {
  return box_sdf(p, vec3(0, 2, 0), vec3(1, 1, 1)) < 0.0;
}

// Smoke cloud 2 (region 8)
bool sdf_region_8_contains(vec3 p) {
  return sphere_sdf(p, vec3(5, 1, 0), 1.5) < 0.0;
}
```

Both call the same material properties (`scene_material_properties(smoke_mat_id, p)`), but use different geometry functions.

---

## 9. Future Optimizations

### 9.1. Adaptive Step Size

Currently, volume handlers use fixed maximum steps (`MAX_VOLUME_STEPS`). Could add:

```glsl
// In template generator
int max_steps = estimateStepsNeeded(region.geometry, mat.scattering);
for (int step = 0; step < max_steps; step++) { ... }
```

Scene could provide hints about geometry complexity.

### 9.2. Importance Sampling

For anisotropic media or directional lighting, could importance sample scattering directions:

```typescript
// In template generator
if (config.useImportanceSampling) {
  return `dir = sample_phase_importance(dir, mat.phase_g, light_dir);`;
} else {
  return `dir = sample_henyey_greenstein(dir, mat.phase_g);`;
}
```

### 9.3. Delta Tracking

For heterogeneous volumes (varying density), could use delta tracking instead of ray marching:

```typescript
// Alternative template for heterogeneous volumes
function generateDeltaTrackingHandler(region: VolumetricRegionMetadata): string {
  // Different algorithm, same geometry interface
}
```

Scene's geometry functions stay the same.

### 9.4. Caching Geometry Queries

If SDF evaluation is expensive, could cache:

```glsl
// At handler entry
float entry_distance = sdf_region_3_distance(ray.origin);

// Use cached value to estimate when to check again
vec3 next_pos = pos + t * dir;
if (t > entry_distance * 0.8) {  // getting close to boundary
  if (!sdf_region_3_contains(next_pos)) { ... }
}
```

This is a Transport optimization that uses Scene's functions strategically.

---

## 10. Testing Strategy

### 10.1. Unit Testing

**Scene module**:
- Test geometry function generation for simple shapes
- Verify containment functions match distance functions
- Test exit marching finds correct boundaries

**Transport module**:
- Test volume handler generation produces valid GLSL
- Test path tracer dispatch logic
- Test phase function sampling (unit hemisphere tests)

### 10.2. Integration Testing

**Simple scenes**:
1. Single homogeneous volume (smoke cube)
2. Single sphere with subsurface scattering
3. Glass shell with water inside
4. Multiple non-overlapping volumes

**Validation**:
- Single scattering matches analytic solutions
- Energy conservation (throughput doesn't explode)
- Absorption behaves correctly (Beer's law)

### 10.3. Visual Testing

Render reference scenes and compare:
- Cornell box with fog
- Glass sphere in participating medium
- Subsurface scattering (jade, wax, skin)

---

## 11. Migration Path

For existing codebase:

### 11.1. Phase 1: Scene Exports
1. Modify Scene compiler to identify volumetric regions
2. Generate geometry functions (`distance`, `contains`, `march_exit`, `normal`)
3. Export metadata about volumetric regions
4. **Don't break existing code** - Scene still provides `scene_intersect` as before

### 11.2. Phase 2: Transport Stub
1. Create Transport compiler that reads Scene metadata
2. Generate trivial volume handlers (just exit immediately)
3. Generate path tracer that dispatches to handlers
4. **Verify compilation pipeline** - modules link correctly

### 11.3. Phase 3: Implement Scattering
1. Fill in volume handler template with scattering logic
2. Add phase function sampling
3. Add absorption/transmittance
4. Test with simple scenes

### 11.4. Phase 4: Optimize
1. Profile generated code
2. Add Russian roulette
3. Refine exit marching (binary search)
4. Add adaptive step sizes

---

## 12. Success Criteria

This architecture succeeds if:

1. ✅ **Clean separation**: Scene knows geometry, Transport knows physics
2. ✅ **Performance**: No per-step dispatch, direct geometry calls
3. ✅ **No duplication**: Transport logic written once, instantiated many times
4. ✅ **Extensibility**: New transport algorithms don't require Scene changes
5. ✅ **Debuggability**: Generated code is readable and traceable
6. ✅ **Correctness**: Produces physically plausible results

---

## 13. Conclusion

The key insight is **reversing the dependency**: Scene compiles first and exports geometry functions, Transport compiles second and generates handlers that call those functions.

This gives us:
- **Performance**: Direct calls, no dispatch overhead in critical loops
- **Modularity**: Clear boundaries between geometry and physics
- **Maintainability**: Transport logic in one place, not scattered across generated code
- **Flexibility**: Transport can experiment with different algorithms (delta tracking, importance sampling) without touching Scene

The architecture is simple, fast, and clean. Scene exports specialized geometry queries per region, Transport imports them and generates handlers that use them efficiently.
