# Photography Pillar Overview

## Purpose

Photography defines **how we observe and measure light** in the mathematical world. It transforms abstract geometry and materials into images through a carefully orchestrated pipeline of measurement, interaction, integration, accumulation, and presentation.

## Core Philosophy

Photography is about **observation**, not creation. While the World pillar defines what exists (geometry, materials, lights), Photography defines how we see it. This separation enables us to study the same scene through different observational lenses - from physically accurate path tracing to specialized visualization modes that reveal normally invisible properties.

## The Photography Pipeline

The pillar implements a five-stage pipeline, each with distinct responsibilities:

```
Pixel → [Camera] → Ray → [Transport] → Spectrum → [Film] → Radiance → [Developer] → RGB
                            ↓
                      [Interaction]
                            ↓
                      [Material Properties]
```

### 1. Camera: Defining the Observer

Cameras transform image coordinates into rays, defining **where and how we look**. This isn't just about perspective - different cameras represent different measurement devices:

- **Pinhole**: The idealized observer, infinitely small aperture
- **Thin Lens**: Physical cameras with depth of field
- **Orthographic**: Technical drawings, architectural visualization
- **Spherical**: Environment capture, VR content

The camera's job is purely geometric - it knows nothing about light transport or materials.

### 2. Transport: Integration Strategies

Transport modules implement **how we integrate light** along paths through the scene. They own the Monte Carlo integration strategy - the algorithmic framework for solving the rendering equation. This includes:

- **Path construction**: How to build light paths (forward, backward, bidirectional)
- **Sampling strategies**: When to use next event estimation, when to sample the BSDF
- **Volume integration**: Delta tracking vs. ray marching vs. analytical solutions
- **Termination decisions**: Russian roulette, path length limits
- **Multiple importance sampling**: Combining different sampling techniques optimally

Transport is purely algorithmic - it knows HOW to integrate but delegates the physics of light-matter interaction to the Interaction module.

### 3. Interaction: Light-Matter Physics

Interaction modules implement **what happens when light meets matter**. They bridge between material properties (from World) and transport algorithms, computing:

- **Surface interactions**: BRDF/BSDF evaluation, importance sampling, Fresnel equations
- **Volume interactions**: Phase functions, extinction via Beer's law, emission integration
- **Special materials**: Perfect specular, glass/dielectrics, subsurface scattering

The interaction module queries material properties (albedo, roughness, scattering coefficients) and implements the physics equations that determine light behavior. Different interaction modules can interpret the same material properties differently - a Lambert interaction sees only albedo, while Disney uses all parameters.

### 4. Film: Temporal Integration

Films accumulate samples over time, implementing the temporal aspect of Monte Carlo integration. They manage:

- **Accumulation strategies**: Simple averaging, variance tracking, exponential moving average
- **Numerical stability**: Incremental mean computation for thousands of samples
- **Firefly rejection**: Outlier detection and clamping
- **Adaptive sampling**: Tracking per-pixel variance for early termination

Films also handle **reset detection** - when parameters change, accumulation must restart to avoid ghosting artifacts. Importantly, each recipe maintains its own film buffers, preserving accumulation when switching between recipes.

### 5. Developer: Preparing for Display

Developers transform high dynamic range radiance into displayable images. This involves:

- **Tone mapping**: Compressing infinite range to [0,1]
- **Color grading**: Artistic adjustments
- **Analysis modes**: False color, exposure warnings

Different developers represent different "development processes" - ACES for film-like response, Reinhard for simple efficiency, or specialized visualizations for debugging.

## The Transport-Interaction Separation

This architecture makes a critical distinction between **integration algorithms** and **light-matter physics**:

### Why This Separation?

Consider rendering a cloud:

**Material Properties** (from World):
- Scattering coefficient: 0.5 /m
- Absorption coefficient: 0.01 /m
- Phase asymmetry: 0.8 (forward scattering)

**Interaction** (physics):
- Evaluates Henyey-Greenstein phase function
- Computes Beer's law extinction
- Integrates emission along segments

**Transport** (algorithm):
- Decides WHETHER to use delta tracking vs. ray marching
- Determines WHEN to terminate paths
- Chooses HOW to importance sample

This separation allows:
- Different transport algorithms with the same physics (pathtracer vs. bidirectional)
- Different physics with the same algorithm (Lambert vs. Disney in a pathtracer)
- Research into new algorithms without changing material models
- Optimization of physics models without affecting integration

### Example: Volume Rendering

```glsl
// TRANSPORT decides the algorithm
TransportState delta_track_volume(Ray ray, Hit entry, TransportState state) {
  while (true) {
    // Transport: Sample free path length (algorithmic choice)
    float t = -log(next_1d()) / sigma_max;
    
    // Transport: Check for real vs null collision (algorithmic)
    if (next_1d() < p_real) {
      
      // Interaction: Compute scattering (physics)
      vec3 wo = interaction_volume_scatter(wi, p, mat_id, xi, pdf);
      Spectrum phase = interaction_volume_shade(wi, wo, p, mat_id, distance);
      
      // Transport: Update path state (algorithmic)
      state.throughput *= phase;
    }
  }
}
```

## Type Hierarchy for Spectral Rendering

The pillar uses a careful type hierarchy preparing for future spectral rendering:

- **Spectrum**: Wavelength-dependent radiance (currently RGB, future: sampled wavelengths)
- **Radiance**: What films accumulate (currently RGB, future: XYZ tristimulus)
- **RGB**: Final display output

This separation makes the conceptual flow clear while keeping the path open for spectral transport.

## Module Swappability

The five-module design enables rich composition possibilities:

| Camera | Transport | Interaction | Film | Developer | Use Case |
|--------|-----------|-------------|------|-----------|----------|
| pinhole | simple | debug_normal | simple | reinhard | Normal visualization |
| pinhole | pathtracer | lambert | variance | aces | Diffuse preview |
| thin_lens | pathtracer | disney | variance | aces | Production render |
| pinhole | volumetric | henyey_greenstein | simple | reinhard | Cloud rendering |
| ortho | pathtracer | disney | adaptive | false_color | Technical illustration |

## Key Design Decisions

### 1. Transport-Interaction Separation

Transport owns HOW to integrate, Interaction owns WHAT happens at each interaction. This separation is fundamental to the architecture's flexibility.

### 2. Compile-Time Configuration

Different strategies compile to different shaders. No runtime branching for:
- Volume integration method
- NEE strategies
- BRDF models

### 3. Manual Prefixing

All functions use explicit module prefixes:
- `camera_generateRay()`
- `transport_trace()`
- `interaction_surface_shade()`
- `film_accumulate()`
- `developer_develop()`

### 4. Property Batching

Materials provide all properties in one query for efficiency:
```glsl
MaterialProperties mp = material_get_properties(mat_id, p);
```

### 5. Per-Recipe Resources

Each recipe maintains separate film buffers, allowing instant switching without losing accumulation progress.

## Interaction with World

Photography depends on World but doesn't modify it:

- **From Geometry**: Geodesic paths, metric-aware dot products, frame construction
- **From Scene**: Ray intersection, material interface resolution
- **From Materials**: Property queries (albedo, roughness, coefficients)
- **From Lights**: Emission sampling and evaluation

The dependency is one-way - World knows nothing about how it's being observed.

## Research Flexibility

The five-module architecture specifically supports research:

### Algorithm Experimentation
- Swap transport strategies (pathtracer → bidirectional)
- Compare interaction models (Lambert → Disney)
- Mix and match for A/B testing

### Debug Visualization
- Debug transport with simple interaction
- Debug interaction with simple transport
- Isolate issues to specific modules

### Performance Analysis
- Profile transport separately from physics
- Optimize interaction models independently
- Measure convergence per configuration

## Implementation Strategy

Photography modules are primarily hand-written because they embody algorithmic and physical choices:

- **Cameras**: Mathematical transformations
- **Transport**: Integration algorithms
- **Interaction**: Physics equations
- **Films**: Accumulation strategies
- **Developers**: Tone mapping operators

Unlike World modules which can be generated from scene data, Photography modules represent deliberate algorithmic and physical decisions that benefit from manual implementation.

## Summary

Photography transforms the mathematical World into images through a five-stage pipeline. By separating transport algorithms from light-matter physics, cameras from integration, and accumulation from display, the architecture enables unprecedented flexibility. Researchers can swap algorithms without changing physics, compare physics models with the same algorithm, and compose specialized pipelines for any rendering task. The key insight is the clean separation between integration strategies (Transport), physics equations (Interaction), and the other stages of image formation, allowing independent evolution and optimization of each component.
