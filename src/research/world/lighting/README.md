# LightsCompiler

Compiles lighting descriptions into GLSL modules for the path tracer.

## Features

- **Modular light type system**: Each light type has its own generator function
- **Easy extensibility**: Adding new light types requires minimal changes
- **Single vs. multiple lights**: Optimized code paths for each scenario
- **UI parameter generation**: Automatic generation of uniforms and parameters for single lights
- **Proper GLSL structure**: Generates `constants`, `uniforms`, and `functions` sections

## Usage

```typescript
import { LightsCompiler } from './LightsCompiler.js';
import type { LightingDescription } from './types.js';

// Define your lights
const lightingDescription: LightingDescription = {
  lights: [
    {
      type: 'quad',
      id: 'ceiling_light',
      center: [0, 3.9, 0],
      width: 2.0,
      height: 2.0,
      direction1: [1, 0, 0],
      direction2: [0, 0, 1],
      color: [1, 1, 1],
      intensity: 30
    }
  ]
};

// Compile to GLSL module
const compiler = new LightsCompiler();
const compiledLighting = compiler.compile(lightingDescription);

// Use in a recipe
const recipe = {
  world: {
    lighting: compiledLighting,
    // ... other world components
  },
  // ... optics components
};
```

## Supported Light Types

### Point Light
```typescript
{
  type: 'point',
  id: 'my_point_light',
  position: [x, y, z],
  color: [r, g, b],
  intensity: number
}
```

### Sphere Light
```typescript
{
  type: 'sphere',
  id: 'my_sphere_light',
  position: [x, y, z],
  radius: number,
  color: [r, g, b],
  intensity: number
}
```

### Quad Light
```typescript
{
  type: 'quad',
  id: 'my_quad_light',
  center: [x, y, z],
  width: number,
  height: number,
  direction1: [x, y, z],  // normalized direction for width
  direction2: [x, y, z],  // normalized direction for height
  color: [r, g, b],
  intensity: number
}
```

## Single vs. Multiple Lights

### Single Light (Current Implementation)
- Generates uniforms for UI control
- Direct uniform access (no global arrays)
- Matches old module signature: `lighting_sample(Point p)`
- Automatic parameter generation for UI

### Multiple Lights (Deferred)
- Embeds lights as constant data
- Uses power-based light selection
- Signature: `lighting_sample(Point p, vec2 xi)`
- MIS (Multiple Importance Sampling) to be implemented

## Generated GLSL Structure

The compiler generates a module with three sections:

### Constants
```glsl
#define NUM_LIGHTS 1
#define PI 3.14159265359
#define SAMPLING_NONE 0
#define SAMPLING_POINT 1
#define SAMPLING_SPHERE 3
#define SAMPLING_QUAD 4
```

### Uniforms (single light only)
```glsl
uniform vec3 u_light_center;
uniform vec3 u_light_edge1;
uniform vec3 u_light_edge2;
uniform vec3 u_light_color;
uniform float u_light_intensity;
```

### Functions
- Individual light samplers (`sample_light_0`, `sample_light_1`, etc.)
- Main sampling function (`lighting_sample`)
- Light data accessor (`lighting_get_light`)
- Query functions (`lighting_can_sample`, `lighting_count`, etc.)

## Adding New Light Types

To add a new light type:

1. **Add type definition** in `types.ts`:
```typescript
export interface MyNewLight {
  type: 'mynew';
  id: string;
  // ... light-specific parameters
  color: vec3;
  intensity: number;
}

export type Light = PointLight | SphereLight | QuadLight | MyNewLight;
```

2. **Create sampler generator** in `LightsCompiler.ts`:
```typescript
function generateMyNewLightSampler(light: MyNewLight, index: number, isSingleLight: boolean): string {
  // ... implement sampling logic
  return `
    LightSample sample_light_${index}(${signature}) {
      // ... your GLSL code
    }
  `.trim();
}
```

3. **Add dispatcher case**:
```typescript
function generateLightSampler(light: Light, index: number, isSingleLight: boolean): string {
  switch (light.type) {
    // ... existing cases
    case 'mynew':
      return generateMyNewLightSampler(light, index, isSingleLight);
  }
}
```

4. **Add encoder case**:
```typescript
function encodeLightData(light: Light): ... {
  switch (light.type) {
    // ... existing cases
    case 'mynew':
      return {
        radiance: [...],
        samplingType: 5, // Pick next available number
        param0: [...],
        param1: [...],
        param2: [...]
      };
  }
}
```

5. **Add uniform generators** (for single light support):
   - `generateUniformsForSingleLight`
   - `generateParametersForLight`
   - `generateUniformBindingsForLight`

## Testing

Run the test suite:
```bash
npx tsx src/world/lighting/test-compilation-fix.ts
```

This verifies:
- Module compiles without errors
- No struct redefinitions (structs come from `common-structs.glsl`)
- Proper uniform and parameter generation

## Example

See `examples/scene-with-light/` for a complete example combining SceneCompiler and LightsCompiler.

## Implementation Status

✅ Point light support
✅ Sphere light support
✅ Quad light support
✅ Single light with UI parameters
✅ GLSL module generation
✅ Struct compatibility with common-structs.glsl
⏸️ Multiple light support (deferred - requires MIS)
⏸️ Environment lighting (deferred)
⏸️ Emissive materials as lights (deferred)
