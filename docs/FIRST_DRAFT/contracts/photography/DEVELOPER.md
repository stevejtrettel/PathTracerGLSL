# Developer Module Contract

Developers transform HDR radiance into displayable output.

## Required Functions

### develop
```glsl
vec3 develop(vec3 radiance)
```
Process accumulated radiance into final display color.

**Parameters:**
- `radiance`: HDR color from film

**Returns:** LDR color in [0,1] for display

**Note:** Function will be auto-prefixed to `d_develop` in compiled shader.

## Optional Functions

### develop_extended
```glsl
vec3 develop_extended(vec3 radiance, vec3 normal, float depth, vec3 albedo)
```
Process with access to auxiliary buffers (for advanced techniques).

### get_exposure
```glsl
float get_exposure()
```
Return current exposure value (for UI feedback).

## Common Parameters

```glsl
// You write:
uniform float exposure;      // → u_developer_[name]_exposure
uniform float gamma;         // → u_developer_[name]_gamma
uniform float contrast;      // → u_developer_[name]_contrast
uniform float saturation;    // → u_developer_[name]_saturation
```

Common developer parameters:
- `exposure` (float): Brightness adjustment [-5, 5]
- `gamma` (float): Gamma correction [0.5, 3.0]
- `contrast` (float): Contrast adjustment [0, 2]
- `saturation` (float): Color intensity [0, 2]
- `temperature` (float): Color temperature [-1, 1]
- `tint` (float): Green/magenta shift [-1, 1]
- `vignette` (float): Edge darkening [0, 1]

## Tone Mapping Operators

### Reinhard
Simple and efficient:

```glsl
vec3 develop(vec3 radiance) {
  vec3 color = radiance / (radiance + vec3(1.0));
  return pow(color, vec3(1.0/2.2));  // Gamma correction
}
```

### Extended Reinhard
With white point control:

```glsl
uniform float white_point;

vec3 develop(vec3 radiance) {
  float L_white = white_point * white_point;
  vec3 numerator = radiance * (1.0 + radiance / L_white);
  vec3 color = numerator / (1.0 + radiance);
  return pow(color, vec3(1.0/2.2));
}
```

### ACES (Academy Color Encoding System)
Film industry standard:

```glsl
vec3 develop(vec3 radiance) {
  // ACES RRT/ODT approximation
  mat3 aces_input_mat = mat3(
    0.59719, 0.35458, 0.04823,
    0.07600, 0.90834, 0.01566,
    0.02840, 0.13383, 0.83777
  );
  
  mat3 aces_output_mat = mat3(
    1.60475, -0.53108, -0.07367,
    -0.10208, 1.10813, -0.00605,
    -0.00327, -0.07276, 1.07602
  );
  
  vec3 x = aces_input_mat * radiance;
  
  // RRT and ODT fit
  vec3 a = x * (x + 0.0245786) - 0.000090537;
  vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
  vec3 color = aces_output_mat * (a / b);
  
  return pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2));
}
```

### Filmic (Uncharted 2)
Game industry standard with approximated gamma:

```glsl
vec3 uncharted2_tonemap(vec3 x) {
  float A = 0.15;  // Shoulder strength
  float B = 0.50;  // Linear strength
  float C = 0.10;  // Linear angle
  float D = 0.20;  // Toe strength
  float E = 0.02;  // Toe numerator
  float F = 0.30;  // Toe denominator
  
  return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}

// Fast approximate gamma correction
float gamma_approx(float x) {
  return sqrt(x * (2.0 - x));  // Close to pow(x, 1/2.2)
}

uniform float exposure;

vec3 develop(vec3 radiance) {
  vec3 x = radiance * exposure;
  vec3 color = uncharted2_tonemap(x) / uncharted2_tonemap(vec3(11.2));
  
  // Use approximation instead of pow
  return vec3(
    gamma_approx(color.r),
    gamma_approx(color.g),
    gamma_approx(color.b)
  );
}
```

## Color Grading

### Basic Adjustments
```glsl
uniform float exposure;
uniform float contrast;
uniform float saturation;

vec3 develop(vec3 radiance) {
  // Exposure
  vec3 color = radiance * pow(2.0, exposure);
  
  // Tone map
  color = color / (color + vec3(1.0));
  
  // Contrast (around 0.5)
  color = mix(vec3(0.5), color, contrast);
  
  // Saturation
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, saturation);
  
  // Gamma - use approximation for speed
  return vec3(
    gamma_approx(color.r),
    gamma_approx(color.g),
    gamma_approx(color.b)
  );
}
```

### Vignette Effect
```glsl
uniform float vignette_strength;
uniform float vignette_radius;

vec3 apply_vignette(vec3 color, vec2 pixel) {
  vec2 uv = (pixel - 0.5 * u_resolution) / u_resolution.y;
  float dist = length(uv);
  float vignette = 1.0 - smoothstep(vignette_radius, 1.0, dist);
  return mix(color * vignette, color, 1.0 - vignette_strength);
}
```

## Gamma Correction Optimization

For performance, consider gamma approximations:

```glsl
// Accurate but slow
vec3 accurate_gamma(vec3 color) {
  return pow(color, vec3(1.0/2.2));
}

// Fast approximation (good enough for most cases)
float gamma_approx(float x) {
  return sqrt(x * (2.0 - x));
}

// Even faster for rough preview
float gamma_fast(float x) {
  return sqrt(x);  // gamma = 2.0
}
```

## Analysis Modes

### False Color
For visualizing HDR ranges:

```glsl
vec3 develop(vec3 radiance) {
  float luminance = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
  
  vec3 color;
  if (luminance < 0.0001) {
    color = vec3(0, 0, 0);  // Black: No light
  } else if (luminance < 0.01) {
    color = vec3(0, 0, 1);  // Blue: Very dark
  } else if (luminance < 0.1) {
    color = vec3(0, 1, 1);  // Cyan: Dark
  } else if (luminance < 1.0) {
    color = vec3(0, 1, 0);  // Green: Mid-tones
  } else if (luminance < 10.0) {
    color = vec3(1, 1, 0);  // Yellow: Bright
  } else if (luminance < 100.0) {
    color = vec3(1, 0.5, 0);  // Orange: Very bright
  } else {
    color = vec3(1, 0, 0);  // Red: Extremely bright
  }
  
  return color;
}
```

### Exposure Zebras
Highlight over/under exposure:

```glsl
uniform float zebra_low;   // Underexposure threshold
uniform float zebra_high;  // Overexposure threshold

vec3 develop(vec3 radiance) {
  vec3 color = reinhard_tonemap(radiance);
  
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  
  // Zebra stripes
  float pattern = sin(gl_FragCoord.x * 0.5 + gl_FragCoord.y * 0.5) * 0.5 + 0.5;
  
  if (luminance < zebra_low) {
    color = mix(color, vec3(0, 0, 1), pattern * 0.5);  // Blue stripes
  } else if (luminance > zebra_high) {
    color = mix(color, vec3(1, 0, 0), pattern * 0.5);  // Red stripes
  }
  
  return color;
}
```

## Module ID Convention

```typescript
{
  id: {
    kind: "Developer",
    name: "YourDeveloperName",  // "ACES", "Reinhard", etc.
    version: "1.0.0"
  }
}
```

## Available Infrastructure

Developers have access to:
- Math functions from `math/core.glsl`
- Color space conversion utilities
- Engine uniforms: `u_resolution`, `gl_FragCoord`

## Implementation Notes

- Output must be clamped to [0,1] for display
- Apply gamma correction as final step (typically 2.2)
- Consider using gamma approximations for performance
- Consider preserving hue during tone mapping
- For HDR output, skip clamping and gamma
- Analysis modes may intentionally exceed [0,1] range
