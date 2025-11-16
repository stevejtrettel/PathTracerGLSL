# App Pillar: Build Plan

## Current Status

**Overall Completion: 95%**

The App pillar is functionally complete and production-ready for research. All core features work:
- ✅ Parameter management with locking
- ✅ Interactive and production rendering
- ✅ Session save/restore
- ✅ Tiled rendering with resume
- ✅ Extension system
- ✅ Three camera control options
- ✅ File export (PNG + HDR)
- ✅ Statistics display

**What remains**: Documentation and polish for long-term maintainability.

---

## Phase 1: Documentation (High Priority)

**Goal**: Make the code self-documenting so you rarely need to look at it.

### 1.1: Add JSDoc to Core Classes

**App.ts**:
```typescript
/**
 * App - Research path tracer orchestrator
 * 
 * Responsibilities:
 * - Wire Engine, ParameterStore, RenderCoordinator, SessionManager
 * - Manage recipe switching
 * - Host extension system via service registry
 * - Provide keyboard shortcuts for common actions
 * 
 * @example
 * const app = new App(canvas);
 * await app.initialize([recipe1, recipe2], 'env.hdr');
 * app.use(new KeyboardControls()).use(new OrbitControls());
 * app.renderInteractive();
 */

/**
 * Initialize app with recipes and optional environment
 * 
 * @param recipes - Array of shader recipes to compile
 * @param environmentHDR - Optional HDR environment map URL
 * @param initialParameters - Optional initial parameter values
 * 
 * @example
 * await app.initialize(
 *   [pathTracerRecipe, debugRecipe],
 *   'studio.hdr',
 *   { 'camera.position': [0, 5, 10] }
 * );
 */
async initialize(
    recipes: Recipe[],
    environmentHDR?: string,
    initialParameters?: Record<string, any>
): Promise<void>
```

Add similar JSDoc to:
- All public methods in App.ts
- All public methods in ParameterStore.ts
- All public methods in RenderCoordinator.ts
- All public methods in SessionManager.ts
- All public methods in TiledRenderer.ts
- Extension interfaces

**Estimated time**: 2-3 hours

### 1.2: Add Implementation Notes

Add comments explaining non-obvious implementation details:

```typescript
// Recipe switching: Block parameters during switch to prevent reset logic
this.isSwitchingRecipe = true;
this.engine.selectRecipe(recipeId);
this.parameterStore.resendAll();  // Send all params with oldValue === newValue
this.isSwitchingRecipe = false;
```

```typescript
// Production mode rejects Promise on stop, allowing App to cleanup via try/catch
if (this.productionReject) {
    const error = new Error('Production render stopped');
    error.name = 'RenderStopped';  // Name check in App.renderProduction
    this.productionReject(error);
}
```

**Locations needing notes**:
- Recipe switching protocol (App.ts)
- Parameter resendAll logic (ParameterStore.ts)
- Production Promise rejection (RenderCoordinator.ts)
- Tile resume logic (TiledRenderer.ts)
- Camera service fallback (SessionManager.ts)

**Estimated time**: 1 hour

### 1.3: Create Usage Examples File

Create `app/EXAMPLES.md` with:
- Basic setup
- Each rendering mode
- Extension installation
- Parameter management
- Session workflows
- Tiled rendering
- Custom extension development

**Estimated time**: 1 hour

---

## Phase 2: Type Safety (Medium Priority)

**Goal**: Replace `any` types with proper interfaces.

### 2.1: Create Comprehensive Types File

Expand `app/types.ts`:

```typescript
// Extension types (already good)
interface Extension { /* ... */ }

// Add missing types:
interface AppConfig {
    canvas: HTMLCanvasElement;
    recipes: Recipe[];
    environmentHDR?: string;
    initialParameters?: Record<string, any>;
}

interface RenderOptions {
    targetSamples?: number;
    onProgress?: (info: ProgressInfo) => void;
    onComplete?: () => void;
}

interface CameraService {
    getPosition(): [number, number, number];
    getFrame?(): Float32Array;
    getTarget?(): [number, number, number];
    setPosition?(pos: [number, number, number]): void;
}

// ... etc
```

**Estimated time**: 1 hour

### 2.2: Add Type Parameters to Generic Methods

```typescript
// Before
getService(name: string): any

// After
getService<T = any>(name: string): T | undefined
```

Apply to:
- App.getService
- Extension methods that return services
- EventBus handlers (add generic type for data)

**Estimated time**: 30 minutes

### 2.3: Replace `any` in Method Signatures

Audit all files and replace `any` with proper types:
- Extension install methods: `app: any` → `app: App`
- Event handlers: `(data?: any)` → `(data?: ProgressInfo)` etc.
- Service objects: `any` → specific interfaces

**Estimated time**: 1 hour

---

## Phase 3: Error Handling (Low Priority)

**Goal**: Graceful degradation and helpful error messages.

### 3.1: Add Try/Catch Around Engine Calls

Currently App assumes Engine methods succeed. Add protection:

```typescript
async initialize(recipes: Recipe[], ...): Promise<void> {
    try {
        this.engine.initialize(recipes);
    } catch (error) {
        console.error('Failed to initialize Engine:', error);
        throw new Error(
            `Engine initialization failed. Check shader compilation errors.`
        );
    }
    
    if (environmentHDR) {
        try {
            await this.engine.loadEnvironmentHDR(environmentHDR);
        } catch (error) {
            console.warn(`Failed to load HDR environment: ${environmentHDR}`, error);
            // Continue without environment
        }
    }
}
```

**Locations**:
- App.initialize
- App.renderProduction (already has try/catch, but could improve)
- TiledRenderer tile operations

**Estimated time**: 1 hour

### 3.2: Validate Extension Dependencies

Currently throws if dependency missing. Could be more helpful:

```typescript
use(extension: Extension): App {
    // Check dependencies
    const missingDeps = (extension.dependencies || []).filter(
        dep => !this.extensions.has(dep)
    );
    
    if (missingDeps.length > 0) {
        throw new Error(
            `Extension '${extension.name}' requires these extensions to be installed first:\n` +
            missingDeps.map(d => `  - ${d}`).join('\n') + '\n\n' +
            `Available extensions: ${Array.from(this.extensions.keys()).join(', ')}`
        );
    }
    
    // ... install
}
```

**Estimated time**: 30 minutes

### 3.3: Better Session Validation Messages

Current validation is basic. Could provide more context:

```typescript
private validateSession(session: any): void {
    const errors: string[] = [];
    
    if (!session.version) errors.push('missing version');
    if (!session.activeRecipe) errors.push('missing activeRecipe');
    if (!session.parameters) errors.push('missing parameters');
    
    if (errors.length > 0) {
        throw new Error(
            'Invalid session file:\n' +
            errors.map(e => `  - ${e}`).join('\n')
        );
    }
    
    const recipes = this.app.engine.getAvailableRecipes();
    if (!recipes.includes(session.activeRecipe)) {
        throw new Error(
            `Session requires recipe '${session.activeRecipe}' which is not available.\n` +
            `Available recipes: ${recipes.join(', ')}`
        );
    }
}
```

**Estimated time**: 30 minutes

---

## Phase 4: Testing (Optional)

**Goal**: Add basic tests for critical components.

### 4.1: Unit Tests for ParameterStore

```typescript
describe('ParameterStore', () => {
    test('set triggers onChange', () => {
        const store = new ParameterStore();
        const changes = [];
        store.onChange = (c) => changes.push(c);
        
        store.set('test', 42);
        
        expect(changes.length).toBe(1);
        expect(changes[0].changes[0].newValue).toBe(42);
    });
    
    test('batch triggers single onChange', () => {
        const store = new ParameterStore();
        const changeCount = [];
        store.onChange = () => changeCount.push(1);
        
        store.batch({ a: 1, b: 2, c: 3 });
        
        expect(changeCount.length).toBe(1);
    });
    
    test('lock prevents changes', () => {
        const store = new ParameterStore();
        const changes = [];
        store.onChange = (c) => changes.push(c);
        
        store.lock();
        store.set('test', 42);
        
        expect(changes.length).toBe(0);
    });
    
    // ... more tests
});
```

**Test coverage**:
- ParameterStore: set, batch, lock, restore, valuesEqual
- EventBus: on, off, once, emit, error isolation
- RenderCoordinator: mode transitions, reset logic
- SessionManager: capture, restore, validation

**Estimated time**: 4-6 hours

### 4.2: Integration Tests

Test the full rendering loop:

```typescript
describe('Rendering', () => {
    test('production mode completes', async () => {
        const app = createTestApp();
        await app.initialize([simpleRecipe]);
        
        await app.renderProduction(10);
        
        expect(app.engine.sampleCount).toBe(10);
        expect(app.parameterStore.isLocked()).toBe(false);
    });
    
    test('production mode can be stopped', async () => {
        const app = createTestApp();
        await app.initialize([simpleRecipe]);
        
        const promise = app.renderProduction(1000);
        
        // Stop after a few frames
        setTimeout(() => app.stop(), 100);
        
        await expect(promise).rejects.toThrow('RenderStopped');
    });
});
```

**Estimated time**: 2-3 hours

---

## Phase 5: Future Extensions (As Needed)

These don't require touching core code - just add new extension files when needed.

### Research Tools

**ParameterSweepExtension**:
```typescript
class ParameterSweepExtension implements Extension {
    async sweep(config: {
        parameter: string;
        values: any[];
        samplesPerValue: number;
        onProgress?: (index: number, value: any) => void;
    }): Promise<SweepResult[]> {
        const results = [];
        
        for (let i = 0; i < config.values.length; i++) {
            const value = config.values[i];
            
            this.app.parameterStore.set(config.parameter, value);
            await this.app.renderProduction(config.samplesPerValue);
            
            results.push({
                value,
                samples: config.samplesPerValue,
                radiance: this.app.engine.readRadiance(),
                rgb: this.app.engine.readRGB()
            });
            
            config.onProgress?.(i, value);
        }
        
        return results;
    }
}
```

**ComparisonExtension**:
```typescript
class ComparisonExtension implements Extension {
    async compare(recipes: string[], samples: number): Promise<ComparisonResult> {
        const results = [];
        
        for (const recipe of recipes) {
            this.app.switchRecipe(recipe);
            await this.app.renderProduction(samples);
            
            results.push({
                recipe,
                samples,
                radiance: this.app.engine.readRadiance(),
                rgb: this.app.engine.readRGB(),
                stats: this.app.engine.getStats()
            });
        }
        
        return { results, timestamp: Date.now() };
    }
}
```

### UI Extensions

**ParameterPanelExtension**:
- Create dat.GUI or lil-gui panel
- Auto-generate controls from parameter metadata
- Wire to ParameterStore

**RecipeSwitcherExtension**:
- Dropdown or button list for recipes
- Show current recipe
- Keyboard shortcuts (already handled by App)

### File Management

**AutoSaveExtension**:
```typescript
class AutoSaveExtension implements Extension {
    private interval?: number;
    
    install(app: App, bus: EventBus) {
        // Auto-save every 5 minutes
        this.interval = window.setInterval(() => {
            if (app.engine.sampleCount > 0) {
                app.sessionManager.quickSave();
            }
        }, 5 * 60 * 1000);
    }
    
    uninstall() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}
```

---

## Priority Summary

### Must Do (Before "Set and Forget")
1. ✅ Write comprehensive overview (this document + APP_IMPLEMENTATION.md)
2. ⏳ Add JSDoc to public methods (2-3 hours)
3. ⏳ Add implementation notes to tricky code (1 hour)

### Should Do (For Maintenance)
4. ⏳ Create types.ts with all interfaces (1 hour)
5. ⏳ Replace `any` with proper types (2 hours)
6. ⏳ Add try/catch around Engine calls (1 hour)

### Nice to Have (Optional)
7. ⏳ Unit tests for ParameterStore/EventBus (4-6 hours)
8. ⏳ Integration tests for rendering (2-3 hours)

### Future (As Research Needs Arise)
9. Parameter sweep extension
10. Comparison extension
11. Auto-save extension
12. Parameter panel UI

**Total "must do" time**: 3-4 hours
**Total "should do" time**: 4 hours
**Total "nice to have" time**: 6-9 hours

---

## Recommended Build Order

### Session 1: Documentation (3-4 hours)
1. Add JSDoc to App.ts public methods
2. Add JSDoc to ParameterStore.ts
3. Add JSDoc to RenderCoordinator.ts
4. Add JSDoc to SessionManager.ts
5. Add JSDoc to TiledRenderer.ts
6. Add implementation notes to tricky sections
7. Create EXAMPLES.md with usage patterns

**Deliverable**: Fully documented core classes

### Session 2: Type Safety (4 hours)
1. Expand types.ts with all interfaces
2. Add type parameters to generic methods
3. Replace `any` in method signatures
4. Add try/catch around Engine calls
5. Improve error messages

**Deliverable**: Type-safe, robust error handling

### Session 3: Testing (Optional, 6-9 hours)
1. Setup test framework (Jest or Vitest)
2. Write ParameterStore tests
3. Write EventBus tests
4. Write RenderCoordinator tests
5. Write integration tests

**Deliverable**: Test coverage for critical paths

---

## Maintenance Strategy

Once Phases 1-2 are complete, the App pillar should require minimal maintenance:

**When to modify App code**:
- Never, unless Engine API changes
- Never, for new features (use extensions instead)
- Only for bugs or critical design issues

**How to add features**:
1. Create new extension file
2. Implement Extension interface
3. Register as service if needed
4. Use EventBus for communication
5. Install via `app.use(new MyExtension())`

**How to debug issues**:
1. Check console for error messages
2. Check EventBus events (add debug listener)
3. Check parameter lock state
4. Check render mode and state
5. Check session file if state corruption suspected

**Code review checklist** (if modifications needed):
- [ ] Does it maintain architectural invariants?
- [ ] Does it preserve parameter locking during production?
- [ ] Does it emit appropriate EventBus events?
- [ ] Does it handle errors gracefully?
- [ ] Is it documented with JSDoc?
- [ ] Does it follow existing patterns?

---

## Success Criteria

The App pillar is "done" when:

- ✅ All core features work (already true)
- ⏳ All public methods have JSDoc comments
- ⏳ Tricky code has implementation notes
- ⏳ All types are proper (no `any` in public APIs)
- ⏳ Error messages are helpful
- ✅ Extension system is flexible and easy to use (already true)
- ✅ Sessions perfectly restore state (already true)
- ✅ Production rendering is robust (already true)

**When you can say "set and forget"**:
- You haven't opened app/ folder in 6 months
- All your work is in optics/ and objects/
- Extensions handle any new features you need
- The app just works, every time

---

## Notes for Future You

**If you need to modify App code**:
1. Read APP_IMPLEMENTATION.md first
2. Understand the architectural invariants
3. Write the modification
4. Test interactive and production modes
5. Test session save/restore
6. Update JSDoc if public API changes

**If you need a new feature**:
1. Don't modify App code
2. Create an extension instead
3. Use service registry to find other extensions
4. Use EventBus for loose coupling
5. Implement saveState/restoreState if stateful

**If something breaks**:
1. Check if it's actually an Engine issue
2. Check if it's a recipe/shader issue
3. Check parameter locking state
4. Check session file corruption
5. Only then check App code

**Remember**: The App pillar is plumbing. It should be boring, stable, and invisible. All the interesting work happens in Optics and Objects.
