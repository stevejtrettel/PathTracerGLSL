# Developer Module Contract

Developers transform radiance into displayable output.

## Required Functions

### d_develop
```glsl
vec3 d_develop(vec3 radiance)
```
Process HDR radiance to display color.

**Parameters:**
- `radiance`: HDR radiance from film

**Returns:** Display-ready RGB in [0,1]

## Optional Functions

### d_develop_extended
```glsl
vec3 d_develop_extended(vec3 radiance, vec3 normal, float depth, vec3 albedo)
```
Process with access to auxiliary buffers (for denoising, etc.).

## Pipeline Stages

Developers can be composed in a pipeline. Each stage has the same signature:
```glsl
vec3 process(vec3 input)
```

Common pipeline:
1. **Tonemap**: HDR → LDR
2. **ColorGrade**: Artistic adjustments
3. **Denoise**: Remove noise
4. **Effects**: Bloom, grain, etc.

## Implementation Examples

### Simple Reinhard Tonemap
```glsl
vec3 d_develop(vec3 radiance) {
  vec3 color = radiance / (radiance + vec3(1.0));
  return pow(color, vec3(1.0/2.2));  // Gamma correction
}
```

### ACES Filmic
```glsl
vec3 d_develop(vec3 radiance) {
  // ACES tone mapping curve
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  
  vec3 x = radiance * 0.6;  // Exposure adjustment
  vec3 color = clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
  return pow(color, vec3(1.0/2.2));
}
```

### Exposure & Gamma
```glsl
uniform float exposure;
uniform float gamma;

vec3 d_develop(vec3 radiance) {
  vec3 color = radiance * exposure;
  color = color / (color + vec3(1.0));  // Reinhard
  return pow(color, vec3(1.0/gamma));
}
```

### False Color (Analysis)
```glsl
vec3 d_develop(vec3 radiance) {
  float luminance = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
  
  // Map luminance to rainbow
  vec3 color;
  if (luminance < 0.25) 
    color = mix(vec3(0,0,1), vec3(0,1,1), luminance * 4.0);
  else if (luminance < 0.5)
    color = mix(vec3(0,1,1), vec3(0,1,0), (luminance - 0.25) * 4.0);
  else if (luminance < 0.75)
    color = mix(vec3(0,1,0), vec3(1,1,0), (luminance - 0.5) * 4.0);
  else
    color = mix(vec3(1,1,0), vec3(1,0,0), (luminance - 0.75) * 4.0);
    
  return color;
}
```

## Common Parameters

- `exposure` (float): Brightness adjustment [-10, 10]
- `contrast` (float): Contrast adjustment [0, 2]
- `saturation` (float): Color intensity [0, 2]
- `gamma` (float): Gamma correction value [0.5, 3.0]
- `vignette_strength` (float): Edge darkening [0, 1]
- `temperature` (float): Color temperature adjustment [-1, 1]
- `tint` (float): Green/magenta adjustment [-1, 1]

## Module ID Convention

```typescript
id: { kind: "Developer", name: "YourDeveloperName", version: "1.0.0" }
```

## Implementation Notes

- Output should be clamped to [0,1] for display
- Apply gamma correction as final step
- Consider preserving hue during tone mapping
- For analysis modes, false color can exceed [0,1]
