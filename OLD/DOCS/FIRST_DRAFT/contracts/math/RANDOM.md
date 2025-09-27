# Unified Random Source Abstraction

## Overview

Different random sources (Sobol, Halton, blue noise, white noise) have fundamentally different properties and requirements. This document describes how to create a unified interface that allows swapping implementations without changing shader code.

## How Different Sources Handle Dimensions

### Sobol Sequences
- **Uses dimensions**: Each dimension is a different quasi-random sequence
- **Dimension limit**: Typically 1000+ dimensions available
- **Correlation**: Dimensions are designed to be uncorrelated
- **Best for**: High-dimensional integration, path tracing

```glsl
// Sobol uses dimension parameter meaningfully
float sobol_1d(ivec2 pixel, int frame, int dimension) {
    return sobol_sequence(pixel.x, pixel.y, frame, dimension);
}
```

### Blue Noise
- **Ignores dimensions**: Uses spatial position and frame only
- **Dimension limit**: Effectively unlimited (dimensions are ignored)
- **Correlation**: Relies on spatial/temporal decorrelation
- **Best for**: First bounce, error distribution, dithering

```glsl
// Blue noise typically ignores dimension, uses texture lookup
float blue_noise_1d(ivec2 pixel, int frame, int dimension) {
    // dimension ignored - uses position and frame offset
    ivec2 coord = (pixel + frame * 37) % textureSize(u_blue_noise);
    return texelFetch(u_blue_noise, coord, 0).r;
}
```

### White Noise (Hash-based)
- **Hashes all inputs**: Combines pixel, frame, and dimension into hash
- **Dimension limit**: Unlimited
- **Correlation**: No designed decorrelation
- **Best for**: Quick tests, non-critical sampling

```glsl
// White noise hashes everything together
float white_noise_1d(ivec2 pixel, int frame, int dimension) {
    return hash(pixel.x * 73 + pixel.y * 157 + frame * 241 + dimension * 337);
}
```

### Halton Sequences
- **Uses dimensions**: Each dimension uses different prime base
- **Dimension limit**: Limited by available primes (~100 good ones)
- **Correlation**: Higher dimensions can correlate
- **Best for**: Low-dimensional sampling

## The Unified Abstraction

### Core Interface

```glsl
// User-facing interface (what you write)
float random();                          // Single value [0,1]
float random(float min, float max);      // Range [min,max]
vec2 randomVec2();                       // 2D point [0,1]²
vec3 randomVec3();                       // 3D point [0,1]³
vec2 randomDisk();                       // Unit disk
vec3 randomSphere();                     // Unit sphere surface
vec3 randomHemisphere(vec3 n);          // Hemisphere around n
vec3 randomCosineHemisphere(vec3 n);    // Cosine-weighted
```

### Implementation Strategy

```typescript
// CONFIG: sampling_config.ts
interface SamplingConfig {
    // Primary sampler for path dimensions
    primary: "sobol" | "halton" | "blue_noise" | "white_noise";
    
    // Optional overrides for specific uses
    overrides?: {
        antialiasing?: "blue_noise";  // Often looks better
        first_bounce?: "blue_noise";  // Reduces visible patterns
        light_sampling?: "sobol";     // Better convergence
    };
    
    // Hints for optimization
    hints?: {
        max_path_length?: number;      // Preallocate dimensions
        dimensions_per_bounce?: number; // For budgeting
    };
}
```

### Shader Compilation

The compiler generates appropriate backend based on config:

```glsl
// GENERATED BACKEND for config.primary = "sobol"
ivec2 _pixel_id;
int _frame;
int _dim;

float _random_backend() {
    return sobol_1d(_pixel_id, _frame, _dim++);
}

vec2 _random2_backend() {
    int d = _dim; _dim += 2;
    return vec2(
        sobol_1d(_pixel_id, _frame, d),
        sobol_1d(_pixel_id, _frame, d + 1)
    );
}

// GENERATED BACKEND for config.primary = "blue_noise"
ivec2 _pixel_id;
int _frame;
int _dim;  // Still tracked for consistency, but ignored by implementation

float _random_backend() {
    // Blue noise ignores dimension, uses temporal offset
    vec2 coord = vec2(_pixel_id + _frame * 37) / vec2(textureSize(u_blue_noise, 0));
    float value = texture(u_blue_noise, coord).r;
    
    // Add per-dimension hash for decorrelation when needed
    value = fract(value + hash1(_dim) * 0.618033988);
    _dim++;
    return value;
}
```

## Handling Source-Specific Properties

### 1. Dimension-Aware Sources (Sobol, Halton)

```glsl
// These sources use dimension parameter meaningfully
struct DimensionAwareBackend {
    float sample_1d(ivec2 pixel, int frame, int dim);
    vec2 sample_2d(ivec2 pixel, int frame, int dim);
};
```

### 2. Dimension-Agnostic Sources (Blue Noise)

```glsl
// These sources need creative decorrelation
struct DimensionAgnosticBackend {
    float sample_1d(ivec2 pixel, int frame, int dim_hint) {
        // Use dim_hint for additional decorrelation
        float base = blue_noise_texture(pixel, frame);
        return fract(base + golden_ratio * dim_hint);
    }
};
```

### 3. Hybrid Approaches

```glsl
// Combine multiple sources based on use case
struct HybridBackend {
    float sample_1d(ivec2 pixel, int frame, int dim) {
        if (dim < 4) {
            // Blue noise for first few dimensions (visible error)
            return blue_noise(pixel, frame, dim);
        } else {
            // Sobol for deep paths (convergence matters more)
            return sobol_1d(pixel, frame, dim);
        }
    }
};
```

## Semantic Hints System

Let the shader provide hints about usage intent:

```glsl
// Semantic annotations for better source selection
float randomWithHint(int hint);

const int HINT_ANTIALIASING = 0;  // Prefers blue noise
const int HINT_BRDF = 1;          // Prefers Sobol
const int HINT_LIGHT_SELECT = 2;  // Prefers stratified
const int HINT_RUSSIAN_ROULETTE = 3; // Any source fine

// Usage
vec2 xi_aa = randomVec2WithHint(HINT_ANTIALIASING);
vec3 xi_brdf = randomVec3WithHint(HINT_BRDF);
```

Compiler can then route to different sources:

```typescript
function compileRandomWithHint(hint: string): string {
    switch(hint) {
        case "HINT_ANTIALIASING":
            return config.overrides?.antialiasing || config.primary;
        case "HINT_BRDF":
            return config.overrides?.brdf || config.primary;
        default:
            return config.primary;
    }
}
```

## Implementation Examples

### Example 1: Pure Sobol

```typescript
const config: SamplingConfig = {
    primary: "sobol"
};
```

Generated code:
```glsl
float random() {
    return sobol_1d(_pixel_id, _frame, _dim++);
}
```

### Example 2: Blue Noise + Sobol Hybrid

```typescript
const config: SamplingConfig = {
    primary: "sobol",
    overrides: {
        antialiasing: "blue_noise",
        first_bounce: "blue_noise"
    }
};
```

Generated code:
```glsl
float random() {
    // First 4 dimensions use blue noise
    if (_dim < 4) {
        float value = texture(u_blue_noise, 
            vec2(_pixel_id + vec2(_dim * 17, _frame * 37)) / 256.0).r;
        _dim++;
        return value;
    }
    return sobol_1d(_pixel_id, _frame, _dim++);
}
```

### Example 3: Experimental Multi-Source

```glsl
// Tag sampling points with semantic meaning
enum SampleUse {
    LENS,
    PIXEL_FILTER,
    BRDF,
    LIGHT_SELECTION,
    RUSSIAN_ROULETTE
};

float randomFor(SampleUse use) {
    switch(use) {
        case LENS:
        case PIXEL_FILTER:
            // Screen-space effects: blue noise
            return blue_noise(_pixel_id, _frame, _dim++);
            
        case BRDF:
        case LIGHT_SELECTION:
            // Integration: Sobol
            return sobol_1d(_pixel_id, _frame, _dim++);
            
        case RUSSIAN_ROULETTE:
            // Doesn't matter much: fastest
            return wang_hash(_pixel_id, _frame, _dim++);
    }
}
```

## Testing Different Sources

Create a test framework to compare sources:

```glsl
// test_sampler_comparison.glsl
uniform int u_test_sampler; // 0=sobol, 1=blue_noise, 2=white

vec3 test_convergence() {
    float sum = 0.0;
    for (int i = 0; i < 100; i++) {
        float xi = random();  // Uses selected backend
        sum += xi;
    }
    // Should converge to 50.0 for all samplers
    float error = abs(sum - 50.0);
    return vec3(error / 50.0);
}

vec3 test_correlation() {
    vec2 a = randomVec2();
    vec2 b = randomVec2();
    // Correlation should be minimal
    return vec3(abs(dot(a, b)));
}
```

## Best Practices

### 1. Default to Sobol
- Best general-purpose convergence
- Well-understood properties
- Handles high dimensions well

### 2. Consider Blue Noise for First Bounce
- Better error distribution visually
- Reduces pattern artifacts
- Can combine with Sobol for deeper bounces

### 3. Profile and Measure
```typescript
// Build system can generate multiple versions
function buildSamplingVariants(shader: string): Map<string, string> {
    const variants = new Map();
    
    for (const sampler of ["sobol", "blue_noise", "halton"]) {
        variants.set(sampler, compileWithSampler(shader, sampler));
    }
    
    return variants;
}
```

### 4. Runtime Switching for Development
```glsl
uniform int u_sampler_type;

float random() {
    switch(u_sampler_type) {
        case 0: return random_sobol();
        case 1: return random_blue_noise();
        case 2: return random_white();
    }
}
```

## Future Enhancements

### 1. Adaptive Source Selection
```glsl
// Switch sources based on sample count
float random_adaptive() {
    if (u_frame_index < 4) {
        return random_blue_noise();  // Fast initial preview
    } else {
        return random_sobol();        // Quality convergence
    }
}
```

### 2. Correlation Detection
```typescript
// ShaderCompiler warns about potential correlation
function analyzeDimensionUsage(ast: ShaderAST): Warning[] {
    // Detect if same dimensions used in correlated ways
    // Suggest different sampling strategies
}
```

### 3. Importance-Based Selection
```glsl
// Use better samplers where it matters most
float random_importance(float importance) {
    if (importance > 0.8) {
        return random_sobol();      // High quality
    } else {
        return random_blue_noise();  // Fast and good enough
    }
}
```

## Summary

The key insight is that **dimensions mean different things to different samplers**, but we can create a unified abstraction that:

1. Provides a consistent interface (`random()`, `randomDisk()`, etc.)
2. Handles dimension tracking appropriately for each source
3. Allows easy switching between implementations
4. Enables hybrid approaches based on use case
5. Maintains mathematical clarity in shader code

This system lets you experiment with different randomness sources without changing your path tracing logic, while still getting optimal behavior from each source type.
