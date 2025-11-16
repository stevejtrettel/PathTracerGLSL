# Error Reporting & Validation System Tests

Test utilities for the GLSL shader error reporting and validation systems.

## Files

- **`test-error-reporting.js`** - Interactive test that introduces a deliberate typo
- **`revert-test.js`** - Reverts test changes
- **`test-validation.js`** - Test recipe and uniform validation (run via browser)
- **`test-errors-direct.mjs`** - Direct Node.js test (requires compilation)
- **`DEMO-ERROR-OUTPUT.md`** - Documentation showing example output

## Quick Test

### 1. Introduce a deliberate error:
```bash
node tests/error-reporting/test-error-reporting.js
```

### 2. Start the dev server:
```bash
npm run dev
```

### 3. Check browser console
You'll see formatted error messages with:
- Module context
- Source code highlighting
- Function suggestions
- Typo detection

### 4. Revert the test:
```bash
node tests/error-reporting/revert-test.js
```

## What Gets Tested

### Shader Error Reporting:
- ✅ Raw GLSL error parsing
- ✅ Line mapping to source modules
- ✅ Function name extraction
- ✅ Typo detection (Levenshtein distance)
- ✅ Available function auto-discovery
- ✅ Error deduplication
- ✅ ANSI-colored console output
- ✅ Source context display

### Pre-Compilation Validation:
- ✅ Recipe validation (module kinds match slots)
- ✅ Uniform validation (bindings match GLSL declarations)
- ✅ Unbound uniform warnings

## Testing Validation

The validation system runs automatically when recipes are loaded. To test validation errors:

### Recipe Validation Test

Edit `examples/main.ts` and intentionally swap modules:

```typescript
// Before:
optics: {
    camera: pinholeCamera,
    transport: pathTracerDirectLight,
    // ...
}

// After (wrong module in wrong slot):
optics: {
    camera: pinholeCamera,
    transport: pinholeCamera,  // ❌ Error: camera module in transport slot
    // ...
}
```

Then run `npm run dev` and check the console for:
```
❌ Recipe validation failed for 'pathtracer':
  • Recipe 'pathtracer': transport slot requires 'transport' module, got 'camera' (pinhole-camera)
```

### Uniform Validation Test

Edit any module file and introduce a typo in `uniformBindings`:

```typescript
// In src/world/lighting/point-light.ts
uniformBindings: [
    {
        uniform: 'u_lite_position',  // ❌ Typo! Should be u_light_position
        // ...
    }
]
```

Then run `npm run dev` and check the console for:
```
❌ Uniform validation failed for 'pathtracer':
  • Module 'lighting/point-light': uniformBinding references 'u_lite_position' but uniform not declared in GLSL
```

## Example Output

See `DEMO-ERROR-OUTPUT.md` for complete examples of the error translation system in action.
