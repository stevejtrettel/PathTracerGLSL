# Buffer Visualization System - Problem Statement

## Goal

Provide a flexible way to visualize and export data from **any buffer** in the rendering pipeline, regardless of which renderer is active or what the buffer's purpose is.

**Primary use cases:**
1. **Debugging**: Quickly inspect intermediate buffers during development
2. **AOV workflows**: View and export Arbitrary Output Variables (albedo, normals, depth, etc.)
3. **Multi-strategy development**: Compare output from different rendering strategies
4. **Production exports**: Export HDR radiance, LDR screenshots, and debug data

---

## Buffer Inventory

### Current Renderers & Their Buffers

#### 1. **pathtracer-simple**
```
Pipeline:
  Pass 1: main-pass → accumulation (double_buffer, rgba32f)
    - accumulation_current:0 (radiance HDR)
    - accumulation_previous:0 (previous frame radiance)
  Pass 2: display-pass → screen
    - screen (default framebuffer)

Buffers of interest:
  - accumulation_current:0 - HDR radiance for export
  - screen - LDR display for screenshots
```

#### 2. **pathtracer-aovs** (MRT)
```
Pipeline:
  Pass 1: main-pass → accumulation (double_buffer, [rgba32f, rgba8, rgba16f])
    - accumulation_current:0 (radiance HDR)
    - accumulation_current:1 (albedo LDR)
    - accumulation_current:2 (normal)
    - accumulation_previous:0 (previous radiance)
  Pass 2: display-pass → screen
    - screen (default framebuffer)

Buffers of interest:
  - accumulation_current:0 - HDR radiance
  - accumulation_current:1 - Albedo (for compositing)
  - accumulation_current:2 - Normals (for denoising/relighting)
  - screen - Final display
```

#### 3. **debug**
```
Pipeline:
  Pass 1: debug-pass → screen

Buffers of interest:
  - screen - Debug visualization
```

### Future Renderers (Anticipated)

#### 4. **denoised-pathtracer** (Multi-pass)
```
Pipeline:
  Pass 1: trace-pass → raw-buffer (rgba32f)
  Pass 2: denoise-pass → denoised-buffer (rgba32f)
  Pass 3: display-pass → screen

Buffers of interest:
  - raw-buffer - Pre-denoise radiance
  - denoised-buffer - Post-denoise radiance
  - screen - Final display
```

#### 5. **production-pathtracer** (MRT + Multi-pass)
```
Pipeline:
  Pass 1: gbuffer-pass → gbuffer (MRT: depth, normal, albedo, roughness)
  Pass 2: lighting-pass → radiance-buffer
  Pass 3: post-process-pass → processed-buffer
  Pass 4: display-pass → screen

Buffers of interest:
  - gbuffer:0 (depth)
  - gbuffer:1 (normal)
  - gbuffer:2 (albedo)
  - gbuffer:3 (roughness)
  - radiance-buffer (HDR lighting result)
  - processed-buffer (tone-mapped, color-graded)
  - screen
```

---

## Current Systems (Status Quo)

### 1. Renderer-Specific Display Logic (pathtracer-aovs)
**How it works:**
- Display shader has hardcoded inputs: `u_radiance`, `u_albedo`, `u_normal`
- `u_display_mode` uniform (0/1/2) switches which to display
- UI buttons call `engine.setParameter('renderer.displayMode', N)`

**Pros:**
- Works today
- Renderer controls its own display logic
- Fast (no extra passes)

**Cons:**
- Only works for pathtracer-aovs
- Hardcoded for 3 buffers
- Adding a new AOV requires modifying shader
- Doesn't work with pathtracer-simple or future renderers
- Can't inspect intermediate buffers in multi-pass pipelines

### 2. Export System (FlexibleEngine)
**How it works:**
- Renderers define `exportTargets`: `{ 'hdr': { bufferId: 'accumulation_current', format: 'float', attachment: 0 } }`
- Call `engine.readExport('hdr')` returns pixel data
- Call `engine.readBuffer(bufferId, format, attachment)` for low-level access

**Pros:**
- Generic - works with any renderer
- Can read any buffer
- High-level (`readExport`) and low-level (`readBuffer`) APIs

**Cons:**
- Returns pixel data, not visual display
- No way to quickly see "what's in this buffer?"
- Manual inspection (console.log, save file, re-import)

### 3. Old Engine (Recipe-based)
**How it works:**
- `readRadiance()` - reads HDR accumulation
- `readRGB()` - reads LDR display
- No switching/visualization

**Pros:**
- Simple, clear purpose

**Cons:**
- Fixed structure (can't read arbitrary buffers)
- No MRT support
- Being replaced

---

## Proposed Solutions

### Solution A: Renderer-Defined Display Modes (Current pathtracer-aovs approach)

**Description:** Each renderer that needs visualization builds it into their display shader.

**Implementation:**
```typescript
// Renderer defines what can be displayed
display-shader: {
  inputs: [radiance, albedo, normal],
  uniform: u_display_mode
}

// User switches via parameters
engine.setParameter('renderer.displayMode', 1);
```

**Pros:**
- Renderer has full control
- No engine changes needed
- Can optimize for specific use case

**Cons:**
- Not generic (each renderer reimplements)
- Can't visualize buffers the renderer didn't expose
- Can't debug intermediate buffers in multi-pass pipelines
- Switching renderers loses visualization capability

**Constraints:**
- Works for simple AOV display
- Doesn't scale to complex multi-pass debugging
- Requires recompiling renderer to add new visualizations

---

### Solution B: Engine-Level Debug Visualization Override

**Description:** FlexibleEngine has a generic "debug mode" that overrides screen output.

**Implementation:**
```typescript
// After renderer pipeline completes:
engine.enableVisualization('accumulation_current:1', { mode: 'raw' });

// Internally:
// 1. Renderer executes normally (all buffers written)
// 2. IF debug visualization active:
//    - Bind screen framebuffer
//    - Use generic debug shader
//    - Bind requested texture
//    - Draw fullscreen quad (overwrite screen)
```

**Pros:**
- Works with ANY renderer
- Can visualize ANY buffer (even ones renderer didn't intend to expose)
- Can inspect intermediate buffers
- One implementation for all renderers
- Renderer keeps running normally

**Cons:**
- Extra pass after pipeline (small overhead when active)
- Two "display" systems (renderer's display + engine override)
- Need to handle renderer switching gracefully
- Adds complexity to engine

**Constraints:**
- Requires buffer to exist in active renderer
- Switching renderers must handle visualization state (disable? maintain?)
- Generic shader might not handle all buffer types well (depth encoding, etc.)

---

### Solution C: Hybrid Approach

**Description:** Renderers can define display modes, OR use engine override for debugging.

**Implementation:**
```typescript
// Production use: renderer-defined display
engine.setParameter('renderer.displayMode', 1);  // pathtracer-aovs shows albedo

// Debug use: engine override
engine.enableVisualization('gbuffer:2', { mode: 'raw' });  // inspect depth
```

**Pros:**
- Best of both worlds
- Renderers optimized for common cases
- Engine override for debugging edge cases

**Cons:**
- Two systems to maintain
- Confusing which to use when
- Potential conflicts (what if both active?)

**Constraints:**
- Need clear priority (does engine override win? or renderer display?)
- Documentation burden (users need to understand both systems)

---

## Open Questions

### Question 1: Renderer Ownership
**Should renderers control what gets displayed to screen?**
- **Yes**: Renderers define display pass, engine doesn't interfere
- **No**: Engine always controls screen, renderers just write to buffers

**Implications:**
- If YES → Solution A or C
- If NO → Solution B

### Question 2: Debugging vs Production
**Are we building a debugging tool or a production feature?**
- **Debugging**: Temporary inspection during development → Solution B
- **Production**: Permanent AOV workflow → Solution A or hybrid

### Question 3: Multi-Pass Complexity
**How important is intermediate buffer inspection?**
- **Critical**: Need to debug multi-pass pipelines → Solution B required
- **Nice-to-have**: Export system + occasional inspection → Solution A acceptable

### Question 4: Old Engine Migration
**What features from old Engine need to carry over?**
- `readRadiance()` → Covered by `readExport('hdr')`
- `readRGB()` → Covered by `readExport('ldr')`
- New: Need visualization?

### Question 5: Renderer Switching
**What happens when switching renderers with visualization active?**
- Auto-disable (clean slate)
- Try to maintain (might fail if buffer doesn't exist)
- Not a concern (only debug single renderer at a time)

---

## Decision Criteria

To choose a solution, consider:

1. **Primary use case**: Debugging vs production AOV workflow
2. **Renderer complexity**: Will we have complex multi-pass pipelines?
3. **Development velocity**: Is quick buffer inspection critical?
4. **System simplicity**: One system vs. two systems
5. **Old Engine parity**: What functionality must we preserve?

---

## Recommendation (Deferred)

This decision should be made when:
- [ ] Old Engine migration is complete (know what features are essential)
- [ ] We've built at least one multi-pass renderer (understand complexity)
- [ ] We've built a production renderer (understand production needs)
- [ ] We've used export system in practice (know what's missing)

**For now**: Keep current pathtracer-aovs approach working, use `readExport()` for debugging other renderers.

---

## Document Status

**Created**: 2025-11-20
**Status**: Open - awaiting decision
**Next Review**: After old Engine migration complete
