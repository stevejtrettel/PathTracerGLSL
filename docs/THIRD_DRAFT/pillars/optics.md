# Optics Pillar Overview

## Purpose

Optics defines **how we observe and measure light** in the mathematical world. It transforms abstract geometry and materials into scientific measurements through a carefully orchestrated pipeline of ray generation, integration, interaction, accumulation, and visualization. Like a scientific instrument, it provides both raw measurements for analysis and processed views for human observation.

## Core Philosophy

Optics is about **measurement and observation**, not creation. While the Objects pillar defines what exists (geometry, materials, lights), Optics defines how we measure and visualize it. This separation enables us to study the same scene through different observational lenses - from physically accurate path tracing to specialized visualization modes that reveal normally invisible properties.

Critically, Optics functions as a **scientific camera** that outputs multiple representations of the same measurement:
- **Raw data** (radiance) for analysis and archival
- **Viewable images** (RGB) for human observation
- **Statistical information** (variance) for convergence analysis
- Future: Additional channels (depth, normals, albedo) for reconstruction

## The Optics Pipeline

The pillar implements a five-stage pipeline, each with distinct responsibilities:

```
Pixel → [Camera] → Ray → [Transport] → Spectrum → [Film] → Radiance → [Developer] → RGB
                            ↓                                    ↓
                      [Interaction]                        (Raw Output)
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

Interaction modules implement **what happens when light meets matter**. They bridge between material properties (from Objects) and transport algorithms, computing:

- **Surface interactions**: BRDF/BSDF evaluation, importance sampling, Fresnel equations
- **Volume interactions**: Phase functions, extinction via Beer's law, emission integration
- **Special materials**: Perfect specular, glass/dielectrics, subsurface scattering

The interaction module queries material properties (albedo, roughness, scattering coefficients) and implements the physics equations that determine light behavior. Different interaction modules can interpret the same material properties differently - a Lambert interaction sees only albedo, while Disney uses all parameters.

### 4. Film: Temporal Integration and Recording

Films accumulate samples over time, implementing the temporal aspect of Monte Carlo integration. They manage:

- **Accumulation strategies**: Simple averaging, variance tracking, exponential moving average
- **Numerical stability**: Incremental mean computation for thousands of samples
- **Firefly rejection**: Outlier detection and clamping
- **Adaptive sampling**: Tracking per-pixel variance for early termination

Films **record the raw measurement** - the accumulated radiance values that represent the actual physics computation. This raw data is the primary scientific output of the system.

### 5. Developer: Making Physics Visible

Developers transform high dynamic range radiance into displayable images. Rather than "post-processing," think of this as **making physics visible to humans**:

- **Tone mapping**: Compressing infinite range to monitor gamut
- **Exposure control**: Like adjusting camera settings
- **Color science**: Converting from physics units to perceptual space

The developer runs **in parallel** with raw output - it doesn't modify the radiance data, but provides a human-viewable interpretation alongside it.

## Output Interface

Optics provides multiple simultaneous outputs, like a scientific camera with both raw and processed modes:

```typescript
interface OpticsOutput {
  // Primary measurements
  radiance: Texture;      // Raw HDR radiance (W/sr/m²) - for EXR export, analysis
  rgb: Texture;           // Tone-mapped RGB - for display
  
  // Statistical data
  variance: Texture;      // Per-pixel variance - for adaptive sampling
  sampleCount: number;    // Accumulated samples - for convergence tracking
  
  // Future expansion
  // depth?: Texture;     // Geometric depth - for defocus, fog
  // normal?: Texture;    // Surface normals - for denoising
  // albedo?: Texture;    // Material albedo - for relighting
}
```

This multi-output design reflects that Optics is a **measurement instrument**, not just a renderer. Different consumers need different views:
- **Scientists** need raw radiance for analysis
- **Artists** need tone-mapped RGB for viewing
- **Denoisers** need auxiliary buffers for reconstruction
- **Researchers** need variance for convergence studies

## The Transport-Interaction Separation

This architecture makes a critical distinction between **integration algorithms** and **light-matter physics**:

### Why This Separation?

Consider rendering a cloud:

**Material Properties** (from Objects):
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

### 2. Multi-Output Architecture

Optics provides both raw measurements and human-viewable interpretations simultaneously, like a scientific instrument with multiple readouts.

### 3. Compile-Time Configuration

Different strategies compile to different shaders. No runtime branching for:
- Volume integration method
- NEE strategies
- BRDF models

### 4. KIND-Based Prefixing

All functions use explicit module KIND prefixes:
- `camera_generateRay()`
- `transport_trace()`
- `interaction_surface_shade()`
- `film_accumulate()`
- `developer_develop()`

### 5. Per-Recipe Resources

Each recipe maintains separate film buffers, allowing instant switching without losing accumulation progress.

## Interaction with Objects

Optics depends on Objects but doesn't modify it:

- **From Ambient**: Geodesic paths, metric-aware dot products, frame construction
- **From Scene**: Ray intersection, material interface resolution, property queries
- **From Lighting**: Emission sampling and evaluation

The dependency is one-way - Objects knows nothing about how it's being observed.

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

### Data Export
- Save raw radiance to EXR for ground truth
- Export auxiliary buffers for denoising research
- Capture variance maps for adaptive sampling studies

## Implementation Strategy

Optics modules are primarily hand-written because they embody algorithmic and physical choices:

- **Cameras**: Mathematical transformations
- **Transport**: Integration algorithms
- **Interaction**: Physics equations
- **Films**: Accumulation strategies
- **Developers**: Tone mapping operators

Unlike Objects modules which can be generated from scene data, Optics modules represent deliberate algorithmic and physical decisions that benefit from manual implementation.

## Summary

Optics transforms the mathematical Objects into scientific measurements through a five-stage pipeline. By functioning as a measurement instrument that provides both raw data and human-viewable output, it serves both analysis and visualization needs. The separation between transport algorithms and light-matter physics, combined with the multi-output architecture, enables unprecedented flexibility. Researchers can swap algorithms without changing physics, save raw measurements while viewing tone-mapped results, and compose specialized pipelines for any measurement task. The key insight is that Optics is not just a renderer but a **scientific camera** - it measures light and provides multiple representations of those measurements for different purposes.
