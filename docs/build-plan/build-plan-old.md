# Incremental Build Plan for Research Path Tracer

## Phase 1: Minimal Viable Renderer (Get Pixels on Screen)

### Step 1.1: Minimal Modules

**World Modules:**
```glsl
// euclidean_geometry.glsl
typedef vec3 Point;
typedef vec3 Direction;

Point g_geodesic(Point origin, Direction dir, float t) {
  return origin + dir * t;
}

float g_dot(Direction v1, Direction v2, Point p) {
  return dot(v1, v2);  // Euclidean is simple!
}
```

```glsl
// constant_material.glsl
vec3 m_shade(Direction wi, Hit hit) {
  return vec3(0.8, 0.2, 0.2);  // Just return red
}
```

```glsl
// simple_sdf_scene.glsl
bool sc_intersect(Ray ray, out Hit hit) {
  // Just a sphere at origin
  float t = 0.0;
  for (int i = 0; i < 100 && t < 100.0; i++) {
    Point p = g_geodesic(ray.origin, ray.direction, t);
    float d = length(p) - 1.0;  // Sphere radius 1
    
    if (d < 0.001) {
      hit.p = p;
      hit.n = normalize(p);
      hit.t = t;
      hit.object_id = 0;
      return true;
    }
    t += d;
  }
  return false;
}
```

```glsl
// point_light.glsl
LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  ls.wi = normalize(vec3(1, 1, 1) - p);
  ls.radiance = vec3(1.0);
  ls.distance = 10.0;
  ls.pdf = 1.0;
  return ls;
}
```

**Photography Modules:**
```glsl
// pinhole_camera.glsl
Ray c_generate_ray(vec2 pixel, vec2 xi) {
  vec2 ndc = (pixel - 0.5 * u_resolution) / u_resolution.y;
  return Ray(
    vec3(0, 0, 5),  // Fixed position
    normalize(vec3(ndc, -1.0))  // Look down -Z
  );
}
```

```glsl
// oneshot_estimator.glsl
vec3 e_estimate(Ray ray) {
  Hit hit;
  if (sc_intersect(ray, hit)) {
    return m_shade(-ray.direction, hit);
  }
  return vec3(0.1, 0.1, 0.3);  // Sky color
}
```

```glsl
// passthrough_film.glsl
vec3 f_accumulate(vec3 radiance, vec2 pixel) {
  return radiance;  // No accumulation
}
```

```glsl
// passthrough_developer.glsl
vec3 d_develop(vec3 radiance) {
  return clamp(radiance, 0.0, 1.0);  // Just clamp
}
```

### Step 1.2: Minimal Engine Components

**Priority order:**
1. **ModuleRegistry** - Store the modules
2. **ShaderCompiler** - Assemble GLSL (skip material dispatcher)
3. **RenderExecutor** - Draw the quad
4. **UniformBinder** - Just bind u_resolution for now
5. **ResourceManager** - Minimal framebuffer setup

### Step 1.3: Minimal App

```typescript
// Bare minimum app
class MinimalApp {
  constructor(canvas) {
    this.engine = new Engine(canvas.getContext('webgl2'));
    
    // Register modules
    this.registerMinimalModules();
    
    // Create recipe
    const recipe = {
      world: {
        geometry: { kind: "Geometry", name: "Euclidean" },
        material: { kind: "Material", name: "Constant" },
        scene: { kind: "Scene", name: "SimpleSDF" },
        lights: { kind: "Lights", name: "Point" }
      },
      photography: {
        camera: { kind: "Camera", name: "Pinhole" },
        estimator: { kind: "Estimator", name: "OneShot" },
        film: { kind: "Film", name: "Passthrough" },
        developer: { kind: "Developer", name: "Passthrough" }
      }
    };
    
    // Compile and render
    this.engine.compileRecipe(recipe);
    this.engine.renderFrame();
  }
}
```

**Expected Output:** A red sphere on blue background!

---

## Phase 2: Add Movement (Camera Control)

### Step 2.1: ParameterStore
- Add basic parameter tracking
- Wire camera.position to uniforms

### Step 2.2: Input Extension
- Simple keyboard controls (arrows move camera)
- Update camera.position parameter

### Step 2.3: RenderCoordinator
- Handle continuous rendering
- Reset logic (not needed yet, but structure it)

**Expected Output:** Can fly around the sphere!

---

## Phase 3: Add Accumulation (Path Tracing)

### Step 3.1: Better Estimator
```glsl
// path_tracer.glsl
vec3 e_estimate(Ray ray) {
  Hit hit;
  if (!sc_intersect(ray, hit)) {
    return vec3(0.1, 0.1, 0.3);
  }
  
  // Direct lighting only for now
  LightSample ls = l_sample_light(hit.p, vec2(0.5));
  float NdotL = max(0.0, dot(ls.wi, hit.n));
  return m_shade(-ray.direction, hit) * ls.radiance * NdotL;
}
```

### Step 3.2: Accumulating Film
```glsl
// accumulating_film.glsl
vec3 f_accumulate(vec3 radiance, vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  vec3 history = texture(u_film_radiance, uv).rgb;
  float count = float(u_sample_count);
  return mix(history, radiance, 1.0 / (count + 1.0));
}
```

### Step 3.3: ResourceManager Film Buffers
- Create ping-pong buffers
- Implement buffer swapping

**Expected Output:** Smooth, antialiased sphere with proper lighting!

---

## Phase 4: Add Materials (Disney BRDF)

### Step 4.1: Full Material System
- Replace constant material with Disney BRDF
- Add material parameters (roughness, metallic)

### Step 4.2: Multiple Objects
- Extend SDF scene with more shapes
- Per-object material parameters

### Step 4.3: Full Path Tracer
- Multiple bounces
- Russian roulette
- Importance sampling

**Expected Output:** Shiny and rough spheres!

---

## Phase 5: Add UI (Parameter Control)

### Step 5.1: UI Extension
- Parameter sliders
- Material controls
- Camera settings

### Step 5.2: SessionManager
- Save/load scenes
- Parameter persistence

**Expected Output:** Interactive parameter editing!

---

## Phase 6: Production Features

### Step 6.1: Tile Rendering
- TiledRenderExecutor
- High resolution support

### Step 6.2: Export Extension
- Save images (PNG, EXR)
- Batch rendering

### Step 6.3: Developer Options
- Tonemapping (ACES, Reinhard)
- Color grading

**Expected Output:** Production-quality renders!

---

## Phase 7: Advanced Geometry

### Step 7.1: Non-Euclidean
- Spherical geometry
- Hyperbolic geometry

### Step 7.2: Complex Scenes
- CSG operations
- Mesh loading (future)

**Expected Output:** Mind-bending non-Euclidean renders!

---

## Development Tips

### Start Small
- Get Phase 1 working first (should take 1-2 days)
- Each phase adds one major concept
- Test thoroughly before moving on

### File Organization
```
src/
├── modules/          # Start here - write simple GLSL
│   ├── euclidean.glsl
│   └── pinhole.glsl
├── engine/          # Build minimal version first
│   └── Engine.ts    # Just compile + render
└── app/
    └── MinimalApp.ts # Hardcode everything initially
```

### Debug Strategy
1. Start with solid colors (no lighting)
2. Add normals visualization
3. Then add lighting
4. Finally add accumulation

### Common Issues to Avoid
- Don't forget to normalize ray directions
- Check your coordinate systems (Y-up vs Z-up)
- Start with float32 textures from the beginning
- Use console.log liberally in the compiler

---

## Success Metrics

**Phase 1 Success:** See a red sphere ✓
**Phase 2 Success:** Can move camera ✓
**Phase 3 Success:** Smooth antialiased image ✓
**Phase 4 Success:** Metallic and rough materials ✓
**Phase 5 Success:** Real-time parameter editing ✓
**Phase 6 Success:** 4K production renders ✓
**Phase 7 Success:** Hyperbolic geometry! ✓

---

## Time Estimates

- Phase 1: 1-2 days (critical foundation)
- Phase 2: 1 day (parameter system)
- Phase 3: 1 day (accumulation)
- Phase 4: 2-3 days (materials are complex)
- Phase 5: 2 days (UI can be finicky)
- Phase 6: 2 days (production features)
- Phase 7: 1 week+ (research territory)

**Total to useful system: ~1 week**
**Total to complete system: ~2-3 weeks**
