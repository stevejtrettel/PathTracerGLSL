
# Module Integration Contract (Revised)

## Architecture Overview

The World pillar defines **what exists** through five modules, with Materials now serving as a pure property provider. All modules use manual function prefixing, and the concatenation order is fixed at compile time.

```
World Modules (define reality):
├── Geometry     - Mathematical space (geometry_*)
├── Objects      - Shapes and material IDs (object_*)  
├── Scene        - Spatial arrangement (scene_*)
├── Materials    - Physical properties only (material_*)
└── Lights       - Emission sources (light_*)

Photography uses World data but never modifies it
```

## Build Pipeline

```
1. Scene Analysis → Determine objects, materials, properties
2. Property Analysis → Find constant vs varying properties  
3. Module Generation → Create optimized modules
4. Assembly → Concatenate in dependency order
5. Validation → Verify contracts and consistency
```

## Module Dependency Flow

```
Geometry (standalone - defines coordinate system)
    ↓
Objects (use geometry for frame/normal computation)
    ↓
Scene (arranges objects, resolves material IDs)
    ↓
Materials (provides properties for IDs from Scene)
    ↓
Lights (may query material emission properties)
```

## World Descriptor Structure

```typescript
interface WorldDescriptor {
  geometry: GeometryModule;      // Hand-written
  objects: ObjectModule[];        // Generated per object
  scene: SceneModule;            // Generated arrangement
  materials: MaterialsModule;     // Generated property provider
  lights: LightsModule;          // Hand-written or generated
  
  metadata: {
    materialIds: MaterialID[];
    objectCount: number;
    propertyAnalysis: PropertyAnalysis;
    optimizationFlags: OptimizationFlags;
  }
}

interface PropertyAnalysis {
  constantProperties: Map<string, any>;     // Same for all materials
  varyingProperties: Set<string>;          // Differ between materials
  spatiallyVarying: Set<string>;          // Vary with position
  hasVolumes: boolean;
  hasEmission: boolean;
  hasDielectrics: boolean;
}

interface OptimizationFlags {
  unrollObjects: boolean;        // <20 objects
  useTextureAtlas: boolean;      // Multiple textures
  eliminateVolumes: boolean;     // No participating media
  simplifyToLambert: boolean;    // All roughness > 0.9
}
```

## Analysis Phase

### Scene Analysis
```typescript
interface SceneAnalysis {
  objects: Array<{
    definition: ObjectDefinition;
    transform: Transform;
    materials: MaterialID[];      // All materials used by object
  }>;
  
  allMaterialIds: Set<MaterialID>;
  boundingVolume: BoundingBox;
  
  features: {
    hasIsosurfaces: boolean;
    hasCSG: boolean;
    hasInstancing: boolean;
    hasProceduralTextures: boolean;
  };
}
```

### Property Analysis
```typescript
class PropertyAnalyzer {
  analyze(scene: SceneAnalysis): PropertyAnalysis {
    const properties = new Map<string, Set<any>>();
    
    // Collect all unique property values
    for (const matId of scene.allMaterialIds) {
      const mat = this.getMaterialDefinition(matId);
      for (const [prop, value] of mat.properties) {
        if (!properties.has(prop)) properties.set(prop, new Set());
        properties.get(prop).add(value);
      }
    }
    
    // Determine which are constant
    const constant = new Map<string, any>();
    const varying = new Set<string>();
    
    for (const [prop, values] of properties) {
      if (values.size === 1) {
        constant.set(prop, values.values().next().value);
      } else {
        varying.add(prop);
      }
    }
    
    // Check for spatial variation (textures/procedural)
    const spatiallyVarying = this.findSpatiallyVarying(scene);
    
    return {
      constantProperties: constant,
      varyingProperties: varying,
      spatiallyVarying,
      hasVolumes: this.hasVolumes(scene),
      hasEmission: this.hasEmission(scene),
      hasDielectrics: this.hasDielectrics(scene)
    };
  }
}
```

## Module Generation

### Materials Generation (Biggest Change)

```typescript
class MaterialsGenerator {
  generate(analysis: PropertyAnalysis): MaterialsModule {
    const structs = this.generatePropertyStruct(analysis);
    const getters = this.generatePropertyGetters(analysis);
    const arrays = this.generatePropertyArrays(analysis);
    const mainFunction = this.generateMainFunction(analysis);
    
    return {
      id: { kind: 'materials', name: 'generated', version: '1.0' },
      fragment: {
        struct_definitions: structs,
        functions: mainFunction + getters,
        uniforms: arrays.uniforms,
        constants: arrays.constants + this.generateDefines(analysis)
      }
    };
  }
  
  generateMainFunction(analysis: PropertyAnalysis): string {
    const sections = [];
    
    // Add air handling
    sections.push(`
      if (mat_id == MATERIAL_AIR) {
        return air_properties();
      }
    `);
    
    // Generate property assignments
    for (const prop of MATERIAL_PROPERTIES) {
      if (analysis.constantProperties.has(prop)) {
        // Compile-time constant
        const value = analysis.constantProperties.get(prop);
        sections.push(`props.${prop} = ${this.formatValue(value)};`);
        
      } else if (analysis.spatiallyVarying.has(prop)) {
        // Spatially varying - needs position
        sections.push(`
          #if HAS_VARYING_${prop.toUpperCase()}
            props.${prop} = material_sample_${prop}(mat_id, p);
          #else
            props.${prop} = material_${prop}[mat_id];
          #endif
        `);
        
      } else {
        // Per-material constant
        sections.push(`props.${prop} = material_${prop}[mat_id];`);
      }
    }
    
    // Add flags
    sections.push(`props.flags = material_flags[mat_id];`);
    
    return `
      MaterialProperties material_get_properties(int mat_id, vec3 p) {
        MaterialProperties props;
        ${sections.join('\n')}
        return props;
      }
    `;
  }
  
  generatePropertyGetters(analysis: PropertyAnalysis): string {
    const getters = [];
    
    // Only generate getters for spatially-varying properties
    for (const prop of analysis.spatiallyVarying) {
      getters.push(this.generateGetter(prop));
    }
    
    // Fast accessors for commonly needed properties
    getters.push(`
      float material_get_ior(int mat_id) {
        return material_ior[mat_id];
      }
      
      bool material_is_participating(int mat_id) {
        return (material_flags[mat_id] & MATERIAL_FLAG_PARTICIPATING) != 0;
      }
    `);
    
    return getters.join('\n');
  }
}
```

### Scene Generation

```typescript
class SceneGenerator {
  generate(objects: ObjectDefinition[], analysis: SceneAnalysis): SceneModule {
    const strategy = this.chooseStrategy(objects.length);
    
    return {
      id: { kind: 'scene', name: 'generated', version: '1.0' },
      fragment: {
        types: NEARBY_OBJECTS_STRUCT,
        dispatch: this.generateDispatches(objects),
        functions: this.generateMarching(strategy) + 
                  this.generateMaterialResolution(),
        uniforms: this.generateTransforms(objects),
        constants: this.generateConstants(objects)
      }
    };
  }
  
  chooseStrategy(count: number): 'unroll' | 'loop' | 'accelerated' {
    if (count < 20) return 'unroll';
    if (count < 100) return 'loop';
    return 'accelerated';
  }
  
  generateDispatches(objects: ObjectDefinition[]): string {
    // Generate scene_eval_object_distance, scene_get_object_material, etc.
    const dispatches = [];
    
    // Distance dispatch
    dispatches.push(`
      float scene_eval_object_distance(int obj_id, vec3 p) {
        switch(obj_id) {
          ${objects.map((obj, i) => 
            `case ${i}: return object_${obj.name}_distance(p);`
          ).join('\n')}
        }
        return MAX_DIST;
      }
    `);
    
    // Similar for material and normal dispatches
    
    return dispatches.join('\n');
  }
}
```

### Objects Generation

```typescript
class ObjectGenerator {
  generate(definition: ObjectDefinition): ObjectModule {
    const base = this.loadBaseImplementation(definition.type);
    const instance = this.generateInstance(definition, base);
    
    return {
      id: { kind: 'object', name: definition.name, version: '1.0' },
      fragment: {
        functions: instance.distance + instance.material + instance.normal,
        uniforms: instance.parameters,
        constants: instance.constants
      }
    };
  }
  
  generateInstance(def: ObjectDefinition, base: string): GeneratedObject {
    const name = def.name;
    
    return {
      distance: `
        float object_${name}_distance(vec3 p) {
          ${def.transform ? `p = transform_${name}(p);` : ''}
          return ${base.distanceFunction}(p, ${def.parameters});
        }
      `,
      material: `
        int object_${name}_material(vec3 p) {
          return object_${name}_distance(p) < 0.0 ? 
                 ${def.materialId} : MATERIAL_AIR;
        }
      `,
      normal: def.hasAnalyticNormal ? 
        this.generateAnalyticNormal(name) : 
        this.generateGradientNormal(name)
    };
  }
}
```

## Optimization Strategies

### Dead Code Elimination

```typescript
class DeadCodeEliminator {
  eliminate(code: string, analysis: PropertyAnalysis): string {
    let optimized = code;
    
    // Remove volume code if no volumes
    if (!analysis.hasVolumes) {
      optimized = optimized.replace(/\/\*VOLUMES_START\*\/.*\/\*VOLUMES_END\*\//gs, '');
      optimized = optimized.replace(/#if HAS_VOLUMES.*#endif/gs, '');
    }
    
    // Remove emission code if no emission
    if (!analysis.hasEmission) {
      optimized = optimized.replace(/props\.emission.*\n/g, 'props.emission = vec3(0);\n');
      optimized = optimized.replace(/props\.emission_intensity.*\n/g, '');
    }
    
    // Remove unused property branches
    for (const prop of MATERIAL_PROPERTIES) {
      if (analysis.constantProperties.has(prop)) {
        // Remove the varying branch, keep only constant
        optimized = optimized.replace(
          new RegExp(`#if HAS_VARYING_${prop.toUpperCase()}.*?#endif`, 'gs'),
          `props.${prop} = ${analysis.constantProperties.get(prop)};`
        );
      }
    }
    
    return optimized;
  }
}
```

### Constant Folding

```typescript
class ConstantFolder {
  fold(modules: WorldDescriptor, analysis: PropertyAnalysis): WorldDescriptor {
    // Replace all constant properties with literals
    for (const [prop, value] of analysis.constantProperties) {
      modules.materials.fragment.functions = 
        modules.materials.fragment.functions.replace(
          new RegExp(`material_${prop}\\[mat_id\\]`, 'g'),
          this.formatConstant(value)
        );
    }
    
    // Fold mathematical expressions
    modules = this.foldMathExpressions(modules);
    
    return modules;
  }
}
```

### Memory Layout Optimization

```glsl
// Pack properties efficiently for GPU cache
layout(std140) uniform MaterialData {
  // Pack vec3 + float together
  vec4 albedo_roughness[NUM_MATERIALS];      // rgb = albedo, a = roughness
  vec4 emission_metallic[NUM_MATERIALS];     // rgb = emission, a = metallic
  vec4 scatter_absorb_phase[NUM_MATERIALS];  // rg = scatter.xy, b = absorb.x, a = phase_g
  // ... continue packing
} u_materials;

// Efficient accessor
MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  vec4 ar = u_materials.albedo_roughness[mat_id];
  props.albedo = ar.rgb;
  props.roughness = ar.a;
  
  vec4 em = u_materials.emission_metallic[mat_id];
  props.emission = em.rgb;
  props.metallic = em.a;
  
  // ... continue unpacking
  return props;
}
```

## Assembly Pipeline

```typescript
class ModuleAssembler {
  assemble(modules: GeneratedModules): string {
    // Fixed concatenation order
    const order = [
      'common_types',      // Shared type definitions
      'geometry',          // Coordinate system
      'objects',           // Individual objects
      'scene',             // Spatial arrangement
      'materials',         // Property provider
      'lights'            // Light sources
    ];
    
    const sections = [];
    for (const module of order) {
      if (modules[module]) {
        sections.push(`// === ${module.toUpperCase()} MODULE ===`);
        sections.push(modules[module]);
      }
    }
    
    return sections.join('\n\n');
  }
}
```

## Validation

```typescript
class WorldValidator {
  validate(world: WorldDescriptor): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check material ID consistency
    const sceneMaterials = new Set(world.scene.metadata.usedMaterials);
    const materialCount = world.materials.metadata.numMaterials;
    
    for (const id of sceneMaterials) {
      if (id >= materialCount && id !== MATERIAL_AIR) {
        errors.push(`MaterialID ${id} exceeds material count ${materialCount}`);
      }
    }
    
    // Check property ranges
    for (const [prop, [min, max]] of world.materials.metadata.propertyRanges) {
      if (prop === 'roughness' && (min < 0 || max > 1)) {
        errors.push(`Invalid roughness range [${min}, ${max}]`);
      }
      if (prop === 'ior' && min <= 0) {
        errors.push(`Invalid IOR: must be positive`);
      }
    }
    
    // Check function naming
    const requiredPrefixes = {
      geometry: 'geometry_',
      scene: 'scene_',
      materials: 'material_',
      objects: 'object_'
    };
    
    for (const [module, prefix] of Object.entries(requiredPrefixes)) {
      if (!this.checkPrefixes(world[module], prefix)) {
        errors.push(`Module ${module} missing required prefix ${prefix}`);
      }
    }
    
    // Performance warnings
    if (world.metadata.objectCount > 50 && 
        !world.scene.metadata.accelerationStructure) {
      warnings.push('Large scene without acceleration structure');
    }
    
    return { 
      valid: errors.length === 0, 
      errors, 
      warnings 
    };
  }
}
```

## Key Architecture Changes

1. **Materials as Data**: Materials only provides properties via `material_get_properties()`
2. **Manual Prefixing**: All functions use explicit module prefixes
3. **Property-Based Optimization**: Analyze and optimize based on property usage, not BRDF features
4. **No Cross-Module Physics**: Materials doesn't know about BRDFs, Scene doesn't compute IOR ratios
5. **Fixed Concatenation**: Modules always assembled in dependency order
6. **Compile-Time Specialization**: Generate optimal code for actual scene requirements

This integration pipeline focuses on keeping World modules as pure data providers while enabling aggressive compile-time optimization based on actual property usage patterns.
