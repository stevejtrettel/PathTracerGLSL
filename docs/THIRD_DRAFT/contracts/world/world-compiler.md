
# WorldCompiler

## Purpose
Orchestrates compilation of World modules from scene and light descriptions. The key challenge this solves is the dual nature of emissive objects (they're both geometry and light sources) and the need to handle them correctly for Multiple Importance Sampling (MIS).

## Core Architecture

The WorldCompiler is the orchestrator that transforms user-friendly descriptions into optimized GLSL modules. Its main job is to handle the complex relationships between objects and lights.

```typescript
class WorldCompiler {
  private sceneCompiler = new SceneCompiler();
  private lightingCompiler = new LightingCompiler();
  private crossRef: CrossReferenceData;
  
  constructor(private config: SamplingStrategyConfig) {}
```

## The Compilation Pipeline

### Step 1: Cross-Reference Initialization

Before we process anything, we need a data structure to track relationships. This is crucial for MIS - when we hit an emissive object, we need to know if we could have sampled it directly.

```typescript
private initializeCrossReference(): CrossReferenceData {
  return {
    objectToLight: new Map(),     // "I hit object X, is it also light Y?"
    lightToObject: new Map(),     // "I sampled light Y, what object is it?"
    samplableLights: new Set(),   // "Which lights can I actually sample?"
    stats: {
      totalLights: 0,
      samplableLights: 0,
      pathOnlyEmissives: 0
    }
  };
}
```

### Step 2: Processing and Augmentation

This is where the magic happens. We take the user's separate lists of objects and lights and merge them intelligently. The key insight: some objects become lights (if emissive) and some lights become objects (if visible).

```typescript
private processAndAugment(
  scene: SceneDescription,
  lights: LightDescription
): { sceneInput: SceneCompilerInput, lightingInput: LightingCompilerInput } {
```

#### Material ID Assignment
First, we need consistent material IDs across both modules. Material 0 is always air/vacuum, then we number sequentially.

```typescript
  const materials = this.buildMaterialList(scene, lights);
  const materialIdMap = this.assignMaterialIds(materials);
```

#### Processing Original Lights
User-defined lights are straightforward - they're always samplable (that's their purpose).

```typescript
  const processedLights: CompilerLight[] = lights.lights.map(light => 
    this.processUserLight(light)
  );
```

#### Creating Objects from Visible Lights
If a light has `visible: true`, it needs geometry so rays can hit it:

```typescript
  const lightObjects = lights.lights
    .filter(l => l.visible)
    .map(l => this.createObjectFromLight(l, materialIdMap));
```

#### The Critical Part: Emissive Objects as Lights
This is where we make the key decision - can we sample this emissive object directly, or must it only be found via path tracing?

```typescript
  const emissiveLights = scene.objects
    .filter(obj => this.isEmissive(obj))
    .map(obj => this.createLightFromObject(obj));
```

### Step 3: Sampling Strategy Decision

Not all emissive objects can be efficiently sampled. This method decides what to do with each one:

```typescript
private createLightFromObject(obj: UserObject): CompilerLight | null {
  const strategy = this.determineSamplingStrategy(obj);
  const lightId = `emissive_${obj.id}`;
```

#### Always Track the Relationship
Even if we can't sample it, we need to know it exists for MIS:

```typescript
  // This mapping is ALWAYS created
  this.crossRef.objectToLight.set(obj.id, lightId);
```

#### Three Possible Outcomes

**Outcome 1: Non-Samplable Light**
Complex SDFs, volumetrics, or fractals - we can't sample them efficiently:

```typescript
  if (strategy === 'none') {
    // This light exists but can only be found by hitting it
    return {
      id: lightId,
      canSample: false,
      intensity: obj.material.emission,
      sourceObjectId: obj.id
    } as NonSamplableLight;
  }
```

**Outcome 2: Exact Sampling**
Simple shapes like spheres or quads - we know the math:

```typescript
  if (strategy === 'exact') {
    this.crossRef.samplableLights.add(lightId);
    this.crossRef.lightToObject.set(lightId, obj.id);
    
    return {
      id: lightId,
      canSample: true,
      intensity: obj.material.emission,
      sourceObjectId: obj.id,
      sampling: {
        type: 'sphere',
        position: obj.transform?.position,
        radius: obj.geometry.radius
      }
    } as SamplableLight;
  }
```

**Outcome 3: Approximate Sampling**
Medium complexity - we'll try bounding box rejection sampling:

```typescript
  if (strategy === 'approximate') {
    // Similar to exact, but with bbox sampling strategy
    return {
      sampling: {
        type: 'bbox',
        bounds: this.computeBounds(obj)
      }
      // ... rest of light data
    };
  }
```

### Step 4: Complexity Analysis

How do we decide if an emissive can be sampled? We analyze its complexity:

```typescript
private analyzeGeometryComplexity(geometry: Geometry): { 
  isSimple: boolean; 
  score: number;
} {
```

#### Simple Shapes
These have known sampling strategies:
```typescript
  if (geometry.type === 'sphere' || 
      geometry.type === 'quad' || 
      geometry.type === 'triangle') {
    return { isSimple: true, score: 0 };
  }
```

#### SDF Analysis
For procedural SDFs, we look at their code:
```typescript
  if (geometry.type === 'sdf') {
    const ops = this.countSDFOperations(geometry.code);
    const hasNoise = geometry.code.includes('noise');
    const hasFractal = geometry.code.includes('fractal');
    
    // Noise and fractals are effectively impossible to sample
    return {
      isSimple: ops < 3 && !hasNoise && !hasFractal,
      score: ops + (hasNoise ? 10 : 0) + (hasFractal ? 20 : 0)
    };
  }
```

### Step 5: Configuration-Driven Behavior

The user can control the strategy via configuration:

```typescript
private determineSamplingStrategy(obj: UserObject): 'exact' | 'approximate' | 'none' {
  // User wants no emissive sampling at all
  if (this.config.emissiveStrategy.mode === 'none') {
    return 'none';
  }
  
  // User wants to try sampling everything possible
  if (this.config.emissiveStrategy.mode === 'all') {
    return this.canCreateExactSampler(obj) ? 'exact' : 'approximate';
  }
  
  // User wants only simple shapes sampled
  if (this.config.emissiveStrategy.mode === 'simple') {
    return complexity.isSimple ? 'exact' : 'none';
  }
  
  // Analyzed mode: use thresholds
  const threshold = this.config.emissiveStrategy.complexityThreshold ?? 5;
  if (complexity.score < threshold) {
    return complexity.isSimple ? 'exact' : 'approximate';
  }
  
  return 'none';
}
```

## Debug Features

For development and verification:

```typescript
private logSamplingDecisions() {
  if (!this.config.verification.logSamplingDecisions) return;
  
  console.log("=== Sampling Strategy Report ===");
  console.log(`Total lights: ${this.crossRef.stats.totalLights}`);
  console.log(`Samplable: ${this.crossRef.stats.samplableLights}`);
  console.log(`Path-only emissives: ${this.crossRef.stats.pathOnlyEmissives}`);
  
  // List which emissives we decided not to sample and why
  for (const [objId, lightId] of this.crossRef.objectToLight) {
    if (!this.crossRef.samplableLights.has(lightId)) {
      console.log(`  Object ${objId}: Too complex for sampling`);
    }
  }
}
```

## The Final Output

The compiler produces everything needed for rendering:

```typescript
return {
  modules: {
    geometry: geometryModule,     // Hand-written math
    scene: sceneModule,           // Compiled SDFs and materials
    lighting: lightingModule      // Compiled sampling strategies
  },
  crossRef: this.crossRef,        // For MIS calculations
  metadata: {
    // Statistics for optimization decisions
    counts: { materials, objects, lights, samplableLights },
    features: { hasEmissive, hasPathOnlyEmissive, hasEnvironment }
  }
};
```

## Why This Design?

1. **MIS Correctness**: By tracking all emissives (even non-samplable ones), we can compute correct MIS weights
2. **Performance**: Complex emissives don't waste time on failed sampling attempts
3. **Flexibility**: Users can choose their preferred strategy via configuration
4. **Debugging**: Clear separation makes it easy to see why decisions were made
```
