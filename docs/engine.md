# Engine Pillar: Requirements and Questions

## What We Already Know Engine Must Do

Based on our Photography and World specifications, the Engine must:

### 1. Shader Compilation and Assembly
- **Combine modules** into complete GLSL programs
- **Auto-prefix functions** (e.g., `geodesic` → `g_geodesic`, `interact` → `m_interact`)
- **Auto-prefix uniforms** (e.g., `albedo` → `u_material_glass_albedo`)
- **Inject common types** (Ray, Hit, Frame, etc.) available to all modules
- **Validate contracts** - ensure required functions are provided
- **Handle defines** from module descriptors (#define POINT_TYPE vec3)

### 2. Uniform Management
- **Bind module parameters** to shader uniforms
- **Track parameter changes** to trigger re-accumulation
- **Provide system uniforms**:
    - `u_resolution` (viewport size)
    - `u_time` (for animation)
    - `u_frame` (accumulation count)
    - `u_random_seed` (per-pixel random offset)
    - Camera matrices and parameters

### 3. Resource Management
- **Texture binding** for environment maps, textures
- **Buffer management** for BVH data, light CDFs
- **Film buffers** for accumulation (double-buffered)
- **Auxiliary buffers** (depth, normals, object IDs)

### 4. Render Loop Execution
- **Clear accumulation** when scene/parameters change
- **Dispatch renders** with appropriate viewport coverage
- **Ping-pong buffers** for accumulation
- **Handle convergent vs realtime** rendering modes
- **Output to screen or file**

### 5. Contract Validation
- **Check module interfaces** match requirements
- **Verify function signatures**
- **Ensure required defines** are present
- **Report clear errors** when contracts aren't met

### 6. Module Communication
- **Wire up cross-module calls** (materials calling geometry functions)
- **Resolve module dependencies**
- **Handle optional functions** (check if provided before calling)

---

## Questions for Engine Design

### Theme 1: Shader Compilation Strategy

**1.1 Compilation Approach**
- Should we compile shaders at startup or on-demand?
- Pre-compile common configurations or always JIT?
- Cache compiled programs or rebuild each session?

**1.2 Module Assembly**
- How do modules specify their GLSL code?
    - Single string?
    - Separate files?
    - Template strings with placeholders?
- How do we handle GLSL version and extensions?

**1.3 Error Handling**
- How verbose should shader compilation errors be?
- Should we add line numbers/module names to errors?
- Fallback behavior when compilation fails?

### Theme 2: State Management

**2.1 Parameter Updates**
- How do we detect when parameters change?
    - Dirty flags?
    - Comparison?
    - Version numbers?
- Which changes trigger re-accumulation vs just uniform updates?

**2.2 Module Lifecycle**
- Can modules be hot-swapped during rendering?
- How do we handle module initialization/cleanup?
- Should modules have setup()/teardown() methods?

**2.3 Configuration**
- How do we specify which modules to use?
    - Recipe objects?
    - Module arrays?
    - Builder pattern?
- How do we validate module compatibility?

### Theme 3: Performance and Optimization

**3.1 Render Modes**
- How do we switch between convergent and realtime modes?
    - Different shader programs?
    - Uniform flag?
    - Separate pipelines?

**3.2 GPU Utilization**
- Tile-based rendering for large resolutions?
- Multiple dispatch sizes (full screen, tiles, single pixels)?
- Async readback for progressive display?

**3.3 Memory Management**
- Maximum texture units we can assume?
- How to handle scenes exceeding GPU memory?
- Strategy for film buffer allocation?

### Theme 4: Film and Accumulation

**4.1 Film Architecture**
- What data does film store beyond color?
    - Sample count per pixel?
    - Variance estimates?
    - Auxiliary passes?
- Fixed format or configurable?

**4.2 Accumulation Control**
- How do we handle different accumulation strategies?
    - Simple averaging?
    - Weighted by sample count?
    - Variance-based?
- Maximum samples before numerical precision issues?

**4.3 Output Pipeline**
- When does tonemapping happen?
    - Per sample?
    - Post accumulation?
    - Display only?
- Multiple output formats (screen, file, buffer)?

### Theme 5: Debugging and Development

**5.1 Debug Features**
- Should we support shader hot-reload?
- Debug visualization modes (normals, UVs, materials)?
- Performance profiling built-in?

**5.2 Validation Modes**
- Strict mode that validates every function call?
- NaN/Inf checking?
- Energy conservation validation?

**5.3 Developer Experience**
- Console logging from shaders?
- Breakpoint/pause functionality?
- Frame-by-frame stepping?

### Theme 6: Platform and Context

**6.1 WebGL Constraints**
- WebGL 2 only or support WebGL 1 fallback?
- How to handle missing extensions?
- Mobile GPU considerations?

**6.2 Rendering Context**
- Single canvas or support multiple viewports?
- Offscreen rendering support?
- Integration with other WebGL content?

**6.3 Future Compatibility**
- WebGPU migration path?
- Compute shader support when available?
- Progressive enhancement strategy?

### Theme 7: Module Interface Details

**7.1 Module Discovery**
- How does engine find available modules?
    - Registration system?
    - Filesystem scanning?
    - Explicit imports?

**7.2 Module Metadata**
- What metadata should modules provide beyond the descriptor?
    - Human-readable descriptions?
    - Compatibility information?
    - Performance hints?

**7.3 Inter-module Communication**
- How do modules reference each other's functions?
    - Direct calls with prefixes?
    - Function pointer tables?
    - Dynamic dispatch?

### Theme 8: User Integration

**8.1 API Surface**
- What does the public API look like?
    - Object-oriented?
    - Functional?
    - Event-driven?

**8.2 Events and Callbacks**
- What events does engine emit?
    - Render complete?
    - Accumulation milestones?
    - Errors?

**8.3 Control Flow**
- Who drives the render loop?
    - Engine with requestAnimationFrame?
    - User calls render()?
    - Both options?

## Next Steps

After you answer these questions, we'll:
1. Create a detailed Engine design document
2. Define the Engine contract (what it guarantees to modules)
3. Design the Module->Engine interface
4. Plan the implementation phases

The Engine is the foundational layer that makes everything else work, so getting this right is crucial for the entire system's success.
