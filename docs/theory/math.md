# Mathematical Foundations

Connecting the mathematics of light transport to GLSL implementation.

## The Rendering Equation

### Mathematical Formulation

The rendering equation (Kajiya 1986) describes the equilibrium distribution of radiance:

```
L_o(x, ωo) = L_e(x, ωo) + ∫_Ω f_r(x, ωi, ωo) L_i(x, ωi) |cos θ_i| dωi
```

Where:
- L_o(x, ωo): Outgoing radiance at point x in direction ωo
- L_e(x, ωo): Emitted radiance
- f_r(x, ωi, ωo): BRDF
- L_i(x, ωi): Incident radiance
- Ω: Hemisphere above surface
- cos θ_i: Geometric factor

### Path Integral Formulation

Expanding recursively, we get the path integral:

```
L = ∫ f(x̄)dμ(x̄)
```

Where x̄ = (x₀, x₁, ..., xₙ) is a path and f(x̄) is the path contribution.

### Monte Carlo Solution

We approximate the integral with random samples:

```
L ≈ (1/N) Σ f(x̄ᵢ)/p(x̄ᵢ)
```

### GLSL Implementation

```glsl
// The actual path tracing loop implements this equation
Spectrum estimate(Ray ray) {
    Spectrum L = Spectrum(0);        // L_o accumulator
    Spectrum throughput = Spectrum(1); // Π(f_r * cos / pdf)
    
    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        if (!sc_intersect(ray, hit)) {
            // L_e from environment
            L += throughput * environment_radiance(ray.direction);
            break;
        }
        
        // L_e from surface
        L += throughput * m_emission(hit);
        
        // Sample f_r for next direction
        float pdf;
        Direction wo = m_sample(-ray.direction, hit, next_2d(), pdf);
        
        // Evaluate f_r
        Spectrum f = m_evaluate(-ray.direction, wo, hit);
        
        // Update throughput: f_r * cos(θ) / pdf
        float cos_theta = abs(g_dot(wo, hit.n, hit.p));
        throughput *= f * cos_theta / pdf;
        
        ray = make_ray(hit.p, wo);
    }
    
    return L;
}
```

## Importance Sampling Theory

### Change of Variables

When sampling from distribution p(x) instead of uniform:

```
∫ f(x)dx = ∫ f(x)/p(x) · p(x)dx = E_p[f(x)/p(x)]
```

### Optimal Importance Sampling

The variance-minimizing PDF is proportional to |f|:

```
p*(x) = |f(x)| / ∫|f(x)|dx
```

### BRDF Importance Sampling

For a Lambertian BRDF (f = ρ/π), the optimal sampling is cosine-weighted:

```glsl
// Mathematical derivation:
// f_r = ρ/π
// Optimal: p(ω) ∝ f_r * cos(θ) = (ρ/π) * cos(θ)
// Normalized: p(ω) = cos(θ)/π

Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
    // Sample hemisphere with PDF = cos(θ)/π
    float cos_theta = sqrt(xi.y);        // CDF inversion
    float sin_theta = sqrt(1.0 - xi.y);
    float phi = 2.0 * PI * xi.x;
    
    // Local space direction
    vec3 local = vec3(
        sin_theta * cos(phi),
        sin_theta * sin(phi), 
        cos_theta
    );
    
    // Transform to world space
    Direction wo = hit.frame.t * local.x + 
                   hit.frame.b * local.y + 
                   hit.frame.n * local.z;
    
    pdf = cos_theta / PI;  // Probability density
    return wo;
}
```

### GGX Importance Sampling

For microfacet BRDFs, we sample the distribution of normals:

```glsl
// GGX distribution: D(h) = α²/[π((h·n)²(α²-1)+1)²]
// We sample h from D(h), then reflect to get wo

Direction sample_ggx(Direction wi, Frame frame, float alpha, vec2 xi) {
    // Sample GGX distribution in tangent space
    float a2 = alpha * alpha;
    float cos_theta = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));
    float sin_theta = sqrt(1.0 - cos_theta * cos_theta);
    float phi = 2.0 * PI * xi.x;
    
    // Microfacet normal in local space
    vec3 h_local = vec3(
        sin_theta * cos(phi),
        sin_theta * sin(phi),
        cos_theta
    );
    
    // Transform to world space
    Direction h = frame.t * h_local.x + 
                  frame.b * h_local.y + 
                  frame.n * h_local.z;
    
    // Reflect incident direction
    return reflect(-wi, h);
}
```

## Multiple Importance Sampling (MIS)

### Balance Heuristic

When combining two sampling strategies:

```
w₁(x) = p₁(x) / [p₁(x) + p₂(x)]
w₂(x) = p₂(x) / [p₁(x) + p₂(x)]
```

### Power Heuristic

More robust weighting (with β = 2):

```
w₁(x) = p₁²(x) / [p₁²(x) + p₂²(x)]
```

### MIS Implementation

```glsl
Spectrum compute_direct_mis(Hit hit, Direction wo) {
    Spectrum L = Spectrum(0);
    
    // Strategy 1: Light sampling
    LightSample ls = l_sample_light(hit.p, next_2d());
    if (!occluded(hit.p, ls.wi, ls.distance)) {
        Spectrum f = m_evaluate(wo, ls.wi, hit);
        float bsdf_pdf = m_pdf(wo, ls.wi, hit);
        
        // Power heuristic weight
        float weight = (ls.pdf * ls.pdf) / 
                      (ls.pdf * ls.pdf + bsdf_pdf * bsdf_pdf);
        
        float cos_theta = max(0, g_dot(ls.wi, hit.n, hit.p));
        L += f * ls.radiance * cos_theta * weight / ls.pdf;
    }
    
    // Strategy 2: BSDF sampling
    float pdf;
    Direction wi = m_sample(wo, hit, next_2d(), pdf);
    Spectrum Le = l_eval_light(hit.p, wi);
    
    if (luminance(Le) > 0 && !occluded(hit.p, wi, INFINITY)) {
        Spectrum f = m_evaluate(wo, wi, hit);
        float light_pdf = l_pdf_light(hit.p, wi);
        
        // Power heuristic weight
        float weight = (pdf * pdf) / 
                      (pdf * pdf + light_pdf * light_pdf);
        
        float cos_theta = abs(g_dot(wi, hit.n, hit.p));
        L += f * Le * cos_theta * weight / pdf;
    }
    
    return L;
}
```

## Measure Theory & Solid Angle

### Area to Solid Angle Conversion

When sampling area lights, we need to convert between measures:

```
dω = dA · |cos θ'| / r²
```

Where:
- dω: Solid angle measure
- dA: Area measure
- θ': Angle at light surface
- r: Distance to light

### Implementation

```glsl
LightSample sample_area_light(Point p, vec2 xi) {
    // Sample point on light surface (area measure)
    Point light_p = sample_light_surface(xi);
    float area = light_area();
    float pdf_area = 1.0 / area;
    
    // Convert to solid angle measure
    vec3 to_light = light_p - p;
    float dist2 = dot(to_light, to_light);
    float dist = sqrt(dist2);
    Direction wi = to_light / dist;
    
    float cos_light = max(0, -dot(wi, light_normal));
    
    // Jacobian of transformation
    float pdf_solid_angle = pdf_area * dist2 / cos_light;
    
    LightSample ls;
    ls.wi = wi;
    ls.distance = dist;
    ls.pdf = pdf_solid_angle;
    ls.radiance = light_emission();
    
    return ls;
}
```

## Fresnel Equations & Refraction

### Fresnel Reflectance (Dielectric)

For unpolarized light:

```
F = ½(F_s + F_p)
F_s = [(n₁cos θᵢ - n₂cos θₜ)/(n₁cos θᵢ + n₂cos θₜ)]²
F_p = [(n₂cos θᵢ - n₁cos θₜ)/(n₂cos θᵢ + n₁cos θₜ)]²
```

### Schlick's Approximation

```glsl
float fresnel_schlick(float cos_theta, float ior_ratio) {
    float r0 = (1.0 - ior_ratio) / (1.0 + ior_ratio);
    r0 = r0 * r0;
    return r0 + (1.0 - r0) * pow(1.0 - cos_theta, 5.0);
}
```

### Refraction & Radiance Change

When light refracts, radiance changes by η²:

```glsl
Direction sample_dielectric(Direction wi, Hit hit, vec2 xi, out float pdf) {
    float eta = hit.ior_ratio;  // n_from / n_to
    float cos_theta_i = -g_dot(wi, hit.n, hit.p);
    
    float F = fresnel_dielectric(cos_theta_i, eta);
    
    if (xi.x < F) {
        // Reflection
        pdf = F;
        return reflect(wi, hit.n);
    } else {
        // Refraction
        Direction wo = refract(wi, hit.n, eta);
        
        // CRITICAL: Account for radiance change
        // This comes from the change of solid angle measure
        pdf = (1.0 - F) * eta * eta;
        
        return wo;
    }
}
```

### Mathematical Derivation

The η² factor comes from the solid angle transformation:

```
L_t/L_i = (n_t/n_i)² · (1 - F)

This ensures energy conservation:
Power_in = Power_out
L_i · dω_i · cos θ_i · A = L_t · dω_t · cos θ_t · A
```

## Three-Way BSDF Interface

### Why Three Functions?

The separation into evaluate/sample/pdf is mathematically necessary:

1. **Evaluate**: f_r(ωi, ωo) - The actual BRDF value
2. **Sample**: Generate ωo from importance distribution
3. **PDF**: p(ωo|ωi) - Probability density of the sample

### Mathematical Relationship

For correct Monte Carlo integration:

```
E[f/p] = ∫ f(x)dx  (unbiased)
Var[f/p] → 0 as p → |f|  (variance reduction)
```

### Practical Example: Blended BRDF

```glsl
// A BRDF that blends diffuse and specular
Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
    float ks = 0.5;  // Specular weight
    
    Spectrum diffuse = albedo / PI;
    Spectrum specular = evaluate_ggx(wi, wo, hit, roughness);
    
    return (1.0 - ks) * diffuse + ks * specular;
}

Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
    float ks = 0.5;
    
    Direction wo;
    float pdf_diffuse, pdf_specular;
    
    if (xi.x < ks) {
        // Sample specular
        xi.x /= ks;  // Reuse random number
        wo = sample_ggx(wi, hit, xi, pdf_specular);
        pdf_diffuse = pdf_cosine_hemisphere(wo);
    } else {
        // Sample diffuse
        xi.x = (xi.x - ks) / (1.0 - ks);
        wo = sample_cosine_hemisphere(hit, xi, pdf_diffuse);
        pdf_specular = pdf_ggx(wi, wo, hit);
    }
    
    // Combined PDF
    pdf = (1.0 - ks) * pdf_diffuse + ks * pdf_specular;
    return wo;
}

float pdf(Direction wi, Direction wo, Hit hit) {
    float ks = 0.5;
    
    float pdf_diffuse = pdf_cosine_hemisphere(wo);
    float pdf_specular = pdf_ggx(wi, wo, hit);
    
    return (1.0 - ks) * pdf_diffuse + ks * pdf_specular;
}
```

## Russian Roulette

### Unbiased Termination

To maintain unbiased results while terminating paths:

```
L = { L/p with probability p
    { 0   with probability 1-p

E[L] = p · (L/p) + (1-p) · 0 = L  (unbiased)
```

### Implementation

```glsl
// After a few bounces, randomly terminate
if (bounce > 3) {
    float p_survive = min(1.0, luminance(throughput));
    
    if (next_1d() > p_survive) {
        break;  // Terminate path
    }
    
    // Compensate for termination probability
    throughput /= p_survive;
}
```

## Geometric Optics in Curved Spaces

### Geodesics in Non-Euclidean Geometry

Light follows geodesics (shortest paths) in curved space:

```
d²xᵘ/ds² + Γᵘᵥᵨ(dxᵛ/ds)(dxᵨ/ds) = 0
```

Where Γᵘᵥᵨ are Christoffel symbols.

### Hyperbolic Space Implementation

```glsl
// Poincaré disk model
Point geodesic(Point origin, Direction dir, float t) {
    // In hyperbolic space, geodesics are circular arcs
    float r2 = dot(origin, origin);
    float k = 1.0 / (1.0 - r2);  // Curvature factor
    
    // Parallel transport affects direction
    Direction transported = dir * k;
    
    // Geodesic follows curved path
    return tanh_addition(origin, transported * t);
}

float dot(Direction v1, Direction v2, Point p) {
    // Metric tensor in Poincaré disk
    float r2 = dot(p, p);
    float g = 4.0 / ((1.0 - r2) * (1.0 - r2));
    
    return dot(v1, v2) * g;  // Scaled by metric
}
```

## Volume Rendering & Null Scattering

### Radiative Transfer Equation

In participating media:

```
(ω·∇)L(x,ω) = -σₜL(x,ω) + σₛ∫p(ω,ω')L(x,ω')dω' + σₐLₑ(x,ω)
```

Where:
- σₜ = σₐ + σₛ: Extinction coefficient
- σₐ: Absorption coefficient
- σₛ: Scattering coefficient
- p(ω,ω'): Phase function

### Delta Tracking (Woodcock Tracking)

Introduces fictitious "null" particles to homogenize the medium:

```glsl
TransportResult delta_track(Ray ray, Hit entry, int mat_id) {
    float sigma_max = m_sigma_max(mat_id);  // Majorant
    
    vec3 p = entry.p;
    Direction dir = ray.direction;
    
    while (true) {
        // Sample free path with majorant
        float t = -log(max(next_1d(), EPSILON)) / sigma_max;
        p = p + dir * t;
        
        // Check if still in volume
        if (!inside_volume(p)) break;
        
        // Real vs null collision
        vec3 sigma_t = m_sigma_s(p, mat_id) + m_sigma_a(p, mat_id);
        float p_real = length(sigma_t) / sigma_max;
        
        if (next_1d() < p_real) {
            // Real interaction - scatter or absorb
            float p_scatter = length(m_sigma_s(p, mat_id)) / 
                            length(sigma_t);
            
            if (next_1d() < p_scatter) {
                // Scatter - sample phase function
                dir = m_sample_phase(dir, p, mat_id, next_2d(), pdf);
            } else {
                // Absorbed - terminate
                return TERMINATED;
            }
        }
        // Null collision - continue
    }
}
```

### Mathematical Correctness

Delta tracking is unbiased because:
1. Null collisions don't change the path distribution
2. Sampling with the majorant ensures all real collisions are found
3. The acceptance probability corrects for oversampling

## Energy Conservation Principles

### BRDF Constraints

Physical BRDFs must satisfy:

1. **Energy conservation**: ∫f_r(ωi,ωo)cosθ dωo ≤ 1
2. **Reciprocity**: f_r(ωi,ωo) = f_r(ωo,ωi)
3. **Non-negativity**: f_r(ωi,ωo) ≥ 0

### Validation Test

```glsl
// Test energy conservation numerically
float test_energy_conservation(Direction wi, Hit hit) {
    float total = 0.0;
    const int N = 10000;
    
    for (int i = 0; i < N; i++) {
        vec2 xi = hammersley(i, N);
        
        float pdf;
        Direction wo = m_sample(wi, hit, xi, pdf);
        Spectrum f = m_evaluate(wi, wo, hit);
        float cos_theta = abs(g_dot(wo, hit.n, hit.p));
        
        // Monte Carlo integration
        total += luminance(f) * cos_theta / pdf;
    }
    
    return total / float(N);  // Should be ≤ 1.0
}
```

## Sampling Theory & Stratification

### Quasi-Monte Carlo

Using low-discrepancy sequences instead of random numbers:

```glsl
// Hammersley sequence for better stratification
vec2 hammersley(uint i, uint N) {
    uint bits = i;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    
    float radical_inverse = float(bits) * 2.3283064365386963e-10;
    return vec2(float(i) / float(N), radical_inverse);
}
```

### Stratified Sampling Benefits

Stratification reduces variance by √N instead of N:
- Random sampling: Var ∝ 1/N
- Stratified sampling: Var ∝ 1/N²

## Numerical Considerations

### Floating Point Precision

```glsl
// Avoiding catastrophic cancellation
// BAD: Subtract similar numbers
float variance = sum_squares/n - (sum/n)*(sum/n);

// GOOD: Welford's algorithm
float delta = sample - mean;
mean = mean + delta/n;
m2 = m2 + delta*(sample - mean);
variance = m2/(n-1);
```

### Ray-Surface Epsilon

```glsl
// Offset rays to avoid self-intersection
const float EPSILON = 0.0001;  // ~2^-13

// Position offset along normal
vec3 offset_position(vec3 p, vec3 n, bool outgoing) {
    return p + n * (outgoing ? EPSILON : -EPSILON);
}
```

### Robust Ray-Sphere Intersection

```glsl
// Numerically stable quadratic solution
bool intersect_sphere(Ray ray, float radius, out float t) {
    vec3 oc = ray.origin;
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - radius * radius;
    
    float discriminant = b * b - c;
    if (discriminant < 0) return false;
    
    // Stable solution using Citardauq formula
    float q = -(b + sign(b) * sqrt(discriminant));
    float t0 = c / q;
    float t1 = q;
    
    t = (t0 > ray.tmin && t0 < ray.tmax) ? t0 : t1;
    return t > ray.tmin && t < ray.tmax;
}
```

## Connection to Implementation

The mathematical foundations directly map to code:

| Mathematical Concept | Implementation |
|---------------------|----------------|
| Rendering equation | Path tracing loop |
| Importance sampling | BSDF sample() function |
| MIS balance heuristic | Direct lighting |
| Measure conversion | Area light sampling |
| Fresnel equations | Dielectric BSDF |
| Delta tracking | Volume transport |
| Energy conservation | BRDF validation |
| Stratification | Hammersley sequences |

This direct correspondence ensures:
1. **Correctness**: Implementation matches theory
2. **Efficiency**: Optimal sampling strategies
3. **Debuggability**: Can verify mathematical properties
4. **Extensibility**: New techniques plug into framework
