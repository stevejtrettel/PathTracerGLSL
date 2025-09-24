
# Complete Build Strategy

## Phase 0: Foundation (Day 1-2)
**Goal**: Basic math and types

```typescript
src/
├── math/
│   ├── vec3.ts              // Vector operations
│   ├── mat4.ts              // Matrix operations
│   └── sampling.ts          // Random sampling utilities
└── shared/
    └── types.ts             // Core type definitions
```

**Validation**: Math tests pass

## Phase 1: Minimal Triangle (Day 3-5)
**Goal**: See a sphere with normal shading

### 1.1 Minimal Engine
```typescript
src/engine/
├── Engine.ts               // Just compile + render
├── SimpleCompiler.ts       // String concatenation
└── ModuleRegistry.ts       // Store modules
```

### 1.2 Hardcoded World
```glsl
// Hardcoded modules (no compilation yet)
src/world/
├── geometry/
│   └── euclidean.glsl     // geometry_geodesic(), etc.
└── hardcoded/
    ├── scene.glsl         // scene_intersect() with one sphere
    └── lighting.glsl      // lighting_sample() returns white
```

### 1.3 Minimal Photography
```glsl
src/photography/
├── camera/
│   └── pinhole.glsl       // camera_generateRay()
├── transport/
│   └── simple.glsl        // transport_trace() - first hit only
├── interaction/
│   └── debug_normal.glsl  // interaction_surface_shade() returns normal
├── film/
│   └── simple.glsl        // film_accumulate() - no accumulation
└── developer/
    └── linear.glsl        // developer_develop() - passthrough
```

### 1.4 Minimal App
```typescript
src/app/
└── main.ts                // Load modules, compile, render loop
```

**Validation**: Colored sphere on screen (normal visualization)

## Phase 2: Basic Path Tracing (Day 6-8)
**Goal**: Diffuse bounces with accumulation

### 2.1 Real Transport
```glsl
// Replace simple.glsl
src/photography/transport/
└── pathtracer.glsl        // Actual path tracing (no NEE yet)
```

### 2.2 Lambert Interaction
```glsl
src/photography/interaction/
└── lambert.glsl           // Cosine-weighted sampling
```

### 2.3 Working Film
```glsl
src/photography/film/
└── accumulator.glsl       // Progressive averaging
```

### 2.4 Add ParameterStore
```typescript
src/app/
├── ParameterStore.ts      // State management
└── RenderCoordinator.ts   // Reset logic
```

**Validation**: Converging diffuse Cornell box

## Phase 3: World Compilation (Day 9-12)
**Goal**: Compiled scenes from descriptions

### 3.1 Implement Compilers
```typescript
src/world/compiler/
├── WorldCompiler.ts       // Orchestrator
├── SceneCompiler.ts       // Objects → GLSL
└── LightingCompiler.ts    // Lights → GLSL
```

### 3.2 Scene Descriptions
```typescript
src/scenes/
├── cornell-box.ts         // Classic test
└── sphere-on-plane.ts     // Simple scene
```

### 3.3 Material→Light System
- Implement cross-referencing
- Test emissive materials
- Verify MIS setup

**Validation**: Compiled scene matches hardcoded

## Phase 4: Complete Interaction (Day 13-16)
**Goal**: Disney BRDF with proper MIS

### 4.1 Disney Interaction
```glsl
src/photography/interaction/
└── disney.glsl            // Full Disney BRDF
```

### 4.2 NEE in Transport
- Add next event estimation
- Implement MIS weights
- Test with area lights

### 4.3 Additional Developers
```glsl
src/photography/developer/
├── reinhard.glsl
└── aces.glsl
```

**Validation**: Glass sphere with caustics

## Phase 5: Complete Engine (Day 17-19)
**Goal**: All subsystems working

### 5.1 ResourceManager
```typescript
src/engine/
└── ResourceManager.ts     // Per-recipe buffers
```

### 5.2 RenderExecutor
```typescript
src/engine/
└── RenderExecutor.ts      // Full-screen triangle
```

### 5.3 Recipe Switching
- Test accumulation preservation
- Verify instant switching

**Validation**: Switch recipes without losing samples

## Phase 6: Full App (Day 20-22)
**Goal**: Complete orchestration

### 6.1 ResearchApp
```typescript
src/app/
├── ResearchApp.ts         // Main orchestrator
└── SessionManager.ts      // Save/load
```

### 6.2 Core Extensions
```typescript
src/extensions/
├── InputExtension.ts      // Camera controls
├── UIExtension.ts         // Parameter panel
└── StatsExtension.ts      // Performance display
```

**Validation**: Interactive research tool

## Phase 7: Volumes (Day 23-25)
**Goal**: Delta tracking

### 7.1 Volume Properties
- Add to MaterialProperties
- Implement in Scene

### 7.2 Volume Transport
```glsl
// Add to pathtracer.glsl
- Delta tracking
- Beer's law
```

### 7.3 Phase Functions
```glsl
// Add to interaction
- Henyey-Greenstein
- Isotropic
```

**Validation**: Volumetric caustics

## Phase 8: Production Features (Day 26-28)
**Goal**: Research-ready system

### 8.1 Advanced Extensions
```typescript
src/extensions/
├── ExperimentExtension.ts // Parameter sweeps
├── ExportExtension.ts     // Image/data export
└── ComparisonExtension.ts // A/B testing
```

### 8.2 Additional Geometries
```glsl
src/world/geometry/
├── spherical.glsl
└── hyperbolic.glsl
```

### 8.3 Environment Maps
- HDR loading
- Importance sampling

**Validation**: Publication-quality renders

## Testing Strategy

Each phase should have tests:

```typescript
tests/
├── phase1/
│   └── sphere-visible.test.ts
├── phase2/
│   └── convergence.test.ts
├── phase3/
│   └── compilation.test.ts
└── integration/
    └── full-system.test.ts
```

## Key Implementation Notes

1. **Start simple** - Get pixels on screen first
2. **Test each phase** - Don't move on until working
3. **Keep modules small** - Easy to debug
4. **Use KIND prefixing** - `camera_generateRay()` for all cameras
5. **Compile eagerly** - All recipes at startup
6. **Direct wiring** - ParameterStore → Engine for performance

## Success Metrics

- **Phase 1**: Something visible (2 days)
- **Phase 2**: Convergence works (4 days)
- **Phase 3**: Compilation works (8 days)
- **Phase 4**: Quality renders (12 days)
- **Phase 5**: Recipe switching (16 days)
- **Phase 6**: Full app (20 days)
- **Phase 7**: Volumes (24 days)
- **Phase 8**: Production (28 days)
