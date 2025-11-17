# Multiple Light Sampling (Without MIS)

## Overview

The LightsCompiler now supports **multiple light sources** with correct Monte Carlo sampling, implementing the discrete light selection strategy without Multiple Importance Sampling (MIS).

This system works for **pure lights only** (not emissive surfaces). MIS will be needed later when combining BSDF sampling with light sampling.

## Mathematical Background

For a scene with multiple lights, we need to compute:

```
L = ∑ᵢ Lᵢ
```

Using Monte Carlo estimation with a **two-stage sampling process**:

1. **Discrete light selection**: Choose light `i` with probability `p_select(i)`
2. **Conditional direction sampling**: Sample direction `ωᵢ` from light `i` with PDF `pᵢ(ωᵢ | i)`

The **total PDF** is:
```
p_total(ωᵢ) = p_select(i) × pᵢ(ωᵢ | i)
```

The **Monte Carlo estimator** becomes:
```
L ≈ f(ωᵢ) × Lᵢ(ωᵢ) / p_total(ωᵢ)
```

## Implementation

### Light Selection Strategy

We use **power-based selection** where each light's selection probability is proportional to its luminance:

```glsl
p_select(i) = luminance(Lᵢ) / total_luminance
```

This is implemented with a discrete CDF:

```glsl
const float light_powers[3] = float[](25.0, 6.7323, 7.0108);
const float total_power = 38.743100;

int select_light(float xi) {
  float r = xi * total_power;
  float cumulative = 0.0;

  for (int i = 0; i < 3; i++) {
    cumulative += light_powers[i];
    if (r <= cumulative) return i;
  }

  return 2;  // Fallback to last light
}
```

### Main Sampling Function

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  // 1. Select light using p_select(i)
  int light_idx = select_light(xi.x);
  vec2 light_xi = random2();

  // 2. Sample direction from selected light with p_i(ω_i | i)
  LightSample ls;
  switch(light_idx) {
    case 0: ls = sample_light_0(p, xi); break;
    case 1: ls = sample_light_1(p, xi); break;
    case 2: ls = sample_light_2(p, xi); break;
  }

  // 3. Multiply PDFs: p_total = p_select × p_i
  ls.pdf *= light_powers[light_idx] / total_power;

  return ls;
}
```

### Per-Light Samplers

Each light type has its own sampler that returns:
- `ls.wi` - direction to light
- `ls.radiance` - incoming radiance
- `ls.pdf` - conditional PDF `pᵢ(ωᵢ | i)` (NOT including selection probability)

**Point Light**:
```glsl
ls.pdf = 1.0;  // Delta distribution convention
ls.radiance = L / distance²;
```

**Sphere Light**:
```glsl
ls.pdf = pdf_area × distance² / cos_light;
ls.radiance = L;  // No distance falloff (area light)
```

**Quad Light**:
```glsl
ls.pdf = distance² / (area × cos_light);
ls.radiance = L;  // No distance falloff (area light)
```

## Current Limitations

### Multi-Light Mode Uses Constants

When you have multiple lights, the LightsCompiler currently generates:
- **Hardcoded light data** in a `LightData[N]` array
- **No UI parameters** (lights are not adjustable at runtime)

This is a deliberate simplification. For multi-light scenes:
```glsl
LightData u_lights[3] = LightData[](
  LightData(vec3(25, 25, 25), 4, vec4(0, 1.8, 0, 0), ...),  // Quad light
  LightData(vec3(15, 4.5, 4.5), 3, vec4(-1.5, 0.5, 0, 0.3), ...),  // Sphere light
  LightData(vec3(6, 6, 20), 1, vec4(1.5, 0.5, 0, 0), ...)  // Point light
);
```

### Single-Light Mode Uses Uniforms

For scenes with **exactly one light**, the compiler generates:
- **Uniform declarations** for light properties
- **UI parameters** for runtime control
- **Dynamic LightData accessor** that reads from uniforms

This allows interactive control when you only have one light.

## Example Usage

### Multi-Light Scene

```typescript
import type { LightingDescription } from '../../src/world/lighting/types.js';

export const multiLightDescription: LightingDescription = {
  lights: [
    {
      type: 'quad',
      id: 'ceiling_light',
      center: [0, 1.8, 0],
      width: 1.2,
      height: 1.2,
      direction1: [1, 0, 0],
      direction2: [0, 0, 1],
      color: [1.0, 1.0, 1.0],
      intensity: 25.0
    },
    {
      type: 'sphere',
      id: 'left_light',
      position: [-1.5, 0.5, 0],
      radius: 0.3,
      color: [1.0, 0.3, 0.3],
      intensity: 15.0
    },
    {
      type: 'point',
      id: 'right_light',
      position: [1.5, 0.5, 0],
      color: [0.3, 0.3, 1.0],
      intensity: 20.0
    }
  ]
};
```

### Compilation

```typescript
const lightsCompiler = new LightsCompiler();
const lightingModule = lightsCompiler.compile(multiLightDescription);
```

The compiler automatically:
1. Calculates luminance for each light: `[25.0, 6.7323, 7.0108]`
2. Generates power-based selection CDF
3. Creates individual samplers for each light
4. Generates main sampler with correct PDF multiplication

## Future Work

### Emissive Materials + MIS

When we add **emissive materials as lights**, we'll need:
- `lighting_pdf(Point p, vec3 wi)` - PDF for a given direction
- **Multiple Importance Sampling** to combine BSDF and light sampling
- **Balance heuristic** or **power heuristic** for MIS weights

### Multi-Light UI Controls

To support uniforms for multiple lights:
- Generate array of uniform structs
- Create parameter groups for each light
- Handle dynamic light count in shaders

## Verification

The test suite includes:
- `tests/multi-light-compiler.test.ts` - Verifies correct GLSL generation
- `examples/multi-light-test/` - Interactive example with 3 lights

Key checks:
- ✓ No struct redefinitions
- ✓ Correct PDF multiplication: `ls.pdf *= p_select`
- ✓ CDF-based light selection
- ✓ Individual samplers preserve their PDFs
