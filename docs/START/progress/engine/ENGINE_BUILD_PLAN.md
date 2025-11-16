# Engine Build Plan - Research-Focused Priorities

## Context: Solo Research Tool

You're building a **stable foundation for years of shader research**, not production software. This means:

**Build**: Features that protect your work and enable reproducibility
**Defer**: Error reporting as future mini-project when needed
**Skip**: Enterprise concerns, monitoring, extensive validation

## Priority System for Research

- **P0 (Protection)**: Prevents losing hours of work
- **P1 (Reproducibility)**: Enables rigorous research
- **P2 (Future Polish)**: Nice-to-have debugging aids
- **P3 (Skip)**: Overkill for solo research

---

## Core Protection Layer (Build These First)

These three features form a **stability foundation** - protecting your research work and enabling reproducibility. Build them once, benefit for years.

**Total Time**: ~13 hours
**When**: Before serious research begins or after first context loss
**Value**: Protection from data loss + reproducible results

---

### 1.1 ModuleRegistry [P1]
**Why**: Currently no validation that modules implement required functions. Shader compilation is only feedback.

**Tasks**:
```typescript
// Create: engine/ModuleRegistry.ts

class ModuleRegistry {
  private modules = new Map<string, ModuleDescriptor>();
  private byKind = new Map<ModuleKind, Set<ModuleDescriptor>>();
  
  // Core operations
  register(module: ModuleDescriptor): void;
  get(kind: ModuleKind, name: string): ModuleDescriptor | null;
  has(kind: ModuleKind, name: string): boolean;
  
  // Validation
  validateModule(module: ModuleDescriptor): ValidationResult;
  checkCompatibility(recipe: Recipe): CompatibilityResult;
  
  // Discovery
  listByKind(kind: ModuleKind): ModuleDescriptor[];
  search(query: ModuleQuery): ModuleDescriptor[];
}
```

**Implementation Steps**:
1. Create ModuleRegistry class with Map storage
2. Implement `validateModule()` checking for required exports
3. Add KIND prefix validation (ambient_*, scene_*, etc.)
4. Implement `checkCompatibility()` for Recipe validation
5. Add built-in module registration (stubs for testing)
6. Update Engine to use registry in `extractModules()`

**Acceptance**:
- ✅ Validates modules have required functions
- ✅ Enforces KIND prefixing convention  
- ✅ Checks recipe compatibility before compile
- ✅ Provides helpful error messages

**Estimated Time**: 4-6 hours

---

### 1.2 Structured Error Types [P1]
**Why**: Better debugging with context-rich errors

**Tasks**:
```typescript
// Add to: engine/types.ts

class EngineError extends Error {
  constructor(
    message: string,
    public subsystem: string,
    public recoverable: boolean = false
  );
}

class CompilationError extends EngineError {
  constructor(
    message: string,
    public validation: ValidationResult,
    public module?: string,
    public line?: number
  );
}

class ResourceAllocationError extends EngineError {
  constructor(
    public resourceType: string,
    public requested: number,
    public available?: number
  );
}

class ModuleNotFoundError extends EngineError {
  constructor(
    public kind: ModuleKind,
    public name: string,
    public alternatives?: string[]
  );
}
```

**Implementation Steps**:
1. Define error classes in types.ts
2. Update ShaderCompiler to throw CompilationError
3. Update ResourceManager to throw ResourceAllocationError
4. Update ModuleRegistry to throw ModuleNotFoundError
5. Add error context extraction helpers

**Acceptance**:
- ✅ All errors include subsystem info
- ✅ Compilation errors include validation context
- ✅ Module errors suggest alternatives
- ✅ Resource errors report memory info

**Estimated Time**: 2-3 hours

---

### 1.3 Capability Detection [P1]
**Why**: Graceful degradation on limited hardware

**Tasks**:
```typescript
// Extend: engine/ResourceManager.ts

interface CapabilityReport {
  webgl2: boolean;
  floatRenderTargets: boolean;
  floatLinearFiltering: boolean;
  maxTextureSize: number;
  maxTextureUnits: number;
  maxColorAttachments: number;
  // ... etc
}

class ResourceManager {
  private detectCapabilities(): CapabilityReport;
  
  validateCapabilities(): ValidationResult;
  hasCapability(capability: string): boolean;
  suggestFallback(capability: string): FallbackSuggestion | null;
}
```

**Implementation Steps**:
1. Implement `detectCapabilities()` querying all GL parameters
2. Add `validateCapabilities()` checking minimums
3. Create fallback suggestion database
4. Call validation in Engine constructor
5. Handle failures per config.fallbackBehavior

**Acceptance**:
- ✅ Detects all relevant GL capabilities
- ✅ Validates minimum requirements
- ✅ Suggests fallbacks for missing features
- ✅ Logs clear capability report on init

**Estimated Time**: 3-4 hours

---

## Phase 2: Developer Experience (P1-P2)

### 2.1 Compilation Reports [P2]
**Why**: Track compilation performance, debug shader issues

**Tasks**:
```typescript
// Extend: engine/ShaderCompiler.ts

interface CompilationReport {
  recipesCompiled: number;
  recipesSucceeded: number;
  recipesFailed: number;
  totalTime: number;
  averageTime: number;
  programs: Array<{
    recipeId: string;
    success: boolean;
    time: number;
    error?: string;
  }>;
}

class ShaderCompiler {
  private compilationReport: CompilationReport;
  
  getCompilationReport(): CompilationReport;
  getAverageCompileTime(): number;
  
  // Source inspection
  getSource(recipeId: string): { vertex: string; fragment: string } | null;
}
```

**Implementation Steps**:
1. Add timing tracking to compile() method
2. Build CompilationReport during compilation
3. Store sources by recipe ID
4. Implement getSource() for debugging
5. Log compilation stats on Engine.initialize()

**Acceptance**:
- ✅ Reports compilation time per recipe
- ✅ Tracks success/failure rates
- ✅ Provides source code on demand
- ✅ Logs helpful stats at initialization

**Estimated Time**: 2-3 hours

---

### 2.2 Enhanced Shader Error Context [P2]
**Why**: Shader errors are hard to debug without context

**Tasks**:
```typescript
// Extend: engine/ShaderCompiler.ts

private extractErrorContext(
  source: string,
  errorLog: string
): { line: number; context: string; suggestion?: string };

private formatShaderError(
  name: string,
  error: string,
  context: { line: number; context: string; suggestion?: string }
): string;
```

**Implementation Steps**:
1. Parse GL error log for line numbers
2. Extract ±5 lines around error
3. Format with line numbers and arrow
4. Add common error pattern suggestions
5. Include in CompilationError

**Acceptance**:
- ✅ Shows source lines around error
- ✅ Points to exact error location
- ✅ Suggests fixes for common errors
- ✅ Readable error messages

**Estimated Time**: 3-4 hours

---

### 2.3 Memory Statistics [P2]
**Why**: Track GPU memory usage, prevent OOM

**Tasks**:
```typescript
// Extend: engine/ResourceManager.ts

interface MemoryStats {
  textureMemory: number;      // Bytes
  framebufferMemory: number;
  totalMemory: number;
  textureCount: number;
  framebufferCount: number;
  largestTexture: string;
  perRecipeBreakdown: Map<string, number>;
}

class ResourceManager {
  getMemoryStats(): MemoryStats;
  canAllocate(bytes: number): boolean;
  
  private estimateTextureMemory(format: GLenum, width: number, height: number): number;
}
```

**Implementation Steps**:
1. Track texture memory per allocation
2. Track framebuffer memory per allocation
3. Implement memory estimation formulas
4. Add per-recipe breakdown tracking
5. Implement canAllocate() with conservative limit

**Acceptance**:
- ✅ Accurate memory usage estimates
- ✅ Per-recipe breakdown available
- ✅ Warns before allocation would fail
- ✅ Logs memory stats on demand

**Estimated Time**: 2-3 hours

---

## Phase 3: Robustness (P0-P2)

### 3.1 Snapshot System [P0]
**Why**: Context loss destroys all accumulation with no recovery

**Tasks**:
```typescript
// Extend: engine/ResourceManager.ts

interface SnapshotData {
  pixels: Float32Array;
  frame: number;
  timestamp: number;
}

class ResourceManager {
  captureSnapshot(recipeId: string, pixels: Float32Array, frame: number): void;
  getSnapshot(recipeId: string): SnapshotData | null;
  hasSnapshot(recipeId: string): boolean;
  
  private snapshots = new Map<string, SnapshotData>();
  private isAccumulatingRecipe(recipeId: string): boolean;
}
```

**Implementation Steps**:
1. Add snapshot storage Map
2. Implement captureSnapshot() (only for accumulating recipes)
3. Implement getSnapshot() and hasSnapshot()
4. Add automatic cleanup on recipe disposal
5. Update Engine to call captureSnapshot() periodically
6. Update context loss handler to report snapshots

**Acceptance**:
- ✅ Captures snapshots only for accumulating recipes
- ✅ Stores most recent snapshot per recipe
- ✅ Reports available snapshots on context loss
- ✅ Cleans up on recipe disposal

**Estimated Time**: 3-4 hours

---

### 3.2 Context Loss Recovery [P1]
**Why**: Better user experience when GPU context lost

**Tasks**:
```typescript
// Extend: engine/Engine.ts

class Engine {
  private handleContextLoss(): void;
  private handleContextRestore(): void;
}

// Extend: engine/ResourceManager.ts
class ResourceManager {
  handleContextLoss(): void;
  handleContextRestore(): void;
}
```

**Implementation Steps**:
1. Implement comprehensive handleContextLoss()
   - Don't try to delete GPU resources
   - Clear all references
   - Preserve snapshot data
   - Log clear warnings about accumulation loss
   - Report available snapshots
2. Implement handleContextRestore()
   - Recompile all programs
   - Recreate all buffers
   - Reset to ready state
   - Log restoration status
3. Wire up canvas event listeners
4. Test with forced context loss

**Acceptance**:
- ✅ Clean state on context loss
- ✅ Successful restoration when context returns
- ✅ Clear user communication about accumulation loss
- ✅ Reports available snapshots as reference

**Estimated Time**: 4-5 hours

---

## Phase 4: Advanced Features (P2-P3)

### 4.1 Viewport Stack & State Management [P2]
**Why**: Useful for multi-pass rendering, tiled rendering UI

**Tasks**:
```typescript
// Extend: engine/RenderExecutor.ts

interface RenderState {
  viewport: Viewport;
  framebuffer: WebGLFramebuffer | null;
  program: WebGLProgram | null;
  clearColor: [number, number, number, number];
  // ... WebGL state
}

class RenderExecutor {
  private viewportStack: Viewport[] = [];
  
  pushViewport(viewport: Viewport): void;
  popViewport(): void;
  
  saveState(): RenderState;
  restoreState(state: RenderState): void;
  resetState(): void;
}
```

**Implementation Steps**:
1. Add viewport stack storage
2. Implement push/pop methods
3. Add RenderState capture
4. Implement state save/restore
5. Add resetState() to defaults

**Acceptance**:
- ✅ Viewport stack properly balanced
- ✅ State save/restore works correctly
- ✅ Useful for multi-pass effects

**Estimated Time**: 2-3 hours

---

### 4.2 Frame Statistics [P2]
**Why**: Performance monitoring for optimization

**Tasks**:
```typescript
// Extend: engine/RenderExecutor.ts

interface FrameStats {
  frameTime: number;
  averageFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  frameNumber: number;
  drawCalls: number;
  triangles: number;
  fps: number;
  averageFps: number;
  timestamp: number;
  startTimestamp: number;
}

class RenderExecutor {
  private frameStats: FrameStats;
  private frameHistory: number[] = [];
  
  getFrameStats(): FrameStats;
  resetFrameStats(): void;
  getLastFrameTime(): number;
  
  private updateFrameStats(frameTime: number): void;
}
```

**Implementation Steps**:
1. Add frame timing tracking
2. Implement rolling average (60 frames)
3. Track min/max frame times
4. Calculate FPS from average
5. Add updateFrameStats() call in render methods

**Acceptance**:
- ✅ Accurate frame timing
- ✅ Smooth FPS calculation
- ✅ Min/max tracking
- ✅ Low overhead (<0.1ms)

**Estimated Time**: 2-3 hours

---

### 4.3 Async Pixel Readback [P3]
**Why**: Non-blocking for large exports, better UI responsiveness

**Tasks**:
```typescript
// Extend: engine/RenderExecutor.ts

class RenderExecutor {
  async readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;
  async readRGBAsync(rect?: Rectangle): Promise<Uint8Array>;
  
  private createFenceSync(): WebGLSync | null;
  private waitForFence(sync: WebGLSync, timeout: number): Promise<void>;
}
```

**Implementation Steps**:
1. Implement fence sync creation
2. Add async fence waiting with timeout
3. Implement readPixelsAsync using fences
4. Implement readRGBAsync similarly
5. Add timeout handling (5 seconds default)
6. Test with large readbacks

**Acceptance**:
- ✅ Non-blocking pixel reads
- ✅ Proper fence cleanup
- ✅ Timeout handling
- ✅ Falls back gracefully on failure

**Estimated Time**: 3-4 hours

---

### 4.4 Render Target Management [P3]
**Why**: Useful for effects, multi-pass rendering

**Tasks**:
```typescript
// Extend: engine/RenderExecutor.ts

type RenderTarget =
  | { type: "screen" }
  | { type: "framebuffer"; id: string }
  | { type: "framebuffer"; buffer: WebGLFramebuffer };

class RenderExecutor {
  setRenderTarget(target: RenderTarget): void;
  getRenderTarget(): RenderTarget;
  
  private currentTarget: RenderTarget = { type: "screen" };
}
```

**Implementation Steps**:
1. Add RenderTarget type
2. Implement setRenderTarget()
3. Update render methods to respect target
4. Add getRenderTarget() for state queries
5. Integrate with ResourceManager framebuffer lookup

**Acceptance**:
- ✅ Can render to custom framebuffers
- ✅ Can render to screen
- ✅ State properly tracked

**Estimated Time**: 2-3 hours

---

## Phase 5: Polish & Documentation (P3)

### 5.1 Performance Report [P3]
**Why**: Comprehensive performance visibility

**Tasks**:
```typescript
// Add to: engine/Engine.ts

interface PerformanceReport {
  frame: FrameStats;
  memory: MemoryStats;
  compilation: CompilationReport;
  overall: {
    state: string;
    framesRendered: number;
    programsCompiled: number;
    currentRecipeId?: string;
    uptime: number;
  };
}

class Engine {
  getPerformanceReport(): PerformanceReport;
  resetStatistics(): void;
}
```

**Implementation Steps**:
1. Aggregate stats from all subsystems
2. Add overall statistics tracking
3. Implement getPerformanceReport()
4. Add resetStatistics() to clear all

**Acceptance**:
- ✅ Single comprehensive report
- ✅ All subsystems included
- ✅ Can reset for benchmarking

**Estimated Time**: 1-2 hours

---

### 5.2 Complete API Documentation [P3]
**Why**: Match implementation to design docs

**Tasks**:
- Update contracts to match actual implementation
- Document all public methods with examples
- Add architecture diagrams
- Create migration guide from simplified to full system
- Write integration examples

**Estimated Time**: 4-6 hours

---

## Implementation Order Recommendation

### Sprint 1: Foundation (Week 1)
1. ModuleRegistry [P1] - 4-6 hours
2. Structured Error Types [P1] - 2-3 hours
3. Capability Detection [P1] - 3-4 hours

**Total**: ~15 hours | **Outcome**: Validation and safety basics

---

### Sprint 2: Robustness (Week 2)
1. Snapshot System [P0] - 3-4 hours
2. Context Loss Recovery [P1] - 4-5 hours
3. Memory Statistics [P2] - 2-3 hours

**Total**: ~12 hours | **Outcome**: Data loss prevention

---

### Sprint 3: Developer Experience (Week 3)
1. Compilation Reports [P2] - 2-3 hours
2. Enhanced Shader Errors [P2] - 3-4 hours
3. Frame Statistics [P2] - 2-3 hours

**Total**: ~10 hours | **Outcome**: Better debugging

---

### Sprint 4: Advanced Features (Week 4)
1. Async Pixel Readback [P3] - 3-4 hours
2. Viewport Stack [P2] - 2-3 hours
3. Render Target Management [P3] - 2-3 hours

**Total**: ~10 hours | **Outcome**: Production features

---

### Sprint 5: Polish (Week 5)
1. Performance Report [P3] - 1-2 hours
2. Complete Documentation [P3] - 4-6 hours

**Total**: ~7 hours | **Outcome**: Professional finish

---

## Total Estimated Time

**Critical Path (P0-P1)**: ~27 hours (Sprints 1-2)
**Full Implementation**: ~54 hours (All sprints)

## Testing Strategy

### Unit Tests
- ModuleRegistry validation logic
- Error type construction
- Memory estimation formulas
- Capability detection

### Integration Tests
- Recipe compilation end-to-end
- Context loss and recovery
- Snapshot capture and retrieval
- Multi-recipe rendering

### Performance Tests
- Compilation time benchmarks
- Memory usage under load
- Frame rate stability
- Cache hit rates

## Success Criteria

### Phase 1 Complete
- ✅ All modules validated before use
- ✅ Helpful error messages with context
- ✅ Graceful degradation on limited hardware

### Phase 2 Complete
- ✅ Compilation performance tracked
- ✅ Shader errors easy to debug
- ✅ Memory usage visible

### Phase 3 Complete
- ✅ Accumulation survives context loss (via snapshots)
- ✅ Clean recovery after GPU reset
- ✅ Clear user communication

### Phase 4 Complete
- ✅ Advanced rendering features available
- ✅ Performance metrics comprehensive
- ✅ Non-blocking exports

### Phase 5 Complete
- ✅ Documentation matches implementation
- ✅ Easy to understand and extend
- ✅ Production-ready quality

## Next Steps

1. **Review priorities** with your research needs
2. **Start with Sprint 1** (ModuleRegistry + Errors + Capabilities)
3. **Test incrementally** after each feature
4. **Update docs** as you implement

The foundation is solid - these additions will make it robust and developer-friendly!
