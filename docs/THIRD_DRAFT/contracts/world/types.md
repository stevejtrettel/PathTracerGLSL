# types.md (Material-Based Light System)

## User Input Types

```typescript
interface SceneDescription {
  objects: UserObject[];
  materials: Map<string, MaterialDescription>;
}

interface LightDescription {
  lights: UserLight[];
  environment?: EnvironmentMap;
}

interface UserObject {
  id: string;
  geometry: Geometry;
  material: string;  // Reference to material name
  transform?: Transform;
}

interface UserLight {
  id: string;
  type: 'point' | 'directional' | 'spot' | 'quad' | 'sphere';
  intensity: vec3;
  visible?: boolean;  // If true, adds geometry to scene
  
  // Type-specific parameters
  position?: vec3;
  direction?: vec3;
  vertices?: vec3[];
  radius?: number;
}

interface MaterialDescription {
  albedo: vec3;
  roughness: number;
  metallic: number;
  ior: number;
  emission: vec3;  // [0,0,0] for non-emissive
  
  // Optional hints
  sampling_hint?: 'none' | 'bbox' | 'auto';
}
```

## Compiler Internal Types

### Scene Compiler Input

```typescript
interface SceneCompilerInput {
  objects: CompilerObject[];
  materials: CompilerMaterial[];
}

interface CompilerObject {
  id: string;
  sdf: string;  // GLSL function for SDF
  materialId: number;
  transform: mat4;
}

interface CompilerMaterial {
  id: number;
  albedo: vec3;
  roughness: number;
  metallic: number;
  ior: number;
  emission: vec3;
  light_id: number;  // -1 if non-emissive, else index into light array
  flags: number;
}
```

### Lighting Compiler Input

```typescript
interface LightingCompilerInput {
  lights: CompilerLight[];
  environment?: EnvironmentMap;
}

interface CompilerLight {
  id: string;
  radiance: vec3;
  
  // Sampling capability
  sampling: LightSampling | null;  // null = path-only
  
  // Source tracking (for debugging)
  source: 'explicit_light' | 'emissive_material' | 'visible_light';
}

interface LightSampling {
  type: 'point' | 'directional' | 'spot' | 'sphere' | 'quad' | 'bbox';
  
  // Type-specific parameters
  position?: vec3;
  direction?: vec3;
  angle?: number;
  radius?: number;
  vertices?: vec3[];
  bounds?: AABB;
}

interface EnvironmentMap {
  type: 'constant' | 'hdri';
  value?: vec3;
  path?: string;
  intensity: number;
}
```

## Light Registry

```typescript
interface LightRegistry {
  lights: CompilerLight[];
  samplableIndices: number[];  // Indices of lights that can be sampled
  
  // Statistics for optimization
  stats: {
    total: number;
    samplable: number;
    pathOnly: number;
    fromExplicitLights: number;
    fromEmissiveMaterials: number;
  };
}
```

## Compiler Outputs

```typescript
interface CompiledWorld {
  modules: {
    geometry: ModuleDescriptor;
    scene: ModuleDescriptor;
    lighting: ModuleDescriptor;
  };
  registry: LightRegistry;
  metadata: WorldMetadata;
}

interface WorldMetadata {
  counts: {
    materials: number;
    objects: number;
    lights: number;
    samplableLights: number;
  };
  
  features: {
    hasEmission: boolean;
    hasPathOnlyLights: boolean;
    hasEnvironment: boolean;
    hasVolumes: boolean;
  };
  
  // Memory layout info
  layout: {
    maxMaterialId: number;
    maxLightId: number;
  };
}

interface ModuleDescriptor {
  source: string;
  uniforms: UniformDescriptor[];
  constants: Map<string, any>;
  exports: string[];  // List of exported function names
}

interface UniformDescriptor {
  name: string;
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'sampler2D';
  arraySize?: number;
}
```

## Configuration

```typescript
interface WorldCompilerConfig {
  lightStrategy: {
    // How to handle emissive objects as lights
    mode: 'all' | 'simple' | 'none';
    
    // For future bbox sampling
    bboxAttempts?: number;
    
    // Importance threshold
    minIntensity?: number;  // Ignore very dim lights
  };
  
  optimization: {
    unrollThreshold: number;  // Unroll loops for < N objects
    inlineMaterials: boolean;  // Inline material properties if few materials
  };
  
  debug: {
    logLightAssignment: boolean;
    validateLightIndices: boolean;
    generateComments: boolean;
  };
}
```

## Runtime Types (GLSL)

```glsl
// Scene types
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;
  float emission_strength;
  int light_id;  // -1 if non-emissive, else index into light array
  int flags;
}

struct Hit {
  // Geometric data
  Point p;
  Normal n;
  vec2 uv;
  float t;
  
  // Material interface (no object_id!)
  int material_from;
  int material_to;
  
  // Frame
  Frame frame;
}

// Lighting types
struct LightData {
  vec3 radiance;
  int sampling_type;  // SAMPLING_NONE, SAMPLING_POINT, etc.
  vec4 param0;  // Position or other params
  vec4 param1;  // Additional params
}

struct LightSample {
  Point point;
  Direction wi;
  vec3 radiance;
  float pdf;
  float distance;
}
```

## Compiler Interfaces

```typescript
class SceneCompiler {
  compile(input: SceneCompilerInput): ModuleDescriptor;
}

class LightingCompiler {
  compile(input: LightingCompilerInput): ModuleDescriptor;
}

class WorldCompiler {
  constructor(config: WorldCompilerConfig);
  
  compile(
    scene: SceneDescription,
    lights: LightDescription,
    geometryModule: string
  ): CompiledWorld;
}
```

## Key Design Principles

1. **Materials reference lights** - Each material knows its light_id directly
2. **Unified light handling** - All light sources are managed uniformly
3. **No object tracking** - Hit doesn't need object_id
4. **Simple registry** - Just a list of lights and which can be sampled
5. **Clear separation** - Geometry, materials, and lights are orthogonal concerns

This design eliminates the complex cross-reference system while maintaining all necessary information for correct MIS calculations.
