# Procedural Parameters System – Problem Description

## 1. Goal and Scope

Throughout the path tracer system, we need a unified way to specify parameter values that can be:

1. **Constants**: Fixed values baked into the shader (e.g., `roughness: 0.5`)
2. **Uniforms**: Values that can change without recompilation (e.g., `radius: { param: 'sphere.radius' }`)
3. **Procedural**: GLSL code that computes values based on context (e.g., position-varying albedo)

This system must work across:
- Material properties (albedo, roughness, metalness, IOR, emission, etc.)
- Geometry parameters (centers, radii, sizes, transforms)
- Light properties (positions, intensities, colors)
- Volume/medium properties (density, absorption)
- SDF region thresholds and parameters

The goal is a **single, consistent parameter type** that works everywhere, while being appropriately expressive for each context.

---

## 2. Use Cases

### 2.1. Material Properties

Materials are the richest case - many properties benefit from procedural variation:

```typescript
material: {
// Constant
roughness: 0.1,

// Uniform (controllable, animatable)
metalness: { param: 'sphere.metalness' },

// Procedural - varying across surface
albedo: `
vec3 compute(vec3 p, vec3 n, vec2 uv) {
    float stripes = step(0.5, fract(p.y * 5.0));
    vec3 color1 = vec3(0.8, 0.2, 0.1);
    vec3 color2 = vec3(0.1, 0.2, 0.8);
    return mix(color1, color2, stripes);
}
`,

// Procedural - rust patterns, weathering, etc.
roughness: `
float compute(vec3 p, vec3 n, vec2 uv) {
    float noise = texture(noiseTexture, uv * 10.0).r;
    return 0.2 + 0.6 * noise;
}
`
}
```

**Context available**:
- `p`: hit position
- `n`: surface normal
- `uv`: texture coordinates

**Common use cases**:
- Albedo: stripes, checkerboards, gradients, procedural textures
- Roughness: wear patterns, scratches, variation
- Emission: patterns on emissive surfaces, animated lights
- All properties: any position/normal/UV-dependent variation

### 2.2. Geometry Parameters

Most geometry parameters are simpler - typically constants or uniforms:

```typescript
geometry: {
type: 'sphere',
center: [0, 0, 0],                    // constant
radius: { param: 'sphere.radius' }    // uniform (for animation/control)
}
```

**Rare procedural cases**:
- Displacement mapping (modifying SDF based on position)
- Time-varying geometry (future feature)

Most geometry parameters should probably be **const/uniform only** to keep complexity down.

### 2.3. Light Properties

```typescript
light: {
type: 'point',
position: { param: 'light.position' },  // uniform (animation)
intensity: 5.0,                          // constant
color: [1.0, 0.9, 0.8],                 // constant
}
```

**Potential procedural cases**:
- Pulsing/flickering lights (intensity as function of time)
- Color-shifting lights (animated color)
- These are likely **future features** (require time parameter)

For now, lights probably only need **const/uniform**.

### 2.4. Volume/Medium Properties

```typescript
medium: {
type: 'fog',
density: 0.01,  // constant

// Or: height-varying fog
density: `
float compute(vec3 p) {
    return 0.01 * exp(-p.y * 0.5);  // denser near ground
}
`,

absorption: [0.1, 0.2, 0.3]  // constant
}
```

**Context available**: `p` (sample position in volume)

**Common use cases**:
- Height-varying density
- Localized fog/smoke
- Absorption varying through medium

### 2.5. SDF Region Parameters

```typescript
geometry: {
type: 'cocktail_glass',
fill_level: { param: 'glass.fill_level' },  // uniform (pour animation)
liquid_height: 0.5  // constant
}
```

These are parameters that affect region classification, typically **const/uniform**.

---

## 3. Core Design Problem: Context Ambiguity

The fundamental challenge is that **procedural parameters need different context in different situations**:

### Material context:
```glsl
vec3 compute_albedo(vec3 p, vec3 n, vec2 uv) { ... }
```

### Volume context:
```glsl
float compute_density(vec3 p) { ... }
```

### Future animation context:
```glsl
vec3 compute_position(float t) { ... }
```

### The tension:

**Option A: Explicit context declaration**
```typescript
albedo: {
glsl: `vec3 compute(vec3 p, vec3 n, vec2 uv) { ... }`,
context: 'material'
}
```
Clear but verbose.

**Option B: Infer context from usage location**
```typescript
material: {
albedo: `vec3 compute(vec3 p, vec3 n, vec2 uv) { ... }`
}
```
The fact that this is inside a `material` object tells the compiler what context is available. But requires documentation of what each context provides.

**Option C: Fixed signatures per context**
```typescript
// Material context always uses this struct:
struct SurfacePoint {
    vec3 p;
    vec3 n;
    vec2 uv;
};

albedo: `vec3 compute(SurfacePoint surf) { ... }`
```
Very clear contract, but rigid.

---

## 4. Expression vs Function Syntax

Single-line expressions are common for simple cases:
```typescript
roughness: `0.5 + 0.1 * sin(p.x)`
```

But multi-line logic needs proper function syntax:
```typescript
albedo: `
vec3 compute(vec3 p, vec3 n, vec2 uv) {
    float pattern = sin(p.x * 10.0) * cos(p.y * 10.0);
    vec3 base = vec3(0.8, 0.2, 0.1);
    vec3 accent = vec3(0.1, 0.2, 0.8);
    return mix(base, accent, pattern);
}
`
```

### Question: Support both or just functions?

**Just functions (more verbose but consistent)**:
```typescript
roughness: `float compute(vec3 p) { return 0.5 + 0.1 * sin(p.x); }`
```

**Both (needs detection logic)**:
```typescript
roughness: `0.5 + 0.1 * sin(p.x)`  // expression, auto-wrapped

albedo: `
vec3 compute(vec3 p, vec3 n, vec2 uv) {
    // function, extracted and renamed
}
`
```

The function approach is **general and unambiguous** but **verbose for simple cases**.

The expression approach is **concise** but has the **same context ambiguity** as functions - what is `p`? What else is available?

---

## 5. Function Name Handling

If we use function syntax, user-provided function names need to be handled:

### User writes:
```typescript
albedo: `
vec3 my_cool_albedo(vec3 p, vec3 n, vec2 uv) {
    return vec3(p.x, p.y, 0.5);
}
`
```

### Compiler needs to:
1. Extract the function
2. Rename it to avoid collisions (e.g., `material_albedo_0`)
3. Generate code that calls it with appropriate context

### Options:

**A. Extract and rename any function name**
- Regex to find function signature
- Replace function name throughout code
- Risk: could match function name in comments/strings

**B. Require specific name (e.g., always `compute`)**
- Simple convention: all procedural functions are named `compute`
- Easy to rename
- Less flexible if user wants helper functions

**C. Anonymous function bodies**
```typescript
albedo: {
glsl: `
float pattern = sin(p.x * 10.0);
return vec3(pattern, pattern, 0.5);
`,
args: ['p', 'n', 'uv']
}
```
- User doesn't provide function name or signature
- Compiler wraps it
- More explicit about what's needed, but more verbose

---

## 6. Type System Design

### Minimal Type System

The simplest unified type that covers all cases:

```typescript
type Parameter<T> =
| T                     // constant value
| { param: string }     // uniform reference
| string                // GLSL function code
```

### Usage:

```typescript
// Constant
roughness: 0.5

// Uniform
roughness: { param: 'material.roughness' }

// Procedural
roughness: `float compute(vec3 p, vec3 n, vec2 uv) { return 0.5; }`

albedo: `
vec3 compute(vec3 p, vec3 n, vec2 uv) {
    // multi-line logic
    return result;
}
`
```

### Context-Specific Types (Alternative)

Different contexts might have different capabilities:

```typescript
// Simple contexts (geometry, lights) - no procedural
type SimpleParameter<T> = T | { param: string }

// Rich contexts (materials, volumes) - full procedural
type ProceduralParameter<T> =
| T
| { param: string }
| string  // GLSL function
```

This limits complexity by only allowing procedural where truly needed.

---

## 7. Key Questions to Resolve

### 7.1. Where do we allow procedural parameters?

**Conservative approach**: Only in materials and volumes
- Geometry: const/uniform only
- Lights: const/uniform only
- Materials: const/uniform/procedural
- Volumes: const/uniform/procedural

**Liberal approach**: Everywhere
- Allow procedural anywhere
- Let users discover what makes sense

### 7.2. How do we document available context?

Users need to know what variables are available. Options:
- **Documentation**: "In material context, you have `p`, `n`, `uv`"
- **Type definitions**: TypeScript types that show structure
- **Runtime errors**: Shader compilation fails with clear message if wrong signature used
- **Examples**: Provide examples for each context

### 7.3. Expression vs function syntax?

- **Functions only**: More verbose, but consistent and general
- **Both**: Less verbose for simple cases, needs detection logic
- **Expressions only**: Less clear for multi-line, harder to parse

### 7.4. How do we handle function names?

- Extract and rename any name (most flexible)
- Require standard name like `compute` (simple convention)
- Anonymous bodies (most explicit, most verbose)

### 7.5. Do we validate signatures?

Should the compiler check that function signatures match expected context?
- **Yes**: Catch errors early, better DX
- **No**: Let GLSL compiler catch it, simpler implementation

---

## 8. Constraints and Requirements

### 8.1. Must Support

1. **Constants**: Direct values for performance
2. **Uniforms**: Runtime-controllable values
3. **Multi-line procedural code**: Complex logic needs proper functions
4. **Type safety**: TypeScript should catch errors where possible
5. **Efficient compilation**: Generated GLSL should be clean and fast

### 8.2. Should Support

1. **Simple expressions**: Concise syntax for simple cases (if not too complex)
2. **Clear error messages**: When procedural code is wrong
3. **Documentation**: Clear explanation of what's available in each context
4. **Extensibility**: Adding new contexts (e.g., time-based animation) should be straightforward

### 8.3. Nice to Have

1. **Type checking of GLSL**: Catch signature mismatches before shader compilation
2. **Helper function libraries**: Common utilities available to procedural code
3. **Debugging support**: Ways to visualize procedural parameter outputs

---

## 9. Implementation Considerations

### 9.1. Compilation Pipeline

```
User scene description
↓
Parameter type detection (const/uniform/procedural)
↓
For procedural:
- Extract/parse function
- Rename to unique name
- Validate signature (optional)
- Store for GLSL generation
↓
Generate GLSL:
- Constants: inline values
- Uniforms: declare uniforms, bind values
- Procedural: emit function definitions, generate calls
↓
Integrate into shader modules
```

### 9.2. Context Information

Each context needs metadata:

```typescript
const MATERIAL_CONTEXT = {
name: 'material',
signature: '(vec3 p, vec3 n, vec2 uv)',
returnTypes: {
albedo: 'vec3',
roughness: 'float',
metalness: 'float',
// ...
}
};

const VOLUME_CONTEXT = {
name: 'volume',
signature: '(vec3 p)',
returnTypes: {
density: 'float',
absorption: 'vec3',
// ...
}
};
```

This metadata drives:
- Signature validation
- Documentation generation
- Error messages

### 9.3. Function Extraction

For function-based approach:

```typescript
function extractProceduralFunction(glsl: string, context: Context) {
// Find function signature
const match = glsl.match(/(\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{/);

if (!match) {
    throw new Error('Invalid function syntax');
}

const [_, returnType, functionName, args] = match;

// Validate signature matches context
const expectedSig = context.signature;
if (args !== expectedSig) {
    throw new Error(`Expected signature ${expectedSig}, got ${args}`);
}

// Generate unique name
const uniqueName = `${context.name}_${propertyName}_${uniqueId()}`;

// Replace function name
const renamed = glsl.replace(
new RegExp(`\\b${functionName}\\b`, 'g'),
uniqueName
);

return {
functionName: uniqueName,
glslCode: renamed,
returnType
};
}
```

---

## 10. Recommended Starting Point

### Phase 1: Minimal Viable System

1. **Unified type**: `T | { param: string } | string`
2. **Function syntax only**: Verbose but consistent
3. **Required function name**: Use `compute` convention
4. **Limited contexts**: Only materials and volumes support procedural
5. **Documentation-based**: Document what each context provides
6. **Runtime validation**: Let GLSL compiler catch signature errors

### Example:

```typescript
material: {
roughness: 0.1,  // constant
metalness: { param: 'mat.metal' },  // uniform

// Procedural - must be named 'compute' with correct signature
albedo: `
vec3 compute(vec3 p, vec3 n, vec2 uv) {
    return vec3(p.x, p.y, 0.5);
}
`
}
```

This is **simple to implement**, **easy to document**, and **sufficient for initial needs**.

### Phase 2: Refinements (Later)

- Add expression syntax for simple cases
- Add more contexts (animation, etc.)
- Add signature validation
- Add helper function libraries

---

## 11. Open Questions

1. Should we support expression syntax or just functions?
2. How strict should function name/signature requirements be?
3. Which contexts should support procedural parameters?
4. Should we validate GLSL signatures at compile time?
5. How do we handle helper functions that procedural code might want to call?
6. Should different parameter properties have different levels of flexibility (e.g., albedo always supports procedural, but IOR doesn't)?

---

This problem intersects with:
- **Material compilation**: How material properties are queried in shaders
- **Object compilation**: How geometry parameters are used in SDF/intersection code
- **Parameter system**: How uniforms are declared, bound, and updated
- **World compilation**: Overall orchestration of code generation

The goal is a **consistent, learnable system** that doesn't require remembering different syntaxes for different contexts, while being appropriately expressive for each use case.
