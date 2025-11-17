# Light Sampler Implementation Approaches

## Approach 1: TypeScript Files with GLSL Template Strings

### Structure
```
src/world/lighting/samplers/
├── quad-light.ts          (TypeScript exports function that returns GLSL string)
├── sphere-light.ts
└── point-light.ts
```

### Example: `quad-light.ts`
```typescript
export function generateQuadLightSampler(light: QuadLight, options: SamplerOptions): string {
  const { index, isSingleLight } = options;

  // TypeScript logic to determine access patterns
  const centerAccess = isSingleLight ? 'u_light_center' : `u_lights[${index}].param0.xyz`;
  const signature = isSingleLight ? 'Point p' : 'Point p, vec2 xi';

  // Return GLSL as template string with interpolated values
  return `
LightSample sample_light_${index}(${signature}) {
  LightSample ls;

  vec3 center = ${centerAccess};
  vec3 edge1 = ${edge1Access};

  // ... rest of GLSL code with comments

  return ls;
}
  `.trim();
}
```

### How It Works
- TypeScript function receives light data + context (index, isSingleLight)
- TypeScript computes variable access patterns, function signatures
- Returns complete GLSL code as string with all substitutions done
- Full TypeScript type checking, autocomplete, refactoring support

---

## Approach 2: Pure GLSL Files with Template Syntax

### Structure
```
src/world/lighting/samplers/
├── quad-light.glsl        (Pure GLSL with {{placeholders}})
├── sphere-light.glsl
├── point-light.glsl
└── template-processor.ts  (Loads and processes templates)
```

### Example: `quad-light.glsl`
```glsl
/**
 * Quad/Area Light Sampler
 *
 * Samples a rectangular area light with uniform distribution.
 * The quad is defined by a center point and two edge vectors.
 *
 * Sampling: Uniform over the quad surface
 * PDF: Solid angle measure (distance² / (area × cos_theta))
 */

// Quad light: {{LIGHT_ID}}
LightSample sample_light_{{INDEX}}({{SIGNATURE}}) {
  LightSample ls;

  {{RANDOM_GEN}}
  vec3 center = {{CENTER_ACCESS}};
  vec3 edge1 = {{EDGE1_ACCESS}};
  vec3 edge2 = {{EDGE2_ACCESS}};

  // Sample point on quad
  // xi is [0,1]², shift to [-0.5, 0.5]² to center the sampling
  vec3 light_point = center + (xi.x - 0.5) * edge1 + (xi.y - 0.5) * edge2;

  // Quad normal (perpendicular to the plane)
  vec3 quad_normal = normalize(cross(edge1, edge2));

  // Direction from shading point to light sample
  vec3 to_light = light_point - p;
  float distance = length(to_light);
  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.position = light_point;

  // Check if light sample faces the shading point
  // (backface culling - light doesn't emit from back side)
  float cos_light = dot(-ls.wi, quad_normal);
  if (cos_light <= 0.0) {
    ls.radiance = vec3(0.0);
    ls.pdf = 1.0;
    return ls;
  }

  // Quad area = |edge1 × edge2|
  float area = length(cross(edge1, edge2));

  // PDF conversion from area measure to solid angle measure
  // pdf_solid_angle = pdf_area × (distance² / cos_theta)
  ls.pdf = (distance * distance) / (area * cos_light);

  ls.radiance = {{RADIANCE_ACCESS}};

  return ls;
}
```

### Supporting TypeScript: `template-processor.ts`
```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface TemplateContext {
  LIGHT_ID: string;
  INDEX: number;
  SIGNATURE: string;
  RANDOM_GEN: string;
  CENTER_ACCESS: string;
  EDGE1_ACCESS: string;
  EDGE2_ACCESS: string;
  RADIANCE_ACCESS: string;
}

export function loadAndProcessTemplate(
  templatePath: string,
  context: TemplateContext
): string {
  // Load GLSL file
  const template = fs.readFileSync(templatePath, 'utf-8');

  // Replace all {{PLACEHOLDERS}} with context values
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(placeholder, String(value));
  }

  return result;
}

export function generateQuadLightSampler(
  light: QuadLight,
  options: SamplerOptions
): string {
  const { index, isSingleLight } = options;

  // Compute all the context values
  const context: TemplateContext = {
    LIGHT_ID: light.id,
    INDEX: index,
    SIGNATURE: isSingleLight ? 'Point p' : 'Point p, vec2 xi',
    RANDOM_GEN: isSingleLight ? 'vec2 xi = random2();' : '',
    CENTER_ACCESS: isSingleLight ? 'u_light_center' : `u_lights[${index}].param0.xyz`,
    EDGE1_ACCESS: isSingleLight ? 'u_light_edge1' : `u_lights[${index}].param1.xyz`,
    EDGE2_ACCESS: isSingleLight ? 'u_light_edge2' : `u_lights[${index}].param2.xyz`,
    RADIANCE_ACCESS: isSingleLight
      ? '(u_light_color * u_light_intensity)'
      : `u_lights[${index}].radiance`
  };

  // Load and process template
  const templatePath = path.join(__dirname, 'quad-light.glsl');
  return loadAndProcessTemplate(templatePath, context);
}
```

### Alternative: Conditional Blocks in GLSL

Instead of {{PLACEHOLDERS}}, use conditional compilation:

```glsl
// quad-light.glsl with conditional blocks

// @if SINGLE_LIGHT
LightSample sample_light_{{INDEX}}(Point p) {
  vec2 xi = random2();
  vec3 center = u_light_center;
  vec3 edge1 = u_light_edge1;
  vec3 edge2 = u_light_edge2;
  vec3 radiance = u_light_color * u_light_intensity;
// @else
LightSample sample_light_{{INDEX}}(Point p, vec2 xi) {
  vec3 center = u_lights[{{INDEX}}].param0.xyz;
  vec3 edge1 = u_lights[{{INDEX}}].param1.xyz;
  vec3 edge2 = u_lights[{{INDEX}}].param2.xyz;
  vec3 radiance = u_lights[{{INDEX}}].radiance;
// @endif

  LightSample ls;

  // Sample point on quad
  vec3 light_point = center + (xi.x - 0.5) * edge1 + (xi.y - 0.5) * edge2;

  // ... rest of sampling code ...

  ls.radiance = radiance;
  return ls;
}
```

Processor strips `// @if` comments and evaluates conditions.

---

## Comparison

### GLSL Syntax Highlighting

**Approach 1 (TypeScript):**
```typescript
return `
  vec3 light_point = center + (xi.x - 0.5) * edge1;  // ⚠️ No GLSL highlighting
  float distance = length(to_light);
`;
```
- GLSL is just a string inside TypeScript
- Most editors treat it as plain string (no syntax highlighting)
- Some editors support tagged template literals: `glsl\`...\`` but not common

**Approach 2 (Pure GLSL):**
```glsl
  vec3 light_point = center + (xi.x - 0.5) * edge1;  // ✅ Full GLSL highlighting
  float distance = length(to_light);
```
- Full GLSL syntax highlighting in any editor
- Syntax errors visible immediately
- Auto-formatting, bracket matching, etc.

### Code Navigation

**Approach 1:**
- ✅ "Go to definition" works in TypeScript
- ✅ "Find all references" finds TypeScript usage
- ⚠️ GLSL code inside strings not searchable by GLSL tools
- ✅ Grep/search works fine for GLSL code

**Approach 2:**
- ✅ "Go to definition" works for GLSL functions
- ✅ GLSL LSP tools can parse files
- ⚠️ Template syntax may confuse GLSL tools
- ✅ Can use GLSL-specific search tools

### Type Safety

**Approach 1:**
```typescript
const centerAccess = isSingleLight ? 'u_light_center' : `u_lights[${index}].param0.xyz`;
// ✅ TypeScript checks: index is number, isSingleLight is boolean
// ✅ Autocomplete for light properties
// ⚠️ GLSL code in string not type-checked
```

**Approach 2:**
```typescript
const context: TemplateContext = {
  INDEX: index,              // ✅ Type-checked as number
  CENTER_ACCESS: centerAccess // ✅ Type-checked as string
};
// ⚠️ Template placeholders not validated
// ⚠️ Could typo {{CENTRE_ACCESS}} and not catch it
```

### Readability

**Approach 1:**
```typescript
return `
LightSample sample_light_${index}(${signature}) {
  vec3 center = ${centerAccess};  // ⚠️ Interpolation breaks flow
  vec3 edge1 = ${edge1Access};    // ⚠️ Hard to see "pure" GLSL logic

  vec3 light_point = center + (xi.x - 0.5) * edge1;  // ✅ Clean GLSL
}
`;
```
- Substitutions interrupt GLSL code reading
- Need to mentally parse `${}` expressions

**Approach 2:**
```glsl
LightSample sample_light_{{INDEX}}({{SIGNATURE}}) {
  vec3 center = {{CENTER_ACCESS}};  // ⚠️ Placeholders visible but clearer
  vec3 edge1 = {{EDGE1_ACCESS}};

  vec3 light_point = center + (xi.x - 0.5) * edge1;  // ✅ Clean GLSL
}
```
- Placeholders more clearly marked
- Easier to see which parts are templated
- Rest of code reads as pure GLSL

### Debugging Generated GLSL

**Approach 1:**
```typescript
const glsl = generateQuadLightSampler(light, options);
console.log(glsl);  // ✅ Easy - just call function and log result
```

**Approach 2:**
```typescript
const glsl = loadAndProcessTemplate(templatePath, context);
console.log(glsl);  // ✅ Easy - same as Approach 1
// Can also inspect template file directly
```

Both equally easy.

### Testing

**Approach 1:**
```typescript
test('generates correct quad sampler', () => {
  const glsl = generateQuadLightSampler(mockLight, { index: 0, isSingleLight: true });
  expect(glsl).toContain('u_light_center');
  expect(glsl).toContain('sample_light_0');
});
```

**Approach 2:**
```typescript
test('generates correct quad sampler', () => {
  const glsl = generateQuadLightSampler(mockLight, { index: 0, isSingleLight: true });
  expect(glsl).toContain('u_light_center');
  expect(glsl).toContain('sample_light_0');
  // Could also test template file separately
});
```

Similar testing approach.

### Adding New Lights

**Approach 1:**
1. Copy `quad-light.ts` → `disk-light.ts`
2. Modify GLSL string
3. Export functions
4. Import in compiler

**Approach 2:**
1. Copy `quad-light.glsl` → `disk-light.glsl`
2. Modify GLSL (with syntax highlighting!)
3. Create `disk-light-processor.ts` with template context
4. Import in compiler

Similar effort, Approach 2 has better GLSL editing experience.

### File Size / Build Output

**Approach 1:**
- GLSL strings bundled in JavaScript
- All code in one compiled JS file
- No separate file loading at runtime

**Approach 2:**
- Need to load .glsl files at build time
- Could inline them during build, or
- Load as modules (need bundler plugin)
- Slightly more build complexity

### When GLSL Gets Large (100+ lines)

**Approach 1:**
```typescript
return `
// Line 1
// Line 2
// ... 100+ lines of GLSL in a TypeScript string ...
// Line 100
`;
```
- Can get unwieldy
- Syntax highlighting would help a lot

**Approach 2:**
```glsl
// Line 1
// Line 2
// ... 100+ lines of pure GLSL ...
// Line 100
```
- Reads like normal GLSL file
- Full editor support
- Easier to work with

---

## Hybrid Approach 3: Tagged Template Literals

Some editors support syntax highlighting in tagged templates:

```typescript
import { glsl } from './glsl-tag';

export function generateQuadLightSampler(light: QuadLight, options: SamplerOptions): string {
  const { index, isSingleLight } = options;
  const centerAccess = isSingleLight ? 'u_light_center' : `u_lights[${index}].param0.xyz`;

  return glsl`
    LightSample sample_light_${index}(Point p) {
      vec3 center = ${centerAccess};
      vec3 light_point = center + (xi.x - 0.5) * edge1;
      return ls;
    }
  `;
}
```

Where `glsl` is just:
```typescript
export function glsl(strings: TemplateStringsArray, ...values: any[]): string {
  return strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
}
```

VSCode plugin "lit-html" or similar can highlight `glsl\`...\`` blocks.

---

## Recommendation Summary

| Criterion | Approach 1 (TS) | Approach 2 (GLSL) | Winner |
|-----------|----------------|-------------------|--------|
| **Syntax Highlighting** | ⚠️ Limited | ✅ Full | GLSL |
| **Type Safety** | ✅ Good | ⚠️ Limited | TS |
| **Readability** | ⚠️ Interpolation | ✅ Clear templates | GLSL |
| **Navigation** | ✅ TS tools | ⚠️ Mixed | TS |
| **Setup Complexity** | ✅ Simple | ⚠️ Template loader | TS |
| **Large GLSL Files** | ⚠️ Unwieldy | ✅ Natural | GLSL |
| **Build System** | ✅ Simple | ⚠️ Needs loader | TS |
| **Learning Curve** | ✅ Standard | ⚠️ Custom templates | TS |

### For Your Use Case

**Choose Approach 1 (TypeScript)** if:
- ✅ Want simple setup (no template system)
- ✅ TypeScript type safety is priority
- ✅ GLSL samplers stay < 50 lines
- ✅ Team prefers standard tools

**Choose Approach 2 (Pure GLSL)** if:
- ✅ GLSL samplers will get complex (100+ lines)
- ✅ Want best GLSL editing experience
- ✅ Team has GLSL experts who want syntax highlighting
- ✅ Willing to maintain template processor
- ✅ Want to reference GLSL from docs/papers easily

**My Recommendation: Start with Approach 1**
- Simpler to implement and maintain
- No special build setup
- Can always refactor to Approach 2 later if GLSL gets complex
- Current samplers (30-60 lines) work fine in TypeScript strings
