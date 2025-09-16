# Sampler Module Contract

Samplers provide deterministic, stratified random numbers for Monte Carlo integration.

## Required Functions

### s_sample_1d
```glsl
float s_sample_1d(ivec2 pixel_id, int sample_id, int dimension)
```
Generate a single random number in [0,1].

### s_sample_2d
```glsl
vec2 s_sample_2d(ivec2 pixel_id, int sample_id, int dimension)
```
Generate a 2D random point in [0,1]².

### s_sample_3d
```glsl
vec3 s_sample_3d(ivec2 pixel_id, int sample_id, int dimension)
```
Generate a 3D random point in [0,1]³.

**Parameters for all:**
- `pixel_id`: Integer pixel coordinates (for stratification)
- `sample_id`: Which sample in the sequence (typically u_frame_index)
- `dimension`: Which random number dimension (increment for each use)

## Optional Specialized Functions

### s_sample_sphere
```glsl
vec3 s_sample_sphere(ivec2 pixel_id, int sample_id, int dimension)
```
Uniformly sample unit sphere surface.

### s_sample_hemisphere
```glsl
vec3 s_sample_hemisphere(vec3 normal, ivec2 pixel_id, int sample_id, int dimension)
```
Uniformly sample hemisphere around normal.

### s_sample_disk
```glsl
vec2 s_sample_disk(ivec2 pixel_id, int sample_id, int dimension)
```
Uniformly sample unit disk.

### s_sample_cosine_hemisphere
```glsl
vec3 s_sample_cosine_hemisphere(vec3 normal, ivec2 pixel_id, int sample_id, int dimension)
```
Cosine-weighted hemisphere sampling.

## Usage Example

```glsl
vec3 e_estimate(vec2 pixel) {
  ivec2 pixel_id = ivec2(pixel);
  int dimension = 0;
  
  // Sample for antialiasing
  vec2 xi = s_sample_2d(pixel_id, u_frame_index, dimension++);
  Ray ray = c_generate_ray(pixel, xi);
  
  // Sample for BRDF
  vec2 xi_brdf = s_sample_2d(pixel_id, u_frame_index, dimension++);
  // ...
}
```

## Implementation Notes

- Samplers should be deterministic (same inputs → same outputs)
- Use pixel_id for stratification across pixels
- Use sample_id for different samples of same pixel
- Dimension allows high-dimensional sampling
- For best results, use low-discrepancy sequences

## Common Implementations

- **Uniform**: Basic pseudo-random
- **Halton**: Low-discrepancy sequence
- **Sobol**: Bit-operation based
- **Blue Noise**: From precomputed texture
- **Stratified**: Jittered grid

## Module ID Convention

```typescript
id: { kind: "Sampler", name: "YourSamplerName", version: "1.0.0" }
```
