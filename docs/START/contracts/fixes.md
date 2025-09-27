Looking through the Objects pillar documentation, I see a few things that need updating for consistency:

## 1. **WorldCompiler naming**
The compiler is still called "WorldCompiler" throughout. For consistency with the pillar rename, it should probably be:
- `WorldCompiler` → `ObjectsCompiler`
- This appears in many places including the compilation pipeline diagrams

## 2. **Directory structure references**
The file organization still shows:
```
world/            
├── geometry/     # Hand-written modules
├── compiler/     # WorldCompiler system
```

Should be:
```
objects/            
├── ambient/      # Hand-written ambient space modules
├── compiler/     # ObjectsCompiler system
```

## 3. **Function references in compiled modules**
In the Scene module's generated code, there are still references to `geometry_geodesic()` that should be `ambient_geodesic()`:

```glsl
// During ray marching
for (int step = 0; step < MAX_STEPS; step++) {
  Point p = ambient_geodesic(ray.origin, ray.direction, t);  // Changed from geometry_
  ...
}
```

## 4. **Module validation references**
The ModuleRegistry validation rules mention:
- "a Geometry module must provide `geometry_geodesic`..."

Should be:
- "an AmbientSpace module must provide `ambient_geodesic`..."

## 5. **Recipe structure**
Some examples still show:
```typescript
world: {
  geometry: 'euclidean',
  ...
}
```

Should consistently be:
```typescript
objects: {
  ambient: 'euclidean',
  ...
}
```

These are mostly search-and-replace changes, but they're important for consistency across the codebase. The core architecture and contracts remain the same - just the naming needs to align with the Objects/Optics paradigm and the ambient space terminology.




Looking at the Optics pillar documentation, here are the key changes needed:

## 1. **Multi-Output Architecture**
The pipeline diagrams and data flow need to show parallel outputs:

```glsl
// Old: Linear pipeline
Pixel → Camera → Transport → Film → Developer → RGB

// New: Parallel outputs
Pixel → Camera → Transport → Film → Radiance ─┬─→ Raw Output
                                               └─→ Developer → RGB Output
```

## 2. **Film Module Contract Update**
Film should explicitly manage both accumulation buffers:

```glsl
// Film module outputs both radiance and metadata
void film_accumulate(Spectrum radiance, vec2 pixel) {
  // Update radiance accumulation buffer
  radiance_buffer[pixel] = update_radiance(...);
  
  // Update variance tracking
  variance_buffer[pixel] = update_variance(...);
  
  // Track sample count
  sample_count[pixel]++;
}

// Film provides access to raw accumulated data
Radiance film_get_radiance(vec2 pixel);
float film_get_variance(vec2 pixel);
int film_get_sample_count(vec2 pixel);
```

## 3. **Main Function Update**
The main shader function should write to multiple outputs:

```glsl
// Multiple render targets
layout(location = 0) out vec4 fragRadiance;  // Raw radiance
layout(location = 1) out vec4 fragRGB;       // Tone-mapped
layout(location = 2) out vec4 fragAux;       // Variance/metadata

void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 xi = next_2d();
  
  Ray ray = camera_generateRay(pixel, xi);
  Spectrum radiance = transport_trace(ray);
  
  // Accumulate and output raw radiance
  Radiance accumulated = film_accumulate(radiance, pixel);
  fragRadiance = vec4(accumulated, 1.0);
  
  // Parallel tone mapping for display
  RGB color = developer_develop(accumulated);
  fragRGB = vec4(color, 1.0);
  
  // Optional: variance or other metadata
  fragAux = vec4(film_get_variance(pixel), sample_count, 0, 1);
}
```

## 4. **OpticsOutput Interface**
Add explicit output interface definition:

```typescript
interface OpticsOutput {
  // Primary measurements
  radiance: WebGLTexture;      // Raw HDR radiance (W/sr/m²)
  rgb: WebGLTexture;           // Tone-mapped RGB for display
  
  // Statistical data
  variance?: WebGLTexture;     // Per-pixel variance
  sampleCount: number;         // Global sample count
  
  // Future expansion
  depth?: WebGLTexture;        // Geometric depth
  normal?: WebGLTexture;       // Surface normals
  albedo?: WebGLTexture;       // Material albedo
}
```

## 5. **Module Dependencies Update**
Transport and other modules can now query Film for intermediate data:

```glsl
// Transport can access accumulation for adaptive sampling
Spectrum transport_trace(Ray ray) {
  vec2 pixel = get_current_pixel();
  float current_variance = film_get_variance(pixel);
  
  if (current_variance < threshold) {
    // This pixel has converged, use simpler strategy
  }
  ...
}
```

## 6. **Developer Module Clarification**
Explicitly state that Developer runs in parallel, not as post-process:

```
Developer doesn't modify the radiance buffer - it provides a parallel 
interpretation for human viewing. Both outputs (radiance and RGB) are 
generated each frame, allowing instant switching between analysis and viewing.
```

## 7. **Recipe Examples Update**
Show how recipes configure multi-output:

```typescript
const scientificRecipe = {
  objects: { ... },
  optics: {
    camera: 'pinhole',
    transport: 'pathtracer',
    interaction: 'disney',
    film: 'variance',      // Tracks variance for analysis
    developer: 'linear'    // Minimal tone mapping for scientific work
  },
  outputs: {
    radiance: true,        // Enable radiance buffer
    rgb: true,            // Enable display buffer
    variance: true        // Enable variance tracking
  }
};
```

## 8. **Convergence and Analysis**
Add sections on how the multi-output design enables analysis:

```
The parallel output design enables real-time convergence analysis:
- Variance buffer tracks per-pixel convergence
- Radiance buffer provides ground truth for error metrics
- RGB buffer shows artistic intent
- All three update simultaneously without interference
```

These changes make the dual nature of Optics as both a measurement device and visualization tool explicit throughout the documentation, while maintaining the clean separation between physics computation and human presentation.
