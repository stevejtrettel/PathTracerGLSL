You're absolutely right - modules belong to World and Photography! What I meant was "minimal test modules" - super simple but valid implementations that you can use to test the Engine during development. These would just be stub implementations to verify the compilation pipeline works, not the real mathematical modules. But let's focus on the pitfalls document first since that's pure engine knowledge.

# Engine Implementation Pitfalls

## WebGL State Management

### The Framebuffer Trap
**Problem**: Reading pixels always returns black/zeros  
**Symptom**: `readPixels()` gives [0,0,0,0] even though you see colors on screen  
**Cause**: Still reading from a framebuffer instead of the screen
```typescript
// WRONG - still bound to framebuffer
gl.bindFramebuffer(gl.FRAMEBUFFER, filmFramebuffer);
gl.drawArrays(gl.TRIANGLES, 0, 3);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels); // Reads from FBO!

// CORRECT
gl.bindFramebuffer(gl.FRAMEBUFFER, filmFramebuffer);
gl.drawArrays(gl.TRIANGLES, 0, 3);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);  // CRITICAL: Unbind first!
gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
```

### The Program State Trap
**Problem**: Uniforms not updating despite correct locations  
**Symptom**: Shader always uses value 0 or previous program's values  
**Cause**: Setting uniforms before `useProgram()`
```typescript
// WRONG
gl.uniform3fv(location, [1, 2, 3]);
gl.useProgram(program);  // Too late!

// CORRECT
gl.useProgram(program);  // MUST be first
gl.uniform3fv(location, [1, 2, 3]);
```

### The Texture Unit Collision
**Problem**: Wrong textures appearing, usually black  
**Symptom**: Material textures show up as film textures or vice versa  
**Cause**: Not respecting texture unit reservations
```typescript
// WRONG - Film using unit 10
gl.activeTexture(gl.TEXTURE0 + 10);  
gl.bindTexture(gl.TEXTURE_2D, filmTexture);

// CORRECT - Film MUST use 0-7
gl.activeTexture(gl.TEXTURE0 + 0);  // Film: 0-7
gl.bindTexture(gl.TEXTURE_2D, filmTexture);
```

### The Float Texture Silent Failure
**Problem**: HDR rendering not working, everything clamped to [0,1]  
**Symptom**: No errors but accumulation tops out at white  
**Cause**: Float render targets not supported but WebGL doesn't error
```typescript
// WRONG - Assumes it worked
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, 
              gl.RGBA, gl.FLOAT, null);

// CORRECT - Check extension first!
const ext = gl.getExtension('EXT_color_buffer_float');
if (!ext) {
  console.error('No HDR support!');
  // Fall back to RGBA8
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, null);
}
```

## Compilation Pipeline Pitfalls

### The Prefix Confusion
**Problem**: "Undefined function" errors after prefixing  
**Symptom**: `'c_generate_ray' is not defined` but you can see it in source  
**Cause**: Module CALLS use prefixed names, module DEFINITIONS create them
```typescript
// Module A provides 'intersect' → becomes 'sc_intersect'
// Module B requires 'intersect' → must call 'sc_intersect'

// WRONG in ResolveCallsStage
source.replace(/\bintersect\(/g, 'intersect(');  // Not prefixed!

// CORRECT
source.replace(/\bintersect\(/g, 'sc_intersect(');  // Use prefixed name
```

### The Geometry Must Be First
**Problem**: Every module has "undefined type Ray" errors  
**Symptom**: First error is always about missing struct definitions  
**Cause**: Geometry module defines types, MUST be concatenated first
```typescript
// WRONG - Random order
const source = modules.map(m => m.source).join('\n');

// CORRECT - Geometry explicitly first
const geometry = modules.find(m => m.kind === 'geometry');
const others = modules.filter(m => m.kind !== 'geometry');
const source = geometry.source + '\n' + others.map(m => m.source).join('\n');
```

### The Function Signature Mismatch
**Problem**: "No matching overload for function"  
**Symptom**: Function exists but GLSL says it doesn't match  
**Cause**: Prefixing changed the signature incorrectly
```typescript
// WRONG - Prefixing too aggressively
"vec3 evaluate(" becomes "vec3 m_evaluate("  // Good
"return evaluate(" becomes "return m_evaluate("  // Good
"float evaluate = 1.0;" becomes "float m_evaluate = 1.0;"  // BAD!

// CORRECT - Only prefix function definitions and calls
/\b(vec3|float|void)\s+evaluate\s*\(/  // Definition
/(?<![\w\.])\bevaluate\s*\(/           // Call (not preceded by word or dot)
```

### The Uniform Double-Prefix
**Problem**: Uniforms not found, null locations  
**Symptom**: `getUniformLocation('u_camera_u_camera_pinhole_fov')` returns null  
**Cause**: Prefixing uniforms that are already prefixed
```glsl
// WRONG - Module has:
uniform float u_camera_fov;  // Already prefixed!
// After prefixing stage:
uniform float u_camera_pinhole_u_camera_fov;  // Double prefix!

// CORRECT - Module should have:
uniform float fov;  // No prefix in module
// After prefixing stage:
uniform float u_camera_pinhole_fov;  // Single prefix
```

## Uniform System Pitfalls

### The Location Cache Trap
**Problem**: Uniforms stop updating after switching programs  
**Symptom**: First recipe works, second uses first's values  
**Cause**: Caching uniform locations across different programs
```typescript
// WRONG - Locations are program-specific!
class UniformBinder {
  private locationCache = new Map<string, WebGLUniformLocation>();
  
  buildBindings(program: WebGLProgram) {
    // Uses old locations from different program!
  }
}

// CORRECT
class UniformBinder {
  buildBindings(program: WebGLProgram) {
    this.locationCache.clear();  // Clear when program changes
    // Or better: include program in cache key
  }
}
```

### The Null Location Silence
**Problem**: Uniform updates silently fail  
**Symptom**: No errors but values don't change  
**Cause**: Shader optimized out unused uniforms
```typescript
// WRONG - Crashes on null
const location = gl.getUniformLocation(program, 'u_unused');
gl.uniform1f(location, 1.0);  // location is null!

// CORRECT - Check for null
const location = gl.getUniformLocation(program, 'u_unused');
if (location !== null) {  // Explicitly check
  gl.uniform1f(location, 1.0);
}
// Uniform was optimized out - this is OK, don't error
```

### The Type Mismatch Silent Failure
**Problem**: Uniforms wrong type, no error  
**Symptom**: Weird values or zeros in shader  
**Cause**: JavaScript/GLSL type mismatch
```typescript
// WRONG - JavaScript number[] vs GLSL vec3
gl.uniform3fv(location, [1, 2]);  // Only 2 elements!

// CORRECT - Validate length
if (value.length !== 3) throw new Error('vec3 needs 3 elements');
gl.uniform3fv(location, value);
```

## Resource Management Pitfalls

### The Framebuffer Completeness Timing
**Problem**: Framebuffer incomplete errors  
**Symptom**: `FRAMEBUFFER_INCOMPLETE_ATTACHMENT`  
**Cause**: Checking completeness before all attachments
```typescript
// WRONG
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER); // Too early!

// CORRECT
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, 
                         gl.TEXTURE_2D, texture, 0);
const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER); // After attaching
```

### The Texture Parameter Order
**Problem**: Textures always black  
**Symptom**: Texture creation succeeds but sampling returns zeros  
**Cause**: Setting texture parameters after data upload
```typescript
// WRONG - Parameters after data
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, 
              gl.RGBA, gl.FLOAT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

// CORRECT - Parameters BEFORE data
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0,
              gl.RGBA, gl.FLOAT, null);
```

### The Film Buffer Swap Timing
**Problem**: No accumulation happening  
**Symptom**: Each frame looks the same, no progressive refinement  
**Cause**: Swapping buffers at wrong time
```typescript
// WRONG - Swap before render
resources.swapFilmBuffers();
executor.renderFrame();  // Reads and writes to same buffer!

// CORRECT - Swap after render
executor.renderFrame();  // Read from previous, write to current
resources.swapFilmBuffers();  // Now swap for next frame
```

## State Machine Pitfalls

### The Transition Validation
**Problem**: Invalid state transitions causing crashes  
**Symptom**: "Cannot transition from X to Y"  
**Cause**: Not going through intermediate states
```typescript
// WRONG - Direct transition
this.state = { type: 'running' };  // From uninitialized!

// CORRECT - Proper sequence
this.state = { type: 'uninitialized' };
// ... initialize subsystems ...
this.state = { type: 'ready' };
// ... compile and select program ...
this.state = { type: 'running' };
```

### The Frame Counter Reset
**Problem**: Film never clears on parameter change  
**Symptom**: Ghosting when moving camera  
**Cause**: Not resetting frame counter with accumulation
```typescript
// WRONG
clearFilmBuffers();
// Frame counter still high!

// CORRECT
clearFilmBuffers();
this.state = { ...this.state, frame: 0 };  // Reset counter too!
```

## Performance Pitfalls

### The String Operation Explosion
**Problem**: Compilation takes seconds  
**Symptom**: Browser freezes during initialization  
**Cause**: Repeated string operations in tight loops
```typescript
// WRONG - String concatenation in loop
let source = '';
for (const module of modules) {
  source += module.source;  // Creates new string each time
}

// CORRECT - Array join
const parts = modules.map(m => m.source);
const source = parts.join('\n');  // Single allocation
```

### The Synchronous Readback
**Problem**: Framerate drops to single digits  
**Symptom**: Smooth until you call readPixels  
**Cause**: Synchronous GPU stall
```typescript
// WRONG - Blocks GPU pipeline
const pixels = new Float32Array(width * height * 4);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
processPixels(pixels);  // GPU stalled waiting

// CORRECT - Async with fence
gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
// ... continue rendering ...
// Later, check if ready
if (gl.clientWaitSync(sync, 0, 0) === gl.CONDITION_SATISFIED) {
  processPixels(pixels);
}
```

## Context Loss Pitfalls

### The Recovery Resource Leak
**Problem**: Memory usage grows after context restore  
**Symptom**: Each context loss/restore cycle uses more memory  
**Cause**: Not cleaning up old resources before creating new
```typescript
// WRONG - Just create new resources
handleContextRestore() {
  this.setupResources();  // Old resources still referenced!
}

// CORRECT - Clean up first
handleContextRestore() {
  this.cleanupResources();  // Delete old
  this.setupResources();    // Create new
}
```

### The State Assumption
**Problem**: Render fails after context restore  
**Symptom**: Black screen after tab switching  
**Cause**: Assuming WebGL state persists
```typescript
// WRONG - Assumes state still set
handleContextRestore() {
  // Just recompile shaders
}

// CORRECT - Reset everything
handleContextRestore() {
  // Recompile shaders
  // Recreate textures
  // Reset all state
  // Rebind everything
  gl.useProgram(program);  // Must set again!
}
```

## Module Integration Pitfalls

### The Missing Base Types
**Problem**: Modules compile alone but not together  
**Symptom**: "Hit" undefined in material module  
**Cause**: Assuming types are globally available
```glsl
// WRONG - Material module assumes Hit exists
vec3 evaluate(vec3 wi, vec3 wo, Hit hit) {
  // But Hit is defined in Geometry!
}

// This is actually CORRECT - Geometry must provide base types
// The fix is in compilation order, not module code
```

### The Circular Dependency
**Problem**: Infinite loop during sorting  
**Symptom**: Browser hangs during compilation  
**Cause**: Module A requires B, B requires A
```typescript
// Detect during validation
if (detectCycles(dependencies)) {
  throw new Error('Circular dependency detected');
}
// Better to fail fast than infinite loop
```
