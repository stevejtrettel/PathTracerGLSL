# From Modules to Compilation: Architectural Evolution

## 1. Executive Summary

This document describes a fundamental architectural shift in how the path tracer generates shaders. The current system organizes code into nine fixed module kinds (`camera`, `scene`, `transport`, etc.) designed for hand-written GLSL composition. As the system evolves toward code generation, these module boundaries have become artificial constraints rather than helpful structure.

**Key Insight**: Module boundaries conflate two distinct concerns:
- **WHAT to render** (compositional choices: which camera, which materials, which transport algorithm)
- **WHERE code goes** (structural organization in the final shader)

For hand-written modules, these aligned naturally. For generated code, they create unnecessary friction.

**Proposed Solution**: Replace module-based composition with a compilation pipeline that takes high-level descriptions and generates optimal GLSL without artificial organizational constraints.

---

## 2. The Original Vision: Modular Composition

### 2.1. Design Intent

The nine module system was designed for **mix-and-match composition** of pre-written rendering components:

```typescript
const recipe = {
  world: {
    scene: sphereFlakeScene,        // Pre-written SDF marcher
    environment: hdriEnvironment,   // Pre-written env sampling
    lighting: quadLightModule       // Pre-written light source
  },
  optics: {
    camera: pinholeCamera,          // Pre-written ray generator
    interaction: lambertBRDF,       // Pre-written material model
    transport: pathTracerGI,        // Pre-written path tracer
    accumulator: progressiveSampler // Pre-written accumulation
  }
};
```

Each module was:
- **Self-contained**: Complete GLSL code with uniforms and functions
- **Swappable**: Replace `pinholeCamera` with `thinLensCamera` without touching other modules
- **Composable**: Modules followed contracts (e.g., `camera_generateRay(vec2) → Ray`)

### 2.2. When This Worked Well

This architecture excelled at:

**Research exploration**: Try different cameras, BRDFs, or transport algorithms by swapping modules

**Debug workflows**: Create recipes for different views (albedo-only, normals-only) by swapping transport modules

**Clean boundaries**: Each researcher could work on their module kind without stepping on others

**Shader assembly**: Concatenate modules in dependency order, add `main()`, compile

### 2.3. The Implicit Assumption

The system assumed: **One module kind = One semantic concern = One section of GLSL**

This held true when modules were hand-written GLSL blobs.

---

## 3. The Breaking Point: Code Generation

### 3.1. The Volumetric Rendering Problem

Consider volumetric scattering (smoke, fog, subsurface). Efficient implementation requires:

**From Transport**:
- Scattering algorithm (random walk, delta tracking)
- Phase function sampling (Henyey-Greenstein)
- Beer's law absorption
- Russian roulette

**From Scene**:
- Specific geometry (is ray still inside this smoke cube?)
- Boundary detection (where does ray exit?)
- Normal computation (for refraction at boundaries)

**The Challenge**: A volume handler needs code from multiple "modules," but for performance, it must be a **single specialized function** with geometry baked in.

```glsl
// Efficient: specialized handler with inline geometry
void handle_volume_smokeCube(inout Ray ray, ...) {
  while (true) {
    // Transport: sample scattering distance
    float t = -log(random()) / sigma_t;
    vec3 next_pos = pos + t * dir;
    
    // Scene: inline geometry check (no function call)
    if (box_sdf(next_pos, vec3(0,2,0), vec3(1,1,1)) > 0.0) {
      // exited
    }
    
    // Transport: scatter
    dir = sample_henyey_greenstein(dir, g);
  }
}
```

**Question**: Which module does this function belong to?
- Transport? (It's a transport algorithm)
- Scene? (It has geometry code inlined)
- Both? (But modules are supposed to be independent)

### 3.2. The Material Compilation Problem

Materials demonstrate the same issue:

```glsl
// Generated function mixing concerns
vec3 queryMaterialAlbedo(int matId, vec3 p, vec3 n, vec2 uv) {
  switch(matId) {
    case 0: return vec3(0.8, 0.8, 0.8);  // constant
    case 1: return u_material_gold_color;  // uniform
    case 2:  // procedural
      float pattern = sin(p.x * 10.0) * cos(p.y * 10.0);
      return mix(vec3(0.8, 0.1, 0.1), vec3(0.1, 0.1, 0.8), pattern);
  }
}
```

This function contains:
- Material property queries (interaction concern)
- Scene-dependent evaluation (scene concern: position `p`)
- Compiled switch statement (neither module wrote this)

### 3.3. The Fundamental Tension

**Module boundaries assume**: Code is written by humans and belongs to clear semantic categories.

**Code generation requires**: Freedom to place code wherever dependencies and performance dictate.

The module system has become a **constraint, not structure**.

---

## 4. Separating Concerns Correctly

### 4.1. Two Distinct Problems

The system conflates two separate concerns:

**Concern 1: Compositional Choices** (WHAT)
- Which camera model? (pinhole, thin lens, orthographic)
- Which transport algorithm? (path tracing, direct lighting, ambient occlusion)
- Which tone mapping? (gamma, filmic, ACES)
- **Purpose**: Let researchers experiment, swap algorithms, create debug views

**Concern 2: Code Organization** (WHERE)
- What order should functions appear in the shader?
- Which functions should be inlined vs. separate?
- How should uniforms be grouped?
- **Purpose**: Generate efficient, compilable GLSL

For hand-written modules, these naturally aligned. For code generation, they're orthogonal.

### 4.2. The Key Insight

**Module boundaries are OUTPUT constraints masquerading as INPUT structure.**

The compiler should:
- Accept high-level descriptions (materials, objects, algorithms)
- Analyze dependencies
- Generate code in whatever order and structure is optimal
- Not be constrained by artificial "module" buckets

---

## 5. The New Architecture

### 5.1. Four-Layer Model

```
Layer 1: Descriptions (Input)
    ↓
Layer 2: Analysis & Compilation
    ↓
Layer 3: Generated Shader (Output)
    ↓
Layer 4: Execution (Engine)
```

### 5.2. Layer 1: Descriptions

**World Description** - Declarative scene definition:
```typescript
interface WorldDescription {
  materials: MaterialDescription[];   // What substances exist
  objects: ObjectDescription[];       // What geometry exists
  lights: LightDescription[];         // What light sources exist
  camera: CameraConfig;               // How to view the scene
  environment: EnvironmentConfig;     // What surrounds the scene
}
```

**Rendering Strategy** - Algorithmic choices:
```typescript
interface RenderingStrategy {
  transport: 'path_tracer' | 'direct_lighting' | 'ambient_occlusion';
  sampling: 'progressive' | 'oneshot';
  tonemap: 'gamma' | 'filmic' | 'aces';
  debug?: 'full' | 'albedo' | 'normals' | 'depth';
}
```

**Recipe** - Complete specification:
```typescript
interface Recipe {
  id: string;
  name: string;
  world: WorldDescription;
  rendering: RenderingStrategy;
}
```

### 5.3. Layer 2: Compilation

**World Compiler** - Translates descriptions to GLSL:

```typescript
function compileRecipe(recipe: Recipe): CompiledShader {
  // Phase 1: Analysis
  const analysis = analyzeRecipe(recipe);
  // - Which materials are volumetric?
  // - Which objects need volume handlers?
  // - What uniforms are needed?
  
  // Phase 2: Code Generation
  const sections = [
    generateStructs(),
    generateUniforms(analysis),
    generateHelpers(),
    generateGeometry(recipe.world.objects),
    generateMaterials(recipe.world.materials),
    generateVolumeHandlers(analysis.volumetricObjects),
    generateTransport(recipe.rendering.transport, analysis),
    generateTonemap(recipe.rendering.tonemap),
    generateMain(recipe)
  ];
  
  // Phase 3: Assembly
  return {
    glsl: sections.join('\n\n'),
    uniforms: analysis.uniforms,
    textures: analysis.textures
  };
}
```

**Key Properties**:
- Compiler decides code organization based on dependencies
- No artificial module boundaries
- Cross-cutting concerns (like volume handlers) placed optimally
- Template-based generation for algorithms (transport, phase functions, etc.)

### 5.4. Layer 3: Generated Shader

A single, cohesive GLSL program organized by the compiler:

```glsl
#version 300 es
precision highp float;

// ====== GENERATED STRUCTS ======
struct Ray { vec3 origin; vec3 direction; };
struct Hit { float t; vec3 normal; int materialId; };

// ====== GENERATED UNIFORMS ======
uniform vec3 u_camera_position;
uniform float u_camera_fov;
uniform vec3 u_material_0_albedo;
// ... (organized for efficiency, not by "module")

// ====== GENERATED HELPERS ======
vec3 sample_hemisphere(vec3 n) { ... }
float saturate(float x) { ... }

// ====== GENERATED GEOMETRY ======
float sdf_sphere_0(vec3 p) { ... }
float sdf_box_1(vec3 p) { ... }
bool scene_intersect(Ray ray, out Hit hit) { ... }

// ====== GENERATED MATERIALS ======
vec3 queryMaterialAlbedo(int id, vec3 p, vec3 n) { ... }
float queryMaterialRoughness(int id, vec3 p, vec3 n) { ... }

// ====== GENERATED VOLUME HANDLERS ======
// (Placed after geometry because they need it)
void handle_volume_0(inout Ray ray, ...) {
  // Mix of transport algorithm + inline geometry
  // Compiler put this here, not constrained by modules
}

// ====== GENERATED TRANSPORT ======
// (Placed after volume handlers because it calls them)
vec3 pathTrace(Ray ray) {
  // ... main algorithm ...
  if (hit.is_volume) {
    handle_volume_0(ray, ...);
  }
  // ...
}

// ====== GENERATED MAIN ======
void main() {
  Ray ray = generateCameraRay();
  vec3 radiance = pathTrace(ray);
  vec3 color = tonemap(radiance);
  fragColor = vec4(color, 1.0);
}
```

**Notice**:
- No module boundary comments
- Code organized by dependencies, not semantic categories
- Volume handlers placed between geometry and transport
- Everything flows naturally

### 5.5. Layer 4: Execution

**Engine** (minimal changes):
```typescript
interface CompiledRecipe {
  id: string;
  glsl: string;
  uniforms: UniformBinding[];
  textures: TextureBinding[];
}

// Engine receives compiled recipes
engine.initialize(recipes: CompiledRecipe[]);
engine.selectRecipe(id: string);
engine.renderFrame();
```

Engine still provides:
- Shader compilation (GLSL → WebGL programs)
- Multi-pass rendering (accumulation, tone mapping, composite)
- Resource management (buffers per recipe, shared textures)
- Uniform updates

Engine no longer needs:
- Module concatenation
- Module ordering
- Module boundary tracking

---

## 6. Benefits of the New Architecture

### 6.1. Freedom in Code Generation

**Before**: "This volume handler mixes transport and scene code... which module should it go in?"

**After**: "Compiler puts it wherever dependencies dictate. It needs geometry functions, so it goes after them. Transport needs it, so transport goes after it."

### 6.2. Natural Cross-Cutting Concerns

Volume handlers, material queries, and other cross-cutting code can be placed optimally:

```typescript
// Compiler freely decides:
const sections = [
  geometry,           // dependencies: none
  materials,          // dependencies: geometry (for position-dependent properties)
  volumeHandlers,     // dependencies: geometry, materials
  transport,          // dependencies: all of the above
];
```

### 6.3. Template-Based Generation

Algorithms are defined once as templates, then instantiated:

```typescript
// Transport algorithm defined once
const VOLUME_SCATTERING_TEMPLATE = {
  generate(params: { sdfCode: string, materialId: number }) {
    return `
      void handle_volume_${params.id}(...) {
        // Physics/algorithm here (written once)
        while (true) {
          // Geometry inlined here (per-object)
          if ((${params.sdfCode}) > 0.0) { ... }
        }
      }
    `;
  }
};

// Instantiated per volumetric object
for (const obj of volumetricObjects) {
  handlers.push(VOLUME_SCATTERING_TEMPLATE.generate({
    sdfCode: obj.sdfExpression,
    materialId: obj.materialId
  }));
}
```

**Result**: Physics algorithms live in one place (maintainable), but generate efficient specialized code (performant).

### 6.4. Preserved Compositional Flexibility

Recipes still allow algorithmic variation:

```typescript
const recipes = [
  {
    id: 'full',
    world: commonWorld,
    rendering: { transport: 'path_tracer', tonemap: 'filmic' }
  },
  {
    id: 'albedo',
    world: commonWorld,
    rendering: { transport: 'albedo_only', tonemap: 'gamma' }
  },
  {
    id: 'normals',
    world: commonWorld,
    rendering: { transport: 'normals_only', tonemap: 'gamma' }
  }
];
```

**Same compositional power, no artificial module boundaries.**

### 6.5. Cleaner Separation of Concerns

**Domain Knowledge** (Templates, Algorithms):
- Volume scattering physics
- BRDF models
- Camera projections
- Tone mapping curves

**Compilation Infrastructure** (Compiler):
- Dependency analysis
- Code generation
- Template instantiation
- GLSL assembly

**Execution Infrastructure** (Engine):
- WebGL compilation
- Rendering pipeline
- Resource management
- Uniform updates

Each layer has a clear responsibility.

---

## 7. Migration Strategy

### 7.1. Phase 1: Add Compiler Layer (Keep Modules)

Create compiler that generates existing module structure:

```typescript
function compileRecipe(recipe: Recipe): ModuleDescriptor[] {
  // Generate modules as before
  // Engine unchanged
}
```

**Benefit**: Test compilation pipeline without breaking Engine.

### 7.2. Phase 2: Generate Cross-Module Code

Start generating code that spans modules (e.g., volume handlers):

```typescript
function buildSceneModule(analysis): ModuleDescriptor {
  return {
    id: { kind: 'scene', ... },
    fragment: {
      functions: [
        ...geometryFunctions,
        ...volumeHandlers  // Mix of scene + transport!
      ].join('\n')
    }
  };
}
```

**Benefit**: Solve immediate problems (volumetrics) while keeping structure.

### 7.3. Phase 3: Simplify Engine Interface

Remove `ModuleDescriptor` concept:

```typescript
interface CompiledRecipe {
  id: string;
  glsl: string;
  uniforms: UniformBinding[];
}

function compileRecipe(recipe: Recipe): CompiledRecipe {
  // Generate complete shader
}

engine.initialize(recipes.map(compileRecipe));
```

**Benefit**: Engine becomes simpler, just compiles GLSL strings.

### 7.4. Phase 4: Full Compiler Freedom

Compiler organizes code purely by dependencies, no module structure:

```typescript
function compileRecipe(recipe: Recipe): CompiledRecipe {
  const analysis = analyzeRecipe(recipe);
  
  // Order sections by dependencies
  const sections = orderByDependencies([
    generateStructs(),
    generateGeometry(recipe.world.objects),
    generateMaterials(recipe.world.materials),
    // ... compiler decides optimal order
  ]);
  
  return { glsl: sections.join('\n\n'), ... };
}
```

**Benefit**: Maximum flexibility, optimal code generation.

---

## 8. Philosophical Shift

### 8.1. From Assembly to Compilation

**Old Mental Model**: "I'm assembling pre-written GLSL modules"
- Modules are artifacts (written GLSL)
- Boundaries are fixed
- Assembly is concatenation

**New Mental Model**: "I'm compiling high-level descriptions to GLSL"
- Descriptions are input (data structures)
- Boundaries are fluid
- Compilation is transformation

### 8.2. The GLSL Is Not The Code

**Key Realization**: The GLSL shader is **generated output**, not **authored source**.

We care about:
- **Input readability**: Scene descriptions, material definitions, algorithm templates
- **Output performance**: Efficient generated GLSL

We don't care about:
- **Output readability**: The generated GLSL can be ugly and monolithic
- **Output architecture**: No need for "clean separation of concerns" in generated code

This is the same philosophy as:
- Shader graphs (node graph → GLSL)
- MaterialX (material description → shader)
- Slang (high-level shading language → HLSL/GLSL)
- Any modern shader compiler

### 8.3. Research Focus vs. Implementation Focus

**What researchers care about**:
- Accurate physics algorithms
- Experimenting with different approaches
- Readable, maintainable algorithm implementations
- Clear mathematical expressions

**What researchers don't care about**:
- Whether generated GLSL has "good architecture"
- Which "module" generated code belongs to
- Artificial organizational boundaries

**The new architecture** lets researchers work at the level they care about (algorithms, templates, descriptions) while the compiler handles the machinery they don't care about (code generation, optimization, assembly).

---

## 9. Success Criteria

The new architecture succeeds if:

1. **Researchers can modify algorithms easily** - Change volume scattering physics by editing one template, not scattered across modules

2. **Compiler handles cross-cutting concerns gracefully** - Volume handlers, material queries, and other mixed-concern code just work

3. **Generated shaders are efficient** - No performance regression from increased abstraction

4. **Engine stays simple** - No increase in Engine complexity, ideally a decrease

5. **Migration is incremental** - Can transition gradually without breaking working code

6. **New features are easier to add** - Adding subsurface scattering, spectral rendering, or other features should be simpler than current system

---

## 10. Conclusion

The nine-module architecture served the system well when modules were hand-written GLSL. As the system evolves toward code generation, module boundaries have become constraints rather than structure.

**The core issue**: Module boundaries conflate compositional choices (WHAT to render) with code organization (WHERE code goes).

**The solution**: Separate these concerns. Recipes specify WHAT. Compiler decides WHERE. Engine executes the result.

**The benefit**: Freedom to generate code optimally without artificial constraints, while preserving the compositional flexibility that made the module system valuable.

This is not a departure from the system's principles—it's an evolution that maintains the research-focused, composable nature of the architecture while removing accidental complexity.

The path forward is clear: descriptions describe, compilers compile, engines execute. Each does one thing well.
