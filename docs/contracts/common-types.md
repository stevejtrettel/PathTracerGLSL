# Common Types

These types are provided by the Engine and available in ALL shaders.

## Structs

### Ray
```glsl
struct Ray {
  vec3 o;  // origin
  vec3 d;  // direction (should be normalized)
};
```

### Hit
```glsl
struct Hit {
  vec3 p;     // hit point
  vec3 n;     // normal (normalized)
  float t;    // ray parameter
  vec2 uv;    // texture coordinates
  int mat_id; // material identifier
};
```

### Frame
```glsl
struct Frame {
  vec3 t;  // tangent
  vec3 b;  // bitangent  
  vec3 n;  // normal
};
```

## Engine-Provided Uniforms

Always available in every shader:

```glsl
uniform vec2 u_resolution;   // Screen resolution
uniform int u_frame_index;   // Current frame number
uniform float u_time;        // Seconds since start
uniform int u_sample_count;  // Accumulated samples (for convergent rendering)
```

## Usage

```glsl
// You can use these types directly:
Ray ray = Ray(origin, direction);
Hit hit;
if (intersect(ray, hit)) {
  // hit is populated
}
```

## Notes

- Directions in Ray should be normalized before use
- Hit normal always points outward from surface
- Frame vectors form an orthonormal basis
- mat_id indexes into the scene's material array
