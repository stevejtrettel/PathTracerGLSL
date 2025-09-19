Given the Engine's complexity, I'll create multiple implementation documents. Let's start with the main Engine class and Module Registry implementations:

# Engine Implementation - Core

## Main Engine Class

```typescript
class Engine {
  // Subsystems
  private registry: ModuleRegistry;
  private compiler: ShaderCompiler;
  private resources: ResourceManager;
  private uniforms: UniformBinder;
  private executor: RenderExecutor;
  
  // State
  private state: EngineState = { type: 'uninitialized' };
  private compiledPrograms = new Map<string, CompiledProgram>();
  private activeProgram: CompiledProgram | null = null;
  private viewport: Viewport;
  
  constructor(private gl: WebGL2RenderingContext) {
    // Initialize subsystems in order
    this.registry = new ModuleRegistry();
    this.resources = new ResourceManager(gl, { width: 1920, height: 1080 });
    this.executor = new RenderExecutor(gl, this.resources);
    this.compiler = new ShaderCompiler(gl, this.registry);
    this.uniforms = new UniformBinder(gl);
    
    // Set default viewport
    this.viewport = { x: 0, y: 0, width: 1920, height: 1080 };
    
    // Initialize
    this.init();
  }
  
  private init(): void {
    try {
      // 1. Register built-in modules
      this.registry.registerDefaults();
      
      // 2. Check capabilities
      const caps = this.resources.getCapabilities();
      const validation = this.resources.validateCapabilities();
      if (!validation.valid) {
        throw new Error(`GPU limitations: ${validation.errors.join(', ')}`);
      }
      
      // 3. Setup rendering
      this.executor.setupGeometry();
      this.executor.initialize();
      
      // 4. Transition to ready
      this.transition({ type: 'ready' });
      
    } catch (error) {
      this.transition({ 
        type: 'error', 
        error: error as Error, 
        recoverable: false 
      });
      throw error;
    }
  }
  
  // Eager compilation at startup
  initialize(recipes: Recipe[]): void {
    if (this.state.type !== 'ready') {
      throw new Error(`Cannot initialize in state: ${this.state.type}`);
    }
    
    for (const recipe of recipes) {
      const key = this.getRecipeKey(recipe);
      
      // Validate recipe compatibility
      const compat = this.registry.checkCompatibility(recipe);
      if (!compat.compatible) {
        throw new Error(`Recipe incompatible: ${compat.issues.join(', ')}`);
      }
      
      // Compile and cache
      const program = this.compiler.compile(recipe);
      this.compiledPrograms.set(key, program);
    }
  }
  
  // Select pre-compiled recipe
  selectRecipe(recipeName: string): void {
    if (this.state.type !== 'ready' && this.state.type !== 'running') {
      throw new Error(`Cannot select recipe in state: ${this.state.type}`);
    }
    
    const program = this.compiledPrograms.get(recipeName);
    if (!program) {
      throw new Error(`Recipe not compiled: ${recipeName}`);
    }
    
    // Activate program
    this.activeProgram = program;
    this.gl.useProgram(program.program);
    
    // Setup bindings
    this.uniforms.buildBindings(program, program.modules);
    
    // Setup film buffers
    const film = program.modules.find(m => m.id.kind === 'film')!;
    this.resources.setupFilmBuffers(film);
    
    // Transition to running
    this.transition({ type: 'running', program, frame: 0 });
  }
  
  // Render frame
  renderFrame(): void {
    if (this.state.type !== 'running') {
      throw new Error(`Cannot render in state: ${this.state.type}`);
    }
    
    // 1. Prepare resources
    this.resources.prepareFrame();
    
    // 2. Update uniforms
    const engineState: EngineStateInfo = {
      width: this.viewport.width,
      height: this.viewport.height,
      frameIndex: this.state.frame,
      sampleCount: this.state.frame,  // Simplified: frame = sample count
      time: performance.now() / 1000
    };
    this.uniforms.frameUpdate(engineState);
    
    // 3. Execute render
    this.executor.renderFrame({
      clear: this.state.frame === 0,
      swapBuffers: true,
      viewport: this.viewport
    });
    
    // 4. Finalize
    this.resources.finalizeFrame();
    
    // 5. Update state
    this.state = { ...this.state, frame: this.state.frame + 1 };
  }
  
  // Update parameters
  updateUniforms(changes: ParameterChanges): void {
    this.uniforms.queueUpdates(changes);
    
    if (this.shouldResetAccumulation(changes)) {
      this.clearAccumulation();
    }
  }
  
  clearAccumulation(): void {
    if (this.state.type === 'running') {
      this.resources.clearFilmBuffers();
      this.state = { ...this.state, frame: 0 };
    }
  }
  
  // Read pixels
  async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
    if (this.state.type !== 'running') {
      throw new Error(`Cannot read pixels in state: ${this.state.type}`);
    }
    return this.executor.readPixelsAsync(rect);
  }
  
  // Viewport
  setViewport(x: number, y: number, width: number, height: number): void {
    this.viewport = { x, y, width, height };
    this.executor.setViewport(x, y, width, height);
  }
  
  getResolution(): Resolution {
    return { width: this.viewport.width, height: this.viewport.height };
  }
  
  // Capabilities
  getCapabilities(): CapabilityReport {
    return this.resources.getCapabilities();
  }
  
  validateCapabilities(): ValidationResult {
    return this.resources.validateCapabilities();
  }
  
  // State management
  getState(): EngineState {
    return this.state;
  }
  
  isReady(): boolean {
    return this.state.type === 'ready' || this.state.type === 'running';
  }
  
  isRunning(): boolean {
    return this.state.type === 'running';
  }
  
  getFrame(): number | null {
    return this.state.type === 'running' ? this.state.frame : null;
  }
  
  // Uniform access
  getUniformMap(): UniformMap {
    return this.uniforms.getUniformMap();
  }
  
  // Private helpers
  private transition(newState: EngineState): void {
    if (!this.canTransition(this.state, newState)) {
      throw new Error(`Invalid transition: ${this.state.type} → ${newState.type}`);
    }
    console.log(`Engine: ${this.state.type} → ${newState.type}`);
    this.state = newState;
  }
  
  private canTransition(from: EngineState, to: EngineState): boolean {
    const transitions: Record<string, string[]> = {
      'uninitialized': ['ready', 'error'],
      'ready': ['running', 'error'],
      'running': ['ready', 'error'],
      'error': from.type === 'error' && from.recoverable ? ['ready'] : []
    };
    return transitions[from.type]?.includes(to.type) ?? false;
  }
  
  private getRecipeKey(recipe: Recipe): string {
    return [
      recipe.world.geometry.name,
      recipe.world.material.name,
      recipe.world.scene.name,
      recipe.world.lights.name,
      recipe.photography.camera.name,
      recipe.photography.estimator.name,
      recipe.photography.film.name,
      recipe.photography.developer.name
    ].join('_');
  }
  
  private shouldResetAccumulation(changes: ParameterChanges): boolean {
    const resetTriggers = ['camera.', 'material.', 'lights.', 'scene.'];
    const noResetParams = ['developer.', 'film.alpha', 'debug.'];
    
    for (const change of changes.changes) {
      const requiresReset = resetTriggers.some(t => change.path.startsWith(t));
      const exemptFromReset = noResetParams.some(e => change.path.startsWith(e));
      
      if (requiresReset && !exemptFromReset) {
        return true;
      }
    }
    return false;
  }
}
```

## Module Registry Implementation

```typescript
class ModuleRegistry {
  private modules = new Map<string, ModuleDescriptor>();
  private byKind = new Map<string, Set<ModuleDescriptor>>();
  private byProvides = new Map<string, Set<ModuleDescriptor>>();
  private byRequires = new Map<string, Set<ModuleDescriptor>>();
  
  // Registration
  register(module: ModuleDescriptor): void {
    const validation = this.validateModule(module);
    if (!validation.valid) {
      throw new RegistrationError(module, validation.errors);
    }
    
    const key = this.getKey(module.id.kind, module.id.name);
    if (this.modules.has(key)) {
      throw new DuplicateModuleError(module);
    }
    
    this.modules.set(key, module);
    this.indexModule(module);
  }
  
  registerBatch(modules: ModuleDescriptor[]): void {
    for (const module of modules) {
      this.register(module);
    }
  }
  
  registerDefaults(): void {
    // Geometry
    this.register(createEuclideanGeometry());
    
    // Materials
    this.register(createLambertMaterial());
    this.register(createDisneyMaterial());
    
    // Cameras
    this.register(createPinholeCamera());
    this.register(createThinLensCamera());
    
    // Estimators
    this.register(createPathTracerEstimator());
    this.register(createDebugEstimator());
    
    // Films
    this.register(createSimpleFilm());
    this.register(createVarianceFilm());
    
    // Developers
    this.register(createReinhardDeveloper());
    this.register(createACESDeveloper());
    
    // Scene
    this.register(createSDFScene());
    
    // Lights
    this.register(createPointLight());
    this.register(createHDRILight());
  }
  
  // Retrieval
  get(kind: string, name: string): ModuleDescriptor | null {
    return this.modules.get(this.getKey(kind, name)) || null;
  }
  
  has(kind: string, name: string): boolean {
    return this.modules.has(this.getKey(kind, name));
  }
  
  listByKind(kind: string): ModuleDescriptor[] {
    return Array.from(this.byKind.get(kind) || []);
  }
  
  // Dependency resolution
  findProvider(functionName: string): ModuleDescriptor | null {
    const providers = this.byProvides.get(functionName);
    return providers ? providers.values().next().value : null;
  }
  
  findAllProviders(functionName: string): ModuleDescriptor[] {
    return Array.from(this.byProvides.get(functionName) || []);
  }
  
  validateDependencies(modules: ModuleDescriptor[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Build provides map
    const provides = new Map<string, ModuleDescriptor[]>();
    for (const module of modules) {
      for (const fn of module.provides || []) {
        if (!provides.has(fn)) provides.set(fn, []);
        provides.get(fn)!.push(module);
      }
    }
    
    // Check requires satisfied
    for (const module of modules) {
      for (const required of module.requires || []) {
        const providers = provides.get(required) || [];
        if (providers.length === 0) {
          errors.push(`${module.id.name} requires '${required}' but not provided`);
        } else if (providers.length > 1) {
          warnings.push(`'${required}' provided by multiple: ${providers.map(p => p.id.name)}`);
        }
      }
    }
    
    // Check for cycles
    const cycles = this.findCycles(modules);
    for (const cycle of cycles) {
      errors.push(`Circular dependency: ${cycle.join(' → ')}`);
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  // Recipe compatibility
  checkCompatibility(recipe: Recipe): CompatibilityResult {
    const missing: Array<{kind: string; name: string}> = [];
    const issues: string[] = [];
    const suggestions: ModuleSuggestion[] = [];
    
    const moduleRefs = [
      recipe.world.geometry,
      recipe.world.material,
      recipe.world.scene,
      recipe.world.lights,
      recipe.photography.camera,
      recipe.photography.estimator,
      recipe.photography.film,
      recipe.photography.developer
    ];
    
    // Check existence
    for (const ref of moduleRefs) {
      if (!this.has(ref.kind, ref.name)) {
        missing.push({ kind: ref.kind, name: ref.name });
        
        const alternatives = this.findSimilar(ref.kind, ref.name);
        if (alternatives.length > 0) {
          suggestions.push({
            missing: { kind: ref.kind, name: ref.name },
            alternatives,
            reason: `Similar ${ref.kind} modules available`
          });
        }
      }
    }
    
    // Check dependencies
    const modules = moduleRefs
      .filter(ref => this.has(ref.kind, ref.name))
      .map(ref => this.get(ref.kind, ref.name)!);
    
    const depResult = this.validateDependencies(modules);
    if (!depResult.valid) {
      issues.push(...depResult.errors);
    }
    
    return {
      compatible: missing.length === 0 && issues.length === 0,
      missing,
      issues,
      suggestions
    };
  }
  
  resolveModules(recipe: Recipe): ModuleCollection {
    const resolved = {} as ModuleCollection;
    
    resolved.geometry = this.getRequired(recipe.world.geometry.kind, recipe.world.geometry.name);
    resolved.material = this.getRequired(recipe.world.material.kind, recipe.world.material.name);
    resolved.scene = this.getRequired(recipe.world.scene.kind, recipe.world.scene.name);
    resolved.lights = this.getRequired(recipe.world.lights.kind, recipe.world.lights.name);
    resolved.camera = this.getRequired(recipe.photography.camera.kind, recipe.photography.camera.name);
    resolved.estimator = this.getRequired(recipe.photography.estimator.kind, recipe.photography.estimator.name);
    resolved.film = this.getRequired(recipe.photography.film.kind, recipe.photography.film.name);
    resolved.developer = this.getRequired(recipe.photography.developer.kind, recipe.photography.developer.name);
    
    const validation = this.validateDependencies(Object.values(resolved));
    if (!validation.valid) {
      throw new Error(`Recipe has unsatisfied dependencies: ${validation.errors.join(', ')}`);
    }
    
    return resolved;
  }
  
  // Private helpers
  private getKey(kind: string, name: string): string {
    return `${kind}:${name}`;
  }
  
  private indexModule(module: ModuleDescriptor): void {
    // Index by kind
    if (!this.byKind.has(module.id.kind)) {
      this.byKind.set(module.id.kind, new Set());
    }
    this.byKind.get(module.id.kind)!.add(module);
    
    // Index by provides
    for (const fn of module.provides || []) {
      if (!this.byProvides.has(fn)) {
        this.byProvides.set(fn, new Set());
      }
      this.byProvides.get(fn)!.add(module);
    }
    
    // Index by requires
    for (const fn of module.requires || []) {
      if (!this.byRequires.has(fn)) {
        this.byRequires.set(fn, new Set());
      }
      this.byRequires.get(fn)!.add(module);
    }
  }
  
  private validateModule(module: ModuleDescriptor): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check required fields
    if (!module.id?.kind) errors.push("Module must have id.kind");
    if (!module.id?.name) errors.push("Module must have id.name");
    if (!module.id?.version) warnings.push("Module should have version");
    
    // Check required functions
    const requiredFunctions = this.getRequiredFunctions(module.id.kind);
    const providedFunctions = module.provides || [];
    
    for (const required of requiredFunctions) {
      if (!providedFunctions.includes(required)) {
        errors.push(`${module.id.kind} must provide '${required}'`);
      }
    }
    
    // Validate parameters
    for (const param of module.parameters || []) {
      if (!param.name || !param.type) {
        errors.push("Parameter missing name or type");
      }
      
      if (param.min !== undefined && param.max !== undefined && param.min >= param.max) {
        errors.push(`Parameter ${param.name}: min >= max`);
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  private getRequiredFunctions(kind: string): string[] {
    const requirements: Record<string, string[]> = {
      'geometry': ['geodesic', 'dot', 'parallel_transport', 'frame'],
      'material': ['evaluate', 'sample', 'pdf'],
      'scene': ['intersect', 'intersect_any', 'classify_point'],
      'lights': ['sample_light', 'eval_light', 'pdf_light'],
      'camera': ['generate_ray'],
      'estimator': ['estimate'],
      'film': ['accumulate'],
      'developer': ['develop']
    };
    return requirements[kind] || [];
  }
  
  private getRequired(kind: string, name: string): ModuleDescriptor {
    const module = this.get(kind, name);
    if (!module) {
      throw new ModuleNotFoundError(kind, name);
    }
    return module;
  }
  
  private findSimilar(kind: string, name: string): ModuleDescriptor[] {
    const allOfKind = this.listByKind(kind);
    const pattern = name.toLowerCase();
    return allOfKind.filter(m => {
      const mName = m.id.name.toLowerCase();
      return mName.includes(pattern) || pattern.includes(mName);
    });
  }
  
  private findCycles(modules: ModuleDescriptor[]): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const visit = (module: ModuleDescriptor, path: string[]): void => {
      const key = this.getKey(module.id.kind, module.id.name);
      
      if (recursionStack.has(key)) {
        const cycleStart = path.indexOf(key);
        cycles.push(path.slice(cycleStart));
        return;
      }
      
      if (visited.has(key)) return;
      
      visited.add(key);
      recursionStack.add(key);
      path.push(key);
      
      for (const required of module.requires || []) {
        const provider = modules.find(m => m.provides?.includes(required));
        if (provider) {
          visit(provider, [...path]);
        }
      }
      
      recursionStack.delete(key);
    };
    
    for (const module of modules) {
      visit(module, []);
    }
    
    return cycles;
  }
}
```

This shows the core Engine class and Module Registry with all required functions implemented. Should I continue with the ShaderCompiler, ResourceManager, UniformBinder, and RenderExecutor implementations?
