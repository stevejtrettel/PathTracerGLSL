# Photography Pillar Overview

## Purpose

Photography defines **how we observe and measure light** in the mathematical world. It transforms abstract geometry and materials into images through a carefully orchestrated pipeline of measurement, integration, accumulation, and presentation.

## Core Philosophy

Photography is about **observation**, not creation. While the World pillar defines what exists, Photography defines how we see it. This separation enables us to study the same scene through different observational lenses - from physically accurate path tracing to specialized visualization modes that reveal normally invisible properties.

## The Photography Pipeline

The pillar implements a four-stage pipeline, each with distinct responsibilities:

```
Pixel → [Camera] → Ray → [Estimator] → Spectrum → [Film] → Radiance → [Developer] → RGB
```

### 1. Camera: Defining the Observer

Cameras transform image coordinates into rays, defining **where and how we look**. This isn't just about perspective - different cameras represent different measurement devices:

- **Pinhole**: The idealized observer, infinitely small aperture
- **Thin Lens**: Physical cameras with depth of field
- **Orthographic**: Technical drawings, architectural visualization
- **Spherical**: Environment capture, VR content

The camera's job is purely geometric - it knows nothing about light transport or materials.

### 2. Estimator: Measuring Light

Estimators solve the rendering equation through Monte Carlo integration. They **own the transport strategy** - the algorithm for tracing light through the scene. This is a critical architectural decision.

#### Why Estimators Own Transport

Materials describe **local scattering behavior** - what happens when light hits a surface. But the **integration strategy** - how to efficiently sample paths through volumes, when to use next event estimation, how to handle boundaries - these are algorithmic choices that belong to the estimator.

Consider delta tracking through fog:
- The **material** provides: scattering coefficients, absorption coefficients, phase function
- The **estimator** decides: whether to use delta tracking vs. ray marching, how to sample free paths, when to terminate

This separation allows:
- Different estimators to use different algorithms for the same materials
- Research into new transport algorithms without changing material definitions
- Compile-time selection of strategies for maximum performance

#### Transport Strategies

Estimators dispatch to different transport strategies based on material type:

- **Surface Transport**: Standard BSDF evaluation and sampling
- **Volume Transport**: Multiple algorithms available:
    - Delta tracking for heterogeneous media (unbiased, adaptive)
    - Ray marching for dense media (simple, controllable)
    - Analytical for homogeneous media (exact, fast)
- **Subsurface Transport**: Multiple models:
    - Diffusion approximation (fast, approximate)
    - Photon beam diffusion (accurate for thin features)
    - Brute force path tracing (reference quality)

The choice of strategy is made at **compile time**, not runtime, eliminating branching overhead.

### 3. Film: Temporal Integration

Films accumulate samples over time, implementing the temporal aspect of Monte Carlo integration. They manage:

- **Accumulation strategies**: Simple averaging, variance tracking, exponential moving average
- **Numerical stability**: Incremental mean computation for thousands of samples
- **Firefly rejection**: Outlier detection and clamping
- **Adaptive sampling**: Tracking per-pixel variance for early termination

Films also handle **reset detection** - when parameters change, accumulation must restart to avoid ghosting artifacts.

### 4. Developer: Preparing for Display

Developers transform high dynamic range radiance into displayable images. This involves:

- **Tone mapping**: Compressing infinite range to [0,1]
- **Color grading**: Artistic adjustments
- **Analysis modes**: False color, exposure warnings

Different developers represent different "development processes" - ACES for film-like response, Reinhard for simple efficiency, or specialized visualizations for debugging.

## Type Hierarchy for Spectral Rendering

The pillar uses a careful type hierarchy preparing for future spectral rendering:

- **Spectrum**: Wavelength-dependent radiance (currently RGB, future: sampled wavelengths)
- **Radiance**: What films accumulate (currently RGB, future: XYZ tristimulus)
- **RGB**: Final display output

This separation makes the conceptual flow clear while keeping the path open for spectral transport.

## Key Design Decisions

### 1. Transport Strategy Ownership

The estimator owns HOW to integrate, materials provide WHAT to integrate. This separation is fundamental to the architecture's flexibility.

### 2. Compile-Time Configuration

Different strategies compile to different shaders. No runtime branching for:
- Volume integration method
- Subsurface models
- Next event estimation strategies

### 3. Automatic Dimension Management

Random number dimensions are tracked automatically:
```glsl
vec2 xi = next_2d();  // No manual dimension tracking
```
This prevents correlation bugs from dimension reuse.

### 4. Precomputed Optimization

Expensive computations happen once per frame:
- Camera matrices computed by engine
- Hit frames computed by scene
- IOR ratios precomputed at intersection

### 5. Three-Way Material Interface

Materials provide three separate functions:
- `evaluate(wi, wo, hit)`: BSDF value
- `sample(wi, hit, xi, pdf)`: Importance sampling
- `pdf(wi, wo, hit)`: Probability density

This standard interface enables:
- Clean multiple importance sampling
- Flexibility in sampling strategies
- Simple materials that only implement evaluation

## Interaction with World

Photography depends on World but doesn't modify it:

- **From Geometry**: Geodesic paths, metric-aware dot products, frame construction
- **From Scene**: Ray intersection, material interface resolution
- **From Materials**: BSDF evaluation and sampling (not transport!)
- **From Lights**: Emission sampling and evaluation

The dependency is one-way - World knows nothing about how it's being observed.

## Research Flexibility

The architecture specifically supports research:

### Algorithm Experimentation
- Swap transport strategies without changing materials
- Compare different integration methods side-by-side
- Add new strategies as compile-time options

### Debug Visualization
- Normal display, material ID visualization
- Transport strategy visualization
- Variance and convergence analysis

### Performance Analysis
- Profile which transport paths are taken
- Measure convergence rates
- Track strategy distribution

## Implementation Strategy

Photography modules are primarily hand-written because they embody algorithmic choices:

- **Cameras**: Mathematical transformations
- **Estimators**: Integration algorithms
- **Films**: Accumulation strategies
- **Developers**: Tone mapping operators

Unlike World modules which can be generated from scene data, Photography modules represent deliberate algorithmic decisions that benefit from manual implementation.

## Summary

Photography transforms the mathematical World into images through a pipeline of observation and measurement. By clearly separating responsibilities - cameras define viewing, estimators own transport, films accumulate over time, developers prepare for display - the architecture enables both research flexibility and production efficiency. The key insight is that transport algorithms belong with the observer (estimator), not the observed (materials), allowing independent evolution of both integration strategies and material models.
