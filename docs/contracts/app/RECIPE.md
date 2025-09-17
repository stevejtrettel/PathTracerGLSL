# Recipe Contract

A Recipe defines a complete render configuration, specifying which modules to use from World and Photography pillars and their parameters.

## Core Structure

```typescript
interface Recipe {
  id: string;               // Unique identifier
  name: string;             // Human-readable name
  version: string;          // Recipe format version
  
  world: WorldConfig;       // World pillar modules
  photography: PhotoConfig; // Photography pillar modules
  parameters?: ParameterSet; // Initial parameter values
  metadata?: RecipeMetadata; // Optional description/tags
}
```

## World Configuration

```typescript
interface WorldConfig {
  geometry: ModuleReference;
  material: ModuleReference | ModuleReference[];  // Can have multiple
  scene: ModuleReference;
  lights: ModuleReference;
}

interface ModuleReference {
  kind: string;     // "Geometry", "Material", etc.
  name: string;     // "Euclidean", "Glass", etc.
  version?: string; // Optional version constraint
}
```

## Photography Configuration

```typescript
interface PhotoConfig {
  camera: ModuleReference;
  estimator: ModuleReference;
  film: ModuleReference;
  developer: ModuleReference;
}
```

## Parameter Specification

Initial values for module parameters:

```typescript
interface ParameterSet {
  [path: string]: any;  // Dot-notation paths to values
}

// Example:
{
  "camera.position": [0, 5, 10],
  "camera.fov": 45,
  "material.glass.ior": 1.5,
  "estimator.max_bounces": 8,
  "developer.exposure": 0.5
}
```

## Complete Recipe Example

```typescript
const basicRecipe: Recipe = {
  id: "basic-path-tracer",
  name: "Basic Path Tracer",
  version: "1.0.0",
  
  world: {
    geometry: { kind: "Geometry", name: "Euclidean" },
    material: { kind: "Material", name: "Lambert" },
    scene: { kind: "Scene", name: "SimpleSDFScene" },
    lights: { kind: "Lights", name: "EnvironmentMap" }
  },
  
  photography: {
    camera: { kind: "Camera", name: "Pinhole" },
    estimator: { kind: "Estimator", name: "PathTracer" },
    film: { kind: "Film", name: "SimpleAverage" },
    developer: { kind: "Developer", name: "Reinhard" }
  },
  
  parameters: {
    "camera.position": [0, 2, 5],
    "camera.target": [0, 0, 0],
    "estimator.max_bounces": 5,
    "developer.exposure": 0.0
  }
};
```

## Recipe Variants

Multiple configurations for different purposes:

```typescript
interface RecipeBundle {
  base: Recipe;           // Base configuration
  variants: RecipeVariant[]; // Alternative configurations
}

interface RecipeVariant {
  id: string;            // Variant identifier
  name: string;          // "Preview", "Production", etc.
  overrides: {
    world?: Partial<WorldConfig>;
    photography?: Partial<PhotoConfig>;
    parameters?: ParameterSet;
  };
}
```

### Example Bundle
```typescript
const renderBundle: RecipeBundle = {
  base: basicRecipe,
  variants: [
    {
      id: "preview",
      name: "Fast Preview",
      overrides: {
        photography: {
          estimator: { kind: "Estimator", name: "DirectOnly" },
          film: { kind: "Film", name: "NoAccumulation" }
        },
        parameters: {
          "estimator.max_bounces": 1
        }
      }
    },
    {
      id: "production",
      name: "High Quality",
      overrides: {
        photography: {
          estimator: { kind: "Estimator", name: "BidirectionalPT" },
          film: { kind: "Film", name: "VarianceTracking" }
        },
        parameters: {
          "estimator.max_bounces": 20,
          "film.variance_threshold": 0.001
        }
      }
    }
  ]
};
```

## Module Resolution

How the App finds and loads modules:

```typescript
interface ModuleRegistry {
  register(module: ModuleDescriptor): void;
  resolve(ref: ModuleReference): ModuleDescriptor;
  list(kind: string): ModuleDescriptor[];
}

// Resolution process:
1. Look up module by kind + name
2. Check version compatibility (if specified)
3. Return module descriptor with GLSL code
4. Throw if not found or incompatible
```

## Recipe Validation

```typescript
interface RecipeValidator {
  validate(recipe: Recipe): ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

// Checks:
- All required modules specified
- Modules exist in registry
- No duplicate module kinds (except materials)
- Parameter paths match module parameters
- Version compatibility
```

## Serialization

Recipes can be saved/loaded as JSON:

```typescript
// Save recipe
const json = JSON.stringify(recipe, null, 2);
fs.writeFileSync('my_recipe.json', json);

// Load recipe
const loaded = JSON.parse(fs.readFileSync('my_recipe.json'));
app.loadRecipe(loaded);
```

## Recipe Builder

Helper for creating recipes programmatically:

```typescript
class RecipeBuilder {
  constructor(name: string) {
    this.recipe = { name, id: generateId() };
  }
  
  geometry(name: string): this {
    this.recipe.world.geometry = { kind: "Geometry", name };
    return this;
  }
  
  material(name: string): this {
    this.recipe.world.material = { kind: "Material", name };
    return this;
  }
  
  camera(name: string): this {
    this.recipe.photography.camera = { kind: "Camera", name };
    return this;
  }
  
  // ... other modules
  
  parameter(path: string, value: any): this {
    this.recipe.parameters[path] = value;
    return this;
  }
  
  build(): Recipe {
    return this.recipe;
  }
}

// Usage:
const recipe = new RecipeBuilder("My Scene")
  .geometry("Hyperbolic")
  .material("Glass")
  .camera("ThinLens")
  .parameter("camera.aperture", 0.1)
  .build();
```

## Metadata

Optional information for organization:

```typescript
interface RecipeMetadata {
  description?: string;     // What this recipe demonstrates
  author?: string;         // Who created it
  created?: Date;          // When created
  tags?: string[];         // ["glass", "caustics", "production"]
  thumbnail?: string;      // Base64 preview image
  notes?: string;          // Research notes
  performance?: {
    estimatedTime?: number; // Seconds to converge
    gpuMemory?: number;    // Bytes required
  };
}
```

## Best Practices

1. **Use descriptive IDs** for recipes and variants
2. **Specify versions** for reproducibility
3. **Document parameter choices** in metadata
4. **Create variants** for different quality levels
5. **Validate recipes** before attempting compilation
6. **Save recipes** with rendered results for comparison

## Example: Research Workflow

```typescript
// Create base recipe for research
const base = new RecipeBuilder("BRDF Comparison")
  .geometry("Euclidean")
  .material("DisneyBRDF")
  .camera("Pinhole")
  .estimator("PathTracer")
  .film("SimpleAverage")
  .developer("ACES")
  .build();

// Generate variants for parameter sweep
const variants = [0.0, 0.25, 0.5, 0.75, 1.0].map(roughness => ({
  ...base,
  id: `roughness-${roughness}`,
  parameters: {
    ...base.parameters,
    "material.roughness": roughness
  }
}));

// Run all variants
for (const recipe of variants) {
  app.loadRecipe(recipe);
  await app.renderToConvergence(100);
  await app.saveImage(`${recipe.id}.png`);
}
