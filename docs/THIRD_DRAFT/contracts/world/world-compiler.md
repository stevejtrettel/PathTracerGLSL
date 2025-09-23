# WorldCompiler

## Purpose
Orchestrates compilation of World modules from scene and light descriptions. The key task is unifying lights from two sources (explicit lights and emissive materials) into a single light array that materials can reference directly.

## Core Architecture

The WorldCompiler transforms user-friendly descriptions into optimized GLSL modules with a straightforward pipeline:

```typescript
class WorldCompiler {
  private sceneCompiler = new SceneCompiler();
  private lightingCompiler = new LightingCompiler();
  private lightRegistry: LightRegistry;
  
  constructor(private config: WorldCompilerConfig) {}
}
```

## The Compilation Pipeline

### Step 1: Collect All Lights

The first step is gathering lights from both sources:

```typescript
private collectLights(
  scene: SceneDescription, 
  lights: LightDescription
): CompilerLight[] {
  const allLights: CompilerLight[] = [];
  
  // Add explicit lights
  for (const light of lights.lights) {
    allLights.push({
      id: light.id,
      radiance: light.intensity,
      sampling: this.createSamplingStrategy(light),
      source: light.visible ? 'visible_light' : 'explicit_light'
    });
  }
  
  // Find and add emissive materials as lights
  for (const [matName, mat] of scene.materials) {
    if (this.isEmissive(mat)) {
      const light = this.createLightFromMaterial(matName, mat);
      if (light) allLights.push(light);
    }
  }
  
  return allLights;
}
```

### Step 2: Determine Sampling Strategies

For each light, decide if and how it can be sampled:

```typescript
private createSamplingStrategy(light: UserLight): LightSampling | null {
  switch (light.type) {
    case 'point':
      return {
        type: 'point',
        position: light.position
      };
      
    case 'sphere':
      return {
        type: 'sphere',
        position: light.position,
        radius: light.radius
      };
      
    case 'quad':
      return {
        type: 'quad',
        vertices: light.vertices
      };
      
    // ... other light types
  }
}

private createLightFromMaterial(
  name: string, 
  mat: MaterialDescription
): CompilerLight | null {
  // Simple heuristic: only create lights for significant emission
  const intensity = luminance(mat.emission);
  if (intensity < this.config.lightStrategy.minIntensity) {
    return null;  // Too dim to bother
  }
  
  // For now, emissive materials are path-only
  // Future: analyze geometry for sampling capability
  return {
    id: `emissive_${name}`,
    radiance: mat.emission,
    sampling: null,  // Path-only
    source: 'emissive_material'
  };
}
```

### Step 3: Assign Light IDs to Materials

Materials need to know their light ID for emission:

```typescript
private assignLightIds(
  materials: Map<string, MaterialDescription>,
  lights: CompilerLight[]
): CompilerMaterial[] {
  const compiled: CompilerMaterial[] = [];
  let materialId = 0;
  
  for (const [name, mat] of materials) {
    let lightId = -1;
    
    // Find corresponding light if emissive
    if (this.isEmissive(mat)) {
      const light = lights.find(l => 
        l.source === 'emissive_material' && 
        l.id === `emissive_${name}`
      );
      if (light) {
        lightId = lights.indexOf(light);
      }
    }
    
    compiled.push({
      id: materialId++,
      albedo: mat.albedo,
      roughness: mat.roughness,
      metallic: mat.metallic,
      ior: mat.ior,
      emission: mat.emission,
      light_id: lightId,  // Direct reference!
      flags: this.computeFlags(mat)
    });
  }
  
  return compiled;
}
```

### Step 4: Build Light Registry

Create the registry with sampling information:

```typescript
private buildRegistry(lights: CompilerLight[]): LightRegistry {
  const samplableIndices: number[] = [];
  
  lights.forEach((light, index) => {
    if (light.sampling !== null) {
      samplableIndices.push(index);
    }
  });
  
  return {
    lights,
    samplableIndices,
    stats: {
      total: lights.length,
      samplable: samplableIndices.length,
      pathOnly: lights.length - samplableIndices.length,
      fromExplicitLights: lights.filter(l => 
        l.source === 'explicit_light' || l.source === 'visible_light'
      ).length,
      fromEmissiveMaterials: lights.filter(l => 
        l.source === 'emissive_material'
      ).length
    }
  };
}
```

### Step 5: Handle Visible Lights

Lights marked `visible: true` need to be added as objects:

```typescript
private augmentSceneWithVisibleLights(
  objects: UserObject[],
  lights: UserLight[]
): UserObject[] {
  const augmented = [...objects];
  
  for (const light of lights.filter(l => l.visible)) {
    augmented.push({
      id: `light_geom_${light.id}`,
      geometry: this.createGeometryForLight(light),
      material: `_light_material_${light.id}`,  // Special material
      transform: { position: light.position }
    });
  }
  
  return augmented;
}
```

### Step 6: Compile Modules

With everything prepared, compile the final modules:

```typescript
compile(
  scene: SceneDescription,
  lights: LightDescription,
  geometryModule: string
): CompiledWorld {
  // 1. Collect all lights
  const allLights = this.collectLights(scene, lights);
  
  // 2. Build registry
  const registry = this.buildRegistry(allLights);
  
  // 3. Prepare materials with light IDs
  const materials = this.assignLightIds(scene.materials, allLights);
  
  // 4. Augment scene with visible lights
  const objects = this.augmentSceneWithVisibleLights(
    scene.objects, 
    lights.lights
  );
  
  // 5. Compile modules
  const sceneModule = this.sceneCompiler.compile({
    objects: this.compileObjects(objects),
    materials
  });
  
  const lightingModule = this.lightingCompiler.compile({
    lights: allLights,
    environment: lights.environment
  });
  
  // 6. Generate metadata
  const metadata = this.generateMetadata(objects, materials, registry);
  
  return {
    modules: {
      geometry: { source: geometryModule, /* ... */ },
      scene: sceneModule,
      lighting: lightingModule
    },
    registry,
    metadata
  };
}
```

## Configuration-Driven Behavior

The compiler behavior is controlled by configuration:

```typescript
interface WorldCompilerConfig {
  lightStrategy: {
    mode: 'all' | 'simple' | 'none';
    minIntensity?: number;  // Default: 0.01
    bboxAttempts?: number;   // Future feature
  };
}
```

### Strategy Modes

**`'none'`**: No emissive materials become lights
```typescript
// Only explicit lights are compiled
// Materials still have emission for direct viewing
// No MIS needed for emissives
```

**`'simple'`**: Only simple emissives become lights
```typescript
// Future: detect spheres, quads, etc.
// Currently same as 'none'
```

**`'all'`**: All emissives become lights
```typescript
// Every emissive material gets a light entry
// Most will be path-only (sampling = null)
// Enables correct MIS for all emissives
```

## Optimization Opportunities

### Single Light Optimization
```typescript
if (registry.samplableIndices.length === 1) {
  // Skip light selection in shader
  // Direct sampling without random selection
}
```

### No Emission Optimization
```typescript
if (!metadata.features.hasEmission) {
  // Simpler material structure
  // No light_id checks in transport
}
```

### Few Materials Optimization
```typescript
if (materials.length < config.optimization.inlineMaterials) {
  // Inline material properties as constants
  // Avoid uniform array lookups
}
```

## Debug Features

```typescript
private logCompilationSummary() {
  if (!this.config.debug.logLightAssignment) return;
  
  console.log("=== Light Compilation Summary ===");
  console.log(`Total lights: ${this.registry.stats.total}`);
  console.log(`  Samplable: ${this.registry.stats.samplable}`);
  console.log(`  Path-only: ${this.registry.stats.pathOnly}`);
  console.log(`  From explicit lights: ${this.registry.stats.fromExplicitLights}`);
  console.log(`  From materials: ${this.registry.stats.fromEmissiveMaterials}`);
  
  // Show which materials got lights
  for (const mat of this.materials) {
    if (mat.light_id >= 0) {
      console.log(`  Material ${mat.id} → Light ${mat.light_id}`);
    }
  }
}
```

## Why This Design?

1. **Simplicity**: One-way flow from sources to lights to materials
2. **Efficiency**: Direct light_id lookup, no indirection
3. **Flexibility**: Easy to add new light sources or sampling strategies
4. **Correctness**: All emissives tracked for proper MIS
5. **Clarity**: No complex bidirectional mappings to maintain

The compiler's job is straightforward: collect lights, assign IDs, compile modules. The complexity of cross-referencing is eliminated by having materials directly reference their lights.
