# GLSL Light Sampler: Implementation Approaches

## Three Example Approaches

I've created example files showing different ways to structure the GLSL code:

### 1. TypeScript with Template Strings (CURRENT PROPOSAL)
**File**: `src/world/lighting/samplers/quad-light.ts`

```typescript
export function generateQuadLightSampler(light, options): string {
  const centerAccess = isSingleLight ? 'u_light_center' : `u_lights[${index}].param0.xyz`;

  return `
    LightSample sample_light_${index}(${signature}) {
      vec3 center = ${centerAccess};
      // ... GLSL code with ${interpolations} ...
    }
  `;
}
```

**Characteristics:**
- GLSL embedded in TypeScript template strings
- TypeScript logic computes access patterns
- No separate template system needed
- All logic in one place per light type

### 2. Pure GLSL with Placeholder Templates
**Files**: `EXAMPLE_quad-light.glsl` + TypeScript processor

```glsl
LightSample sample_light_{{INDEX}}({{SIGNATURE}}) {
  vec3 center = {{CENTER_ACCESS}};
  // ... pure GLSL with {{PLACEHOLDERS}} ...
}
```

**Characteristics:**
- GLSL in .glsl files with {{placeholder}} syntax
- TypeScript loads and processes templates
- Need template processor system
- Full GLSL syntax highlighting

### 3. Pure GLSL with Conditional Blocks
**File**: `EXAMPLE_quad-light-conditional.glsl`

```glsl
// @if SINGLE_LIGHT
LightSample sample_light_{{INDEX}}(Point p) {
  vec3 center = u_light_center;
// @else
LightSample sample_light_{{INDEX}}(Point p, vec2 xi) {
  vec3 center = u_lights[{{INDEX}}].param0.xyz;
// @endif
  // ... common GLSL code ...
}
```

**Characteristics:**
- GLSL with @if/@else/@endif directives
- Processor evaluates conditionals
- Keeps related variants together
- More readable than placeholders everywhere

### 4. Separate GLSL Files per Mode (BONUS)
**File**: `EXAMPLE_quad-light-single.glsl`

```glsl
// Pure GLSL, no templates at all!
LightSample lighting_sample(Point p) {
  vec2 xi = random2();
  vec3 center = u_light_center;
  vec3 edge1 = u_light_edge1;
  // ... pure GLSL, no substitutions ...
}
```

**Characteristics:**
- Completely pure GLSL - no templating!
- One file for single-light mode, another for multi-light
- Just load the right file based on context
- Simplest to understand

---

## Detailed Comparison

### Syntax Highlighting

| Approach | GLSL Highlighting | Notes |
|----------|------------------|-------|
| 1. TypeScript strings | ⚠️ None (unless tagged template) | GLSL appears as plain string |
| 2. GLSL placeholders | ✅ Full (placeholders may confuse) | Editor sees .glsl file |
| 3. GLSL conditionals | ✅ Full (directives look like comments) | Editor sees .glsl file |
| 4. Separate GLSL files | ✅ Perfect | 100% pure GLSL |

### Complexity

| Approach | Setup | Maintenance | Learning Curve |
|----------|-------|-------------|----------------|
| 1. TypeScript | ✅ Simple | ✅ Standard TS | ✅ Easy |
| 2. Placeholders | ⚠️ Need processor | ⚠️ Custom syntax | ⚠️ Medium |
| 3. Conditionals | ⚠️ Need processor | ⚠️ Custom directives | ⚠️ Medium |
| 4. Separate files | ✅ Simple | ✅ Just load files | ✅ Easy |

### Readability

**Approach 1 (TypeScript):**
```typescript
return `
  vec3 center = ${centerAccess};     // ⚠️ Interpolation interrupts
  vec3 edge1 = ${edge1Access};       // ⚠️ Hard to read as "pure GLSL"
`;
```

**Approach 2 (Placeholders):**
```glsl
  vec3 center = {{CENTER_ACCESS}};   // ⚠️ Placeholders visible but clearer
  vec3 edge1 = {{EDGE1_ACCESS}};     // ✅ Reads more like GLSL
```

**Approach 3 (Conditionals):**
```glsl
// @if SINGLE_LIGHT
  vec3 center = u_light_center;      // ✅ Clean GLSL in each branch
// @else
  vec3 center = u_lights[0].param0.xyz;
// @endif
  vec3 light_point = center + ...;   // ✅ Common code is pure GLSL
```

**Approach 4 (Separate files):**
```glsl
  vec3 center = u_light_center;      // ✅ Completely pure GLSL!
  vec3 edge1 = u_light_edge1;        // ✅ No interpolation, no templates
```

### When GLSL Gets Large

Imagine a 200-line textured area light with IES profile lookup:

**Approach 1:**
```typescript
return `
  // Line 1
  // ... 200 lines of GLSL in a TypeScript string ...
  // Line 200
`;  // ⚠️ Unwieldy, hard to edit without highlighting
```

**Approaches 2-4:**
```glsl
  // Line 1
  // ... 200 lines of actual GLSL in .glsl file ...
  // Line 200
  // ✅ Full syntax highlighting, formatting, tools
```

---

## Real Example: Textured Area Light (Future)

Let's imagine we want to add a **textured quad light** that:
- Samples a texture for emission
- Uses importance sampling based on texture brightness
- Has IES light profile falloff
- Maybe 150+ lines of GLSL

### How this looks in each approach:

**Approach 1 (TypeScript string):**
```typescript
// textured-quad-light.ts
export function generateTexturedQuadSampler(...): string {
  return `
    // 150 lines of complex GLSL as a string
    // No syntax highlighting while editing
    // ${interpolations} everywhere
    // Hard to see the algorithm
  `;
}
```

**Approach 2/3 (GLSL template):**
```glsl
// textured-quad-light.glsl
// 150 lines of GLSL with syntax highlighting
// {{placeholders}} or @if blocks for dynamic parts
// Easy to reference papers/docs
// Easy to copy/paste test code
```

**Approach 4 (Pure GLSL files):**
```glsl
// textured-quad-light-single.glsl
// 150 lines of pure GLSL
// Perfect syntax highlighting
// Copy/paste from papers works
// Can test in ShaderToy or other tools
```

---

## Recommendation by Use Case

### Your Current Situation (3 simple lights, 30-60 lines each)

**Best Choice: Approach 1 (TypeScript strings)**

Why:
- ✅ Simplest setup (what I already showed you)
- ✅ No custom build system
- ✅ Type-safe parameter passing
- ✅ 30-60 line GLSL is manageable in strings
- ✅ Can refactor later if needed

The lack of syntax highlighting is annoying but not critical for small samplers.

### If Lights Get Complex (100+ lines each)

**Consider: Approach 3 (Conditional GLSL) or Approach 4 (Separate files)**

Why:
- ✅ Full syntax highlighting becomes important
- ✅ Easier to maintain complex algorithms
- ✅ Better for referencing academic papers
- ✅ Can copy/paste GLSL to test tools

Approach 4 (separate files) is cleanest if you don't mind some duplication.

### If You Value Research Clarity

**Consider: Approach 4 (Separate pure GLSL files)**

Why:
- ✅ Can put GLSL in papers/docs directly
- ✅ Other researchers can read the code
- ✅ No "build system magic" to understand
- ✅ Pure GLSL = standard language

Trade-off: Some code duplication between single/multi variants.

---

## My Recommendation

### Phase 1 (NOW): Use TypeScript Approach

Stick with what I already created:
- `src/world/lighting/samplers/quad-light.ts` (TypeScript with GLSL strings)
- Simple, works, no build system changes
- Refactor later if needed

### Phase 2 (FUTURE): If lights get complex

When you add something like:
- Textured area lights (need texture sampling logic)
- IES profile lights (complex falloff calculations)
- Portal lights (ray-geometry intersection)
- Mesh lights (BVH traversal in GLSL)

Then consider switching to **Approach 4 (separate pure GLSL files)** because:
- 100+ line GLSL really benefits from syntax highlighting
- Complex algorithms need clear code
- Research/papers easier to reference

You could even have a hybrid:
- Simple lights (point, sphere, quad): Stay in TypeScript strings
- Complex lights: Use separate .glsl files

---

## Example Migration Path

### Current (TypeScript):
```
samplers/
├── point-light.ts          (simple - keep in TS)
├── sphere-light.ts         (simple - keep in TS)
├── quad-light.ts           (simple - keep in TS)
```

### Future (Hybrid):
```
samplers/
├── point-light.ts          (simple - TypeScript)
├── sphere-light.ts         (simple - TypeScript)
├── quad-light.ts           (simple - TypeScript)
├── textured-quad/
│   ├── single.glsl         (complex - pure GLSL)
│   ├── multi.glsl          (complex - pure GLSL)
│   └── loader.ts           (TypeScript to load GLSL)
├── ies-light/
│   ├── single.glsl
│   ├── multi.glsl
│   └── loader.ts
```

This gives you:
- ✅ Simplicity for simple lights
- ✅ GLSL files for complex lights
- ✅ No over-engineering

---

## Bottom Line

**For your current needs: Use the TypeScript approach I already created.**

It's the simplest, requires no custom build tooling, and works great for lights under ~80 lines of GLSL.

**Later**: When you need a 150-line textured mesh light sampler with importance sampling, switch that specific light to a pure `.glsl` file approach.

**Don't over-engineer now** for a problem you might not have. Start simple! 🎯
