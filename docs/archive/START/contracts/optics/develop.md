# Developer Contract

## Module Structure

```typescript
{
  id: {
    kind: 'developer',
    name: string,              // 'aces' | 'reinhard' | 'filmic'
    version: string
  },
  fragment: {
    functions: string,         // Tone mapping implementation
    uniforms: string          // Developer parameters
  },
  parameters: Array<{
    name: string,             // Without prefix (engine adds d_[name]_)
    type: string,
    default: any,
    uniform: boolean
  }>
}
```

## Required Functions

### develop
```glsl
RGB develop(Radiance radiance)
```
- **radiance**: HDR accumulated radiance from film
- **returns**: LDR RGB color in [0,1] for display
- Must apply gamma correction
- Note: Engine will auto-prefix to `d_develop`

## Optional Functions

```glsl
RGB develop_extended(Radiance radiance, vec3 normal, float depth, vec3 albedo)
float get_exposure()           // Current exposure value
vec3 get_white_point()        // White point for tone mapper
```
Note: Engine will auto-prefix these with `d_`

## Implementation: Reinhard

```glsl
RGB develop(Radiance radiance) {
  vec3 color = vec3(radiance) / (vec3(radiance) + vec3(1.0));
  return RGB(pow(color, vec3(1.0/2.2)));
}
```

## Implementation: Extended Reinhard

```glsl
uniform float u_developer_reinhard_white_point;

RGB develop(Radiance radiance) {
  float L_white = u_developer_reinhard_white_point * 
                  u_developer_reinhard_white_point;
  vec3 numerator = vec3(radiance) * (1.0 + vec3(radiance) / L_white);
  vec3 color = numerator / (1.0 + vec3(radiance));
  return RGB(pow(color, vec3(1.0/2.2)));
}
```

## Implementation: ACES

```glsl
RGB develop(Radiance radiance) {
  // ACES input matrix
  mat3 aces_input = mat3(
    0.59719, 0.35458, 0.04823,
    0.07600, 0.90834, 0.01566,
    0.02840, 0.13383, 0.83777
  );
  
  // ACES output matrix
  mat3 aces_output = mat3(
    1.60475, -0.53108, -0.07367,
    -0.10208, 1.10813, -0.00605,
    -0.00327, -0.07276, 1.07602
  );
  
  vec3 x = aces_input * vec3(radiance);
  
  // RRT and ODT fit
  vec3 a = x * (x + 0.0245786) - 0.000090537;
  vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
  vec3 color = aces_output * (a / b);
  
  return RGB(pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2)));
}
```

## Implementation: Filmic (Uncharted 2)

```glsl
uniform float u_developer_filmic_exposure;

vec3 uncharted2_tonemap(vec3 x) {
  float A = 0.15;  // Shoulder strength
  float B = 0.50;  // Linear strength
  float C = 0.10;  // Linear angle
  float D = 0.20;  // Toe strength
  float E = 0.02;  // Toe numerator
  float F = 0.30;  // Toe denominator
  
  return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}

RGB develop(Radiance radiance) {
  vec3 x = vec3(radiance) * u_developer_filmic_exposure;
  vec3 color = uncharted2_tonemap(x) / uncharted2_tonemap(vec3(11.2));
  return RGB(pow(color, vec3(1.0/2.2)));
}
```

## Color Grading

```glsl
uniform float u_developer_grade_exposure;
uniform float u_developer_grade_contrast;
uniform float u_developer_grade_saturation;
uniform float u_developer_grade_temperature;
uniform float u_developer_grade_tint;

vec3 d_develop(vec3 radiance) {
  // Exposure
  vec3 color = radiance * pow(2.0, u_developer_grade_exposure);
  
  // Tone map
  color = reinhard_tonemap(color);
  
  // Contrast
  color = mix(vec3(0.5), color, u_developer_grade_contrast);
  
  // Saturation
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, u_developer_grade_saturation);
  
  // Temperature/Tint
  color = apply_color_balance(color, 
                             u_developer_grade_temperature,
                             u_developer_grade_tint);
  
  // Gamma
  return pow(color, vec3(1.0/2.2));
}
```

## Vignette Effect

```glsl
uniform float u_developer_vignette_strength;
uniform float u_developer_vignette_radius;

vec3 d_develop(vec3 radiance) {
  vec3 color = tone_map(radiance);
  
  // Apply vignette
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float dist = length(uv);
  float vignette = 1.0 - smoothstep(u_developer_vignette_radius, 1.0, dist);
  color *= mix(1.0, vignette, u_developer_vignette_strength);
  
  return pow(color, vec3(1.0/2.2));
}
```

## Gamma Correction

```glsl
// Accurate but slower
vec3 gamma_correct(vec3 color) {
  return pow(color, vec3(1.0/2.2));
}

// Fast approximation
float gamma_approx(float x) {
  return sqrt(x * (2.0 - x));
}

// Very fast (gamma = 2.0)
float gamma_fast(float x) {
  return sqrt(x);
}
```

## Analysis Modes

### False Color

```glsl
RGB develop(Radiance radiance) {
  float lum = dot(vec3(radiance), vec3(0.2126, 0.7152, 0.0722));
  
  if (lum < 0.0001) return RGB(0, 0, 0);      // Black
  if (lum < 0.01) return RGB(0, 0, 1);        // Blue
  if (lum < 0.1) return RGB(0, 1, 1);         // Cyan
  if (lum < 1.0) return RGB(0, 1, 0);         // Green
  if (lum < 10.0) return RGB(1, 1, 0);        // Yellow
  if (lum < 100.0) return RGB(1, 0.5, 0);     // Orange
  return RGB(1, 0, 0);                        // Red
}
```

### Exposure Zebras

```glsl
uniform float u_developer_zebra_low;
uniform float u_developer_zebra_high;

RGB develop(Radiance radiance) {
  vec3 color = tone_map(vec3(radiance));
  float lum = luminance(color);
  
  // Zebra pattern
  float pattern = sin(gl_FragCoord.x * 0.5 + 
                     gl_FragCoord.y * 0.5) * 0.5 + 0.5;
  
  if (lum < u_developer_zebra_low) {
    color = mix(color, vec3(0, 0, 1), pattern * 0.5);
  } else if (lum > u_developer_zebra_high) {
    color = mix(color, vec3(1, 0, 0), pattern * 0.5);
  }
  
  return RGB(gamma_correct(color));
}
```

## Common Parameters

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| exposure | float | [-5, 5] | Exposure adjustment (stops) |
| gamma | float | [1.0, 3.0] | Gamma correction |
| contrast | float | [0, 2] | Contrast adjustment |
| saturation | float | [0, 2] | Color saturation |
| temperature | float | [-1, 1] | Color temperature |
| tint | float | [-1, 1] | Green/magenta shift |
| white_point | float | [1, 10] | White point for Reinhard |

## Helper Functions

```glsl
float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 apply_color_balance(vec3 color, float temp, float tint) {
  // Temperature: shift red/blue
  color.r *= 1.0 + temp * 0.5;
  color.b *= 1.0 - temp * 0.5;
  
  // Tint: shift green/magenta
  color.g *= 1.0 + tint * 0.5;
  
  return color;
}
```

## Performance Notes

1. Apply gamma correction as final step
2. Use gamma approximations for preview modes
3. Clamp output to [0,1] for display
4. Consider LUT for complex tone curves
5. Vignette uses gl_FragCoord (screen space)

## Validation

1. Output must be in [0,1] range
2. Gamma correction must be applied
3. Preserve hue during tone mapping (when possible)
4. Handle edge cases (zero, infinite radiance)
5. Analysis modes may exceed [0,1] intentionally
