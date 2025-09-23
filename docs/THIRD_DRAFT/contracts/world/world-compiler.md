You're right - it's cleaner to have augmentation as just a step within the WorldCompiler, not a separate class. Let me revise:

# WorldCompiler (Revised)

## Purpose
Orchestrates the compilation of World modules from scene and light descriptions. Handles all cross-referencing internally before passing clean inputs to the sub-compilers.

## Architecture

```typescript
class WorldCompiler {
  private sceneCompiler = new SceneCompiler();
  private lightingCompiler = new LightingCompiler();
  
  compile(
    sceneDesc: SceneDescription,
    lightDesc: LightDescription,
    geometryModule: string
  ): CompiledWorld {
    
    // Step 1: Augmentation (internal process)
    const { sceneInput, lightingInput } = this.augment(sceneDesc, lightDesc);
    
    // Step 2: Compile modules
    const sceneModule = this.sceneCompiler.compile(sceneInput);
    const lightingModule = this.lightingCompiler.compile(lightingInput);
    
    // Step 3: Load geometry
    const geometryMod = this.loadGeometryModule(geometryModule);
    
    return {
      geometry: geometryMod,
      scene: sceneModule,
      lighting: lightingModule,
      metadata: this.generateMetadata(sceneInput, lightingInput)
    };
  }
  
  // INTERNAL: Augmentation step
  private augment(scene: SceneDescription, lights: LightDescription) {
    const materialMap = this.assignMaterialIds(scene, lights);
    
    // Add visible lights as objects
    const lightObjects = lights.lights
      .filter(l => l.visible)
      .map(l => this.lightToObject(l, materialMap));
    
    // Add emissive objects as lights
    const emissiveLights = scene.objects
      .filter(o => o.material.emission)
      .map(o => this.objectToLight(o));
    
    // Build clean inputs for compilers
    return {
      sceneInput: {
        objects: [...this.convertObjects(scene.objects, materialMap), 
                  ...lightObjects],
        materials: this.buildMaterialList(scene, lights, materialMap)
      },
      lightingInput: {
        lights: [...lights.lights, ...emissiveLights],
        environment: lights.environment
      }
    };
  }
  
  private lightToObject(light: Light, materialMap: Map<string, number>): CompilerObject {
    // Convert visible light to geometric object
    switch(light.type) {
      case 'sphere':
        return {
          id: `light_${light.id}`,
          sdf: `return length(p - vec3(${light.position})) - ${light.radius};`,
          materialId: materialMap.get(`light_${light.id}`),
          transform: identity()
        };
      // ... other light types
    }
  }
  
  private objectToLight(obj: UserObject): CompilerLight {
    // Convert emissive object to light source
    if (obj.geometry.type === 'sphere') {
      return {
        id: `obj_${obj.id}`,
        type: 'area',
        intensity: obj.material.emission,
        position: obj.transform?.position || [0,0,0],
        radius: obj.geometry.radius
      };
    }
    
    // Complex geometry gets bbox fallback
    return {
      id: `obj_${obj.id}`,
      type: 'bbox',
      intensity: obj.material.emission,
      bounds: this.computeBounds(obj)
    };
  }
}
```
