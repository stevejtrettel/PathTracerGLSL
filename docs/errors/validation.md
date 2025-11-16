# Pre-Compilation Validation

Validation that runs before shader compilation to catch structural errors early.

## Overview

Pre-compilation validation catches errors in:
1. **Recipe structure** - Module kinds match slots
2. **Uniform bindings** - Bindings reference declared uniforms
3. **Module compatibility** - Required functions exist

This prevents cryptic GLSL compilation errors by validating the configuration first.

---

## Recipe Validation

### validateRecipe()

Ensures each recipe slot contains the correct module kind.

**Function**:
```typescript
function validateRecipe(recipe: Recipe): ValidationResult
```

**Checks**:
- `world.ambient` must be `kind: 'ambient'`
- `world.environment` must be `kind: 'environment'`
- `world.scene` must be `kind: 'scene'`
- `world.lighting` must be `kind: 'lighting'`
- `optics.camera` must be `kind: 'camera'`
- `optics.interaction` must be `kind: 'interaction'`
- `optics.transport` must be `kind: 'transport'`
- `optics.accumulator` must be `kind: 'accumulator'`
- `optics.developer` must be `kind: 'developer'`

**Example Error**:
```typescript
const recipe = {
    // ...
    optics: {
        camera: pinholeCamera,      // ✓ kind: 'camera'
        transport: pinholeCamera,   // ✗ kind: 'camera' (wrong!)
        // ...
    }
};

const result = validateRecipe(recipe);
// result.valid = false
// result.errors = [
//     "Recipe 'pathtracer': transport slot requires 'transport' module, got 'camera' (pinhole-camera)"
// ]
```

**Output**:
```
❌ Recipe validation failed for 'pathtracer':
  • transport slot requires 'transport' module, got 'camera' (pinhole-camera)
```

---

## Uniform Validation

### validateModuleUniforms()

Ensures uniform bindings reference uniforms that actually exist in GLSL.

**Function**:
```typescript
function validateModuleUniforms(module: ModuleDescriptor): ValidationResult
```

**Checks**:
1. Parse `uniform` declarations from GLSL
2. Check each `uniformBinding.uniform` exists in declarations
3. Warn about declared uniforms with no bindings (may be engine uniforms)

**Example Error**:
```typescript
const module = {
    // ...
    fragment: {
        uniforms: `
            uniform vec3 u_light_position;
            uniform vec3 u_light_radiance;
        `,
        // ...
    },
    uniformBindings: [{
        uniform: 'u_lite_position',  // ✗ Typo!
        parameters: ['light.position'],
        type: 'vec3',
        compute: (params) => params['light.position']
    }]
};

const result = validateModuleUniforms(module);
// result.valid = false
// result.errors = [
//     "Module 'lighting/point-light': uniformBinding references 'u_lite_position' but uniform not declared in GLSL"
// ]
```

**Output**:
```
❌ Uniform validation failed for 'pathtracer':
  • Module 'lighting/point-light': uniformBinding references 'u_lite_position' but uniform not declared in GLSL
```

**Example Warning**:
```typescript
const module = {
    // ...
    fragment: {
        uniforms: `
            uniform vec3 u_light_position;
            uniform vec3 u_light_radiance;
            uniform float u_custom_param;  // No binding
        `,
        // ...
    },
    uniformBindings: [
        { uniform: 'u_light_position', /* ... */ },
        { uniform: 'u_light_radiance', /* ... */ }
        // Missing binding for u_custom_param
    ]
};

const result = validateModuleUniforms(module);
// result.valid = true (just a warning)
// result.warnings = [
//     "Module 'lighting/point-light': uniform 'u_custom_param' declared but has no uniformBinding"
// ]
```

**Output**:
```
⚠️  Uniform warnings for 'pathtracer':
  • Module 'lighting/point-light': uniform 'u_custom_param' declared but has no uniformBinding
```

### Engine Uniforms

Some uniforms are provided by the engine and don't need module bindings:

```glsl
// Engine-provided (no binding needed)
uniform vec2 u_resolution;
uniform int u_frameIndex;
uniform float u_time;
uniform int u_sampleCount;
uniform vec2 u_pixelOffset;
uniform vec2 u_imageSize;

// Textures (bound by engine/registry)
uniform sampler2D u_accumulator_radiance_previous;
uniform sampler2D u_radiance_texture;
uniform sampler2D u_env_map;
uniform sampler2D u_env_cdf_conditional;
uniform sampler2D u_env_cdf_marginal;
uniform float u_env_totalWeight;
uniform vec2 u_env_size;
```

These are recognized and don't trigger warnings.

---

## Recipe Module Validation

### validateRecipeModules()

Validates uniforms for all modules in a recipe.

**Function**:
```typescript
function validateRecipeModules(recipe: Recipe): ValidationResult
```

**Process**:
1. Extract all 9 modules from recipe
2. Run `validateModuleUniforms()` on each
3. Collect all errors and warnings

**Example**:
```typescript
const result = validateRecipeModules(recipe);

if (!result.valid) {
    console.error('Uniform errors:');
    result.errors.forEach(err => console.error(`  • ${err}`));
}

if (result.warnings && result.warnings.length > 0) {
    console.warn('Warnings:');
    result.warnings.forEach(warn => console.warn(`  • ${warn}`));
}
```

---

## GLSL Uniform Parsing

The validator parses GLSL uniform declarations:

**Supported Patterns**:
```glsl
uniform float u_value;
uniform vec3 u_color;
uniform mat4 u_matrix;
uniform sampler2D u_texture;

// Multiple on one line
uniform float u_a; uniform float u_b;

// With precision qualifiers
lowp uniform float u_value;
highp uniform vec3 u_color;
```

**Regex Pattern**:
```typescript
/uniform\s+\w+\s+(\w+)\s*;/g
```

This extracts the uniform name (group 1).

---

## ValidationResult Type

```typescript
interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings?: string[];
}
```

**Fields**:
- `valid` - `true` if no errors (warnings OK)
- `errors` - Array of error messages
- `warnings` - Optional array of warning messages

**Usage**:
```typescript
const result = validateRecipe(recipe);

if (!result.valid) {
    // Has errors - cannot proceed
    throw new Error('Validation failed');
}

if (result.warnings && result.warnings.length > 0) {
    // Has warnings - can proceed but should review
    console.warn('Validation warnings:', result.warnings);
}
```

---

## Integration with Engine

The engine runs validation during initialization:

```typescript
// Engine.initialize()
for (const recipe of recipes) {
    // 1. Validate recipe structure
    const recipeResult = validateRecipe(recipe);
    if (!recipeResult.valid) {
        console.error(`\n❌ Recipe validation failed for '${recipe.id}':\n`);
        recipeResult.errors.forEach(err => console.error(`  • ${err}`));
        throw new Error(`Recipe validation failed for '${recipe.id}'. See console for details.`);
    }

    // 2. Validate uniform bindings
    const uniformResult = validateRecipeModules(recipe);
    if (!uniformResult.valid) {
        console.error(`\n❌ Uniform validation failed for '${recipe.id}':\n`);
        uniformResult.errors.forEach(err => console.error(`  • ${err}`));
        throw new Error(`Uniform validation failed for '${recipe.id}'. See console for details.`);
    }

    // 3. Show warnings
    if (uniformResult.warnings && uniformResult.warnings.length > 0) {
        console.warn(`\n⚠️  Uniform warnings for '${recipe.id}':`);
        uniformResult.warnings.forEach(warn => console.warn(`  • ${warn}`));
    }
}

// Now compile shaders (validation passed)
```

---

## Common Validation Errors

### 1. Wrong Module Kind

**Problem**:
```typescript
optics: {
    transport: pinholeCamera  // camera module in transport slot
}
```

**Error**:
```
❌ Recipe 'pathtracer': transport slot requires 'transport' module, got 'camera' (pinhole-camera)
```

**Fix**:
```typescript
optics: {
    transport: pathTracerDirectLight  // Correct transport module
}
```

### 2. Uniform Binding Typo

**Problem**:
```typescript
uniformBindings: [{
    uniform: 'u_lite_position',  // Typo
    // ...
}]
```

**Error**:
```
❌ Module 'lighting/point-light': uniformBinding references 'u_lite_position' but uniform not declared in GLSL
```

**Fix**:
```typescript
uniformBindings: [{
    uniform: 'u_light_position',  // Correct spelling
    // ...
}]
```

### 3. Missing Uniform Declaration

**Problem**:
```typescript
// No uniform declaration in GLSL
uniformBindings: [{
    uniform: 'u_custom_param',
    // ...
}]
```

**Error**:
```
❌ Module 'my-module': uniformBinding references 'u_custom_param' but uniform not declared in GLSL
```

**Fix**:
```glsl
// Add declaration
uniform float u_custom_param;
```

### 4. Unbound Uniform

**Problem**:
```glsl
uniform float u_custom_param;  // Declared but no binding
```

**Warning**:
```
⚠️  Module 'my-module': uniform 'u_custom_param' declared but has no uniformBinding
```

**Fix** (if intentional):
- Ignore warning (uniform gets default value)

**Fix** (if unintentional):
```typescript
uniformBindings: [{
    uniform: 'u_custom_param',
    parameters: ['custom.param'],
    type: 'float',
    compute: (params) => params['custom.param']
}]
```

---

## Testing Validation

### Manual Testing

**Recipe Validation**:
```typescript
// In examples/main.ts, intentionally break a recipe
const recipe = {
    // ...
    optics: {
        camera: pinholeCamera,
        transport: pinholeCamera,  // ✗ Wrong!
        // ...
    }
};

// Run npm run dev
// Check console for error
```

**Uniform Validation**:
```typescript
// In any module file, introduce a typo
uniformBindings: [{
    uniform: 'u_lite_position',  // ✗ Typo!
    // ...
}]

// Run npm run dev
// Check console for error
```

### Automated Testing

See `tests/validation.test.ts` for comprehensive test suite.

```bash
npm test tests/validation.test.ts
```

Tests cover:
- Valid recipes pass
- Wrong module kinds fail
- Multiple errors detected
- Uniform typos caught
- Unbound uniforms warn
- Engine uniforms ignored

---

## Best Practices

1. **Run validation before compilation** - Catches errors early
2. **Fix all errors** - Don't ignore validation failures
3. **Review warnings** - May indicate issues
4. **Use consistent naming** - `u_<module>_<property>`
5. **Document custom uniforms** - Explain unbound uniforms
6. **Test with intentional errors** - Verify validation works

---

## Next Steps

- [Shader Errors](shader-errors.md) - GLSL compilation errors
- [Resource Errors](resource-errors.md) - HDR/texture validation
- [Writing Modules](../guides/writing-modules.md) - Creating valid modules
- [Error System Overview](README.md) - Complete error system
