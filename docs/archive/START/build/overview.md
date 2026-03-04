## Complete Implementation Blueprint

### Phase 1: Minimal GPU Triangle
**Build:**
- Engine core: ModuleRegistry, SimpleCompiler, RenderExecutor
- Hardcoded vertex/fragment shaders outputting red
- Full-screen quad geometry setup
- Basic WebGL initialization

**See:** Red screen

**Architecture test:** Module validation, shader compilation, WebGL pipeline

---

### Phase 2: First Ray + Minimal App Shell
**Build:**
- Euclidean geometry module (`geometry_geodesic`, `geometry_frame`)
- Pinhole camera module (`camera_generateRay`)
- MinimalApp class (holds Engine, has `render()` method)
- KIND-based prefixing validation in Registry

**See:** Ray directions as colors

**Architecture test:** Module loading, KIND prefixing, concatenation order

---

### Phase 3: First Hit (Minimal)
**Build:**
- Hand-written Scene module with single sphere SDF
- `scene_intersect()` with ray marching
- Minimal Hit structure: `{p, n, t}`
- Normal visualization (no materials yet!)

**See:** Shaded sphere (normals as colors)

**Architecture test:** Ray marching, SDF evaluation

---

### Phase 4: First Material Property
**Build:**
- Extend Hit: `{p, n, t, material_to}`
- `scene_material_properties()` returns just `{albedo}`
- Simple Interaction module: `interaction_surface_shade()` returns albedo
- Simple Transport: direct camera ray only, no bounces

**See:** Solid color sphere

**Architecture test:** **DATA/BEHAVIOR SEPARATION** - Scene provides data, Interaction provides behavior

---

### Phase 5: First Parameters
**Build:**
- ParameterStore with `camera.position` and `camera.fov`
- Wire to MinimalApp
- Manual uniform updates through Engine
- Direct onChange handler (no coordinator yet)

**See:** Camera moves via parameters

**Architecture test:** Parameter flow, state management

---

### Phase 6: Lambert Direct Lighting (ONE-SHOT)
**Build:**
- Hand-written Lighting module with single point light
- `lighting_sample()` returns light position/radiance
- Shadow rays in Transport using `scene_intersect_any()`
- Lambert shading with cosine weighting
- Extend MaterialProperties: `{albedo, emission}`
- Extend Hit: `{p, n, t, material_to, frame}`
- **NO ACCUMULATION** - single sample per pixel

**See:** Lit sphere with hard shadows

**Architecture test:** Direct lighting pipeline, shadow rays

---

### Phase 7: First Film (Still One-Shot)
**Build:**
- Film module with `film_accumulate()`
- But `u_sample_count = 0` always (no accumulation yet)
- Developer module with `developer_develop()` (just gamma correction)
- Complete main() orchestration

**See:** Same as Phase 6, but through complete pipeline

**Architecture test:** Film pipeline established, developer integration

---

### Phase 8: Progressive Accumulation
**Build:**
- Add render loop to MinimalApp
- Increment sample counter each frame
- Film now accumulates (simple averaging: `mix(old, new, 1/(n+1))`)
- Still just direct lighting Lambert!

**See:** Noisy shadows smoothing out over time

**Architecture test:** Accumulation mathematics, temporal integration

---

### Phase 9: Path Tracing WITHOUT NEE
**Build:**
- Multiple bounces in Transport (`MAX_BOUNCES = 10`)
- **NO light sampling** - just trace until hitting emission
- Materials get emission property
- `interaction_surface_scatter()` for direction sampling
- Russian roulette after 3 bounces
- Material emission check: `if (props.emission > 0)`

**See:** Global illumination (very noisy without NEE!)

**Architecture test:** Indirect lighting, path throughput

---

### Phase 10: Reset Logic
**Build:**
- ParameterMetadata with `triggersReset` flag
- Reset detection in MinimalApp
- `u_film_reset` uniform flag
- Reset prefixes: `camera.*`, `material.*`
- No-reset prefixes: `developer.*`

**See:** Accumulation resets when camera moves

**Architecture test:** Parameter change detection, accumulation management

---

### Phase 11: WorldCompiler Introduction
**Build:**
- SceneCompiler generates Scene module from descriptions
- LightingCompiler generates Lighting module
- Materials with `light_id = -1` (not emissive yet)
- PassthroughCompiler for geometry (still hand-written)

**See:** Same lit sphere, but from compiled modules

**Architecture test:** Compilation pipeline, module generation

---

### Phase 12: Material→Light References
**Build:**
- Add emissive material to scene
- WorldCompiler assigns `light_id >= 0` to emissive materials
- Materials directly reference their lights
- Transport checks `if (props.light_id >= 0)`
- Still no MIS (full contribution from emissives)

**See:** Glowing sphere

**Architecture test:** Material→light references work

---

### Phase 13: NEE with MIS
**Build:**
- Complete Hit structure: `{p, n, t, material_from, material_to, frame, uv}`
- `lighting_can_sample()` check in Transport
- Power heuristic: `weight = (pdf_a^2) / (pdf_a^2 + pdf_b^2)`
- Both light sampling AND BSDF sampling
- Combine direct and indirect lighting

**See:** Clean global illumination with proper variance reduction

**Architecture test:** MIS with light_ids, complete light transport

---

### Phase 14: RenderCoordinator
**Build:**
- Extract render loop from MinimalApp
- Three modes: interactive/progressive/production
- Mode-specific execution strategies
- Reset decision logic moved to coordinator
- Progress reporting callbacks

**See:** Mode switching, progress tracking

**Architecture test:** Execution management separated from app


---

### Phase 15: Full Transport Features
**Build:**
- Volume support with delta tracking
- Complete material interface resolution
- Advanced sampling strategies
- Proper `material_from`/`material_to` handling

**See:** Volumes, glass, nested dielectrics

**Architecture test:** Complete transport algorithms



---

### Phase 16: Full ResearchApp + Recipes
**Build:**
- ResearchApp with recipe system
- RecipeBundle with 2-3 recipes (pathtracer, debug, production)
- Eager compilation at startup
- Per-recipe film buffers
- Instant recipe switching

**See:** Switch between pathtracer/debug instantly, accumulation preserved

**Architecture test:** Recipe management, resource preservation

---

### Phase 17: Extension System
**Build:**
- Extension interface with install/uninstall
- Service registry pattern
- EventBus for loose coupling
- KeyboardInput extension (r=reset, space=pause)
- Basic UI extension with stats

**See:** Keyboard controls, stats overlay

**Architecture test:** Extensions work, service discovery

---

### Phase 18: SessionManager
**Build:**
- State capture (parameters, camera, extensions)
- JSON serialization
- Save/load with version checking
- Extension state persistence

**See:** Save session, reload exactly same state

**Architecture test:** Complete reproducibility

---

### Phase 19: Advanced Materials
**Build:**
- Disney BRDF in Interaction
- Full MaterialProperties (roughness, metallic, IOR)
- GGX distribution functions
- Fresnel equations
- Complex `interaction_surface_scatter()` with VNDF sampling

**See:** Realistic materials (metals, rough surfaces, glass)

**Architecture test:** Complex shading models

---

### Phase 20: Production Features
**Build:**
- UI panel extensions
- Parameter sweep experiments
- Screenshot/export extensions
- Advanced developer modes (ACES, false color, variance visualization)
- Tiled rendering in production mode

**See:** Full research tool with all features

**Architecture test:** System complete, ready for research

---

## Key Milestones

- **Phase 4**: Data/behavior separation proven
- **Phase 6**: Direct lighting without accumulation
- **Phase 8**: Accumulation added to direct lighting
- **Phase 9**: Path tracing without NEE (needs accumulation)
- **Phase 12**: Material→light references established
- **Phase 13**: Full MIS combining everything
- **Phase 15**: Multi-recipe system with instant switching
- **Phase 20**: Production-ready research tool

This progression ensures we always have something working on screen while building the real architecture progressively!
