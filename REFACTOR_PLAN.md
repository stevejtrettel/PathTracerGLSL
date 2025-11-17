# Lights Compiler Refactoring Plan

## Current Structure

```
src/world/lighting/
├── LightsCompiler.ts    (830 lines - ALL logic embedded)
├── types.ts
└── README.md
```

**All light logic is embedded as template strings in LightsCompiler.ts:**
- Lines 30-58: Point light sampler GLSL
- Lines 64-114: Sphere light sampler GLSL
- Lines 120-169: Quad light sampler GLSL
- Plus all the parameter/uniform/encoding logic mixed in

## Proposed Structure

```
src/world/lighting/
├── LightsCompiler.ts           (simplified orchestrator ~350 lines)
├── samplers/
│   ├── point-light.ts          (~120 lines - ALL point light logic)
│   ├── sphere-light.ts         (~160 lines - ALL sphere light logic)
│   └── quad-light.ts           (~240 lines - ALL quad light logic)
├── types.ts
└── README.md
```

**Each light type in its own file with ALL its logic:**
- Sampler GLSL generation
- Uniform generation
- Parameter generation
- Uniform binding generation
- Data encoding
- Documentation/comments

## Benefits

### 1. **Clarity & Organization**
- All logic for one light type in one place
- Easy to find "how does sphere light sampling work?" → open `sphere-light.ts`
- Each file is focused and self-contained

### 2. **Easier to Extend**
When adding a new light type (e.g., disk light, directional light):

**Before:**
- Edit 6+ different locations in LightsCompiler.ts
- Risk missing a dispatcher case
- Hard to see all the pieces needed

**After:**
- Copy `quad-light.ts` → `disk-light.ts`
- Modify the GLSL sampling logic
- Add 5 dispatcher cases in LightsCompiler.ts
- Done!

### 3. **Better for Complex Lights**
As lights get more sophisticated:
- **Textured area lights** - sampling logic might be 50+ lines
- **IES profiles** - need intersection + lookup + falloff
- **Portal lights** - complex visibility testing
- **Mesh lights** - triangle sampling, BVH traversal

Having this in separate files makes each light type manageable.

### 4. **Documentation & Comments**
Each light file can have:
- Detailed header explaining the sampling algorithm
- References to papers/techniques
- Mathematical derivations in comments
- Example usage

### 5. **Testing**
Easier to test individual light types:
```typescript
import { generateSphereLightSampler } from './samplers/sphere-light.js';

// Test just sphere light generation
const glsl = generateSphereLightSampler(testLight, { index: 0, isSingleLight: true });
// Verify GLSL output
```

### 6. **Code Review**
When someone modifies sphere light sampling:
- The diff shows changes in `sphere-light.ts` only
- Reviewer doesn't need to navigate a huge file
- Clear what changed and why

## Example: Adding a New Light Type

### Current Approach (6 edits in LightsCompiler.ts)

1. Add `generateDiskLightSampler()` function (~40 lines)
2. Add case in `generateLightSampler()` dispatcher
3. Add case in `encodeLightData()` dispatcher
4. Add case in `generateUniformsForSingleLight()`
5. Add case in `generateParametersForLight()`
6. Add case in `generateUniformBindingsForLight()`

### New Approach (1 new file + 5 one-liners)

1. Create `samplers/disk-light.ts` with all exports
2. Add import in LightsCompiler.ts
3. Add case in `generateLightSampler()` → `return generateDiskLightSampler(light, options);`
4. Add case in `encodeLightData()` → `return encodeDiskLightData(light);`
5. Add case in `generateUniformsForSingleLight()` → `return generateDiskLightUniforms();`
6. Add case in `generateParametersForLight()` → `return getDiskLightParameters(light);`
7. Add case in `generateUniformBindingsForLight()` → `return getDiskLightUniformBindings(light);`

## Migration Steps

1. ✅ Create `samplers/` directory structure
2. ✅ Create `quad-light.ts` (most complex - good template)
3. ✅ Create `sphere-light.ts`
4. ✅ Create `point-light.ts`
5. ⏸️ Create simplified LightsCompiler.ts that imports these
6. ⏸️ Test that compilation still works
7. ⏸️ Replace old LightsCompiler.ts with new version
8. ⏸️ Delete old code
9. ⏸️ Update README.md with new structure

## Files Created (Ready to Review)

- ✅ `src/world/lighting/samplers/quad-light.ts` - Complete quad light module
- ✅ `src/world/lighting/samplers/sphere-light.ts` - Complete sphere light module
- ✅ `src/world/lighting/samplers/point-light.ts` - Complete point light module
- ✅ `REFACTOR_PREVIEW_LightsCompiler.ts` - Shows simplified compiler

## Next Steps

**Option A: Apply the refactor now**
- Replace current LightsCompiler.ts with REFACTOR_PREVIEW version
- Test everything still works
- Clean up

**Option B: Keep current structure**
- Delete the preview files
- Continue with current embedded approach
- Revisit when adding more complex lights

**What do you think?** Should we apply this refactor?
