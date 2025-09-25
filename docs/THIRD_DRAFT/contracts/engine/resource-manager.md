# Resource Manager Contract (Simplified)

## Purpose

The ResourceManager handles all GPU memory allocation including textures, buffers, and framebuffers. It validates GPU capabilities at startup and manages per-recipe film buffers to preserve accumulation when switching between recipes.

## Required Interface
```typescript
interface ResourceManager {
    // Capability checking
    getCapabilities(): CapabilityReport;
    validateCapabilities(): ValidationResult;
    hasCapability(capability: string): boolean;
    suggestFallback(capability: string): FallbackSuggestion | null;

    // Texture management
    createTexture(spec: TextureSpec): Texture;
    deleteTexture(textureId: string): void;
    getTexture(textureId: string): Texture | null;
    bindTexture(textureId: string, unit: number): void;
    unbindTexture(unit: number): void;

    // Framebuffer management
    createFramebuffer(spec: FramebufferSpec): Framebuffer;
    deleteFramebuffer(framebufferId: string): void;
    getFramebuffer(framebufferId: string): Framebuffer | null;
    bindFramebuffer(framebufferId: string | null): void;  // null = screen

    // Per-recipe film buffer management
    setupFilmBuffers(recipeId: string, film: ModuleDescriptor): FilmResources;
    getFilmResources(recipeId: string): FilmResources | null;
    setActiveRecipe(recipeId: string): void;
    clearFilmBuffers(recipeId?: string): void;  // Current recipe if not specified

    // Snapshot management (for accumulating recipes only)
    captureSnapshot(recipeId: string, pixels: Float32Array, frame: number): void;
    getSnapshot(recipeId: string): { pixels: Float32Array; frame: number; timestamp: number } | null;
    hasSnapshot(recipeId: string): boolean;

    // Frame lifecycle
    prepareFrame(): void;
    finalizeFrame(): void;
    swapFilmBuffers(): void;

    // Memory monitoring
    getMemoryStats(): MemoryStats;
    canAllocate(bytes: number): boolean;

    //resize
    resizeFilmBuffers(recipeId: string, width: number, height: number): void;

    // Cleanup
    cleanup(): void;
    dispose(): void;
}
```

## Architecture with Per-Recipe Buffers

```typescript
class ResourceManager {
    private gl: WebGL2RenderingContext;
    private capabilities: CapabilityReport;

    // General resources
    private textures: Map<string, Texture>;
    private framebuffers: Map<string, Framebuffer>;

    // Per-recipe film resources
    private filmResourcesMap: Map<string, FilmResources>;
    private activeRecipeId: string | null = null;

    // Snapshots for recovery (accumulating recipes only)
    private snapshots: Map<string, {
        pixels: Float32Array;
        frame: number;
        timestamp: number;
    }> = new Map();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.textures = new Map();
        this.framebuffers = new Map();
        this.filmResourcesMap = new Map();
        this.snapshots = new Map();

        // Check capabilities immediately
        this.capabilities = this.detectCapabilities();
        this.logCapabilities();
    }
}
```


## Snapshot Management

```typescript
// Helper to detect accumulating recipes
private isAccumulatingRecipe(recipeId: string): boolean {
const resources = this.filmResourcesMap.get(recipeId);
if (!resources) return false;

// Accumulating films have persistent textures that need swapping
return resources.manifest.textures.some(t => t.persistent);
}

// Capture snapshot for accumulating recipes only
captureSnapshot(recipeId: string, pixels: Float32Array, frame: number): void {
// Only capture for accumulating recipes
if (!this.isAccumulatingRecipe(recipeId)) {
return; // Silent skip for non-accumulating recipes
}

// Replace any existing snapshot for this recipe (only keep most recent)
const oldSnapshot = this.snapshots.get(recipeId);
if (oldSnapshot) {
console.log(`Replacing snapshot from frame ${oldSnapshot.frame} with frame ${frame}`);
}

this.snapshots.set(recipeId, {
pixels: new Float32Array(pixels), // Copy to avoid reference issues
frame,
timestamp: Date.now()
});

const sizeMB = (pixels.length * 4) / (1024 * 1024);
console.log(`Snapshot for accumulating recipe '${recipeId}': ${sizeMB.toFixed(1)}MB at frame ${frame}`);
}

getSnapshot(recipeId: string): { pixels: Float32Array; frame: number; timestamp: number } | null {
return this.snapshots.get(recipeId) || null;
}

hasSnapshot(recipeId: string): boolean {
return this.snapshots.has(recipeId);
}

private clearSnapshots(): void {
this.snapshots.clear();
}
```

## Resizing

```typescript
resizeFilmBuffers(recipeId: string, width: number, height: number): void {
  const resources = this.filmResourcesMap.get(recipeId);
  if (!resources) {
    throw new Error(`No film resources for recipe: ${recipeId}`);
  }
  
  // Delete old textures and framebuffers
  this.cleanupRecipeResources(recipeId);
  
  // Recreate at new size
  const filmModule = /* need to store or pass this */;
  const newResources = this.createFilmResources(recipeId, resources.manifest, filmModule);
  this.filmResourcesMap.set(recipeId, newResources);
  
  console.log(`Resized film buffers for ${recipeId} to ${width}x${height}`);
}
```

## Capability Detection Contract

```typescript
private detectCapabilities(): CapabilityReport {
  return {
    webgl2: true,
    floatRenderTargets: !!this.gl.getExtension('EXT_color_buffer_float'),
    floatLinearFiltering: !!this.gl.getExtension('OES_texture_float_linear'),
    
    maxTextureSize: this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE),
    maxTextureUnits: this.gl.getParameter(this.gl.MAX_TEXTURE_IMAGE_UNITS),
    maxColorAttachments: this.gl.getParameter(this.gl.MAX_COLOR_ATTACHMENTS),
    maxViewportDims: this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS),
    maxRenderBufferSize: this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE),
    maxVertexAttributes: this.gl.getParameter(this.gl.MAX_VERTEX_ATTRIBS),
    maxFragmentUniforms: this.gl.getParameter(this.gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    
    depthTexture: !!this.gl.getExtension('WEBGL_depth_texture'),
    anisotropicFiltering: !!this.gl.getExtension('EXT_texture_filter_anisotropic'),
    maxAnisotropy: this.gl.getExtension('EXT_texture_filter_anisotropic') ?
      this.gl.getParameter(0x84FF) : 0,
    
    vendor: this.gl.getParameter(this.gl.VENDOR),
    renderer: this.gl.getParameter(this.gl.RENDERER),
    glVersion: this.gl.getParameter(this.gl.VERSION),
    shadingLanguageVersion: this.gl.getParameter(this.gl.SHADING_LANGUAGE_VERSION)
  };
}

validateCapabilities(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  // Critical requirements
  if (!this.capabilities.floatRenderTargets) {
    errors.push('Float render targets not supported - HDR rendering unavailable');
    suggestions.push('Use LDR film modules (simple_ldr, accumulate_ldr)');
  }
  
  // Minimum requirements
  if (this.capabilities.maxTextureUnits < 8) {
    errors.push(`Only ${this.capabilities.maxTextureUnits} texture units (minimum 8 required)`);
  }
  
  if (this.capabilities.maxTextureSize < 2048) {
    errors.push(`Maximum texture size ${this.capabilities.maxTextureSize} (minimum 2048 required)`);
  }
  
  // Warnings for limited features
  if (!this.capabilities.floatLinearFiltering) {
    warnings.push('Float texture filtering not available - may see banding in HDR');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestions
  };
}
```

## Per-Recipe Film Buffer Management

The key feature for accumulation preservation:

```typescript
setupFilmBuffers(recipeId: string, film: ModuleDescriptor): FilmResources {
  // Check if this recipe already has buffers
  let resources = this.filmResourcesMap.get(recipeId);
  
  if (resources) {
    // Recipe has existing buffers - check if manifest changed
    const newManifest = this.extractManifest(film);
    
    if (this.manifestsEqual(resources.manifest, newManifest)) {
      // Reuse existing buffers - preserves accumulation!
      console.log(`Reusing film buffers for recipe '${recipeId}'`);
      return resources;
    }
    
    // Manifest changed - need to reallocate
    console.log(`Film manifest changed for recipe '${recipeId}', reallocating`);
    this.cleanupRecipeResources(recipeId);
  }
  
  // Create new resources for this recipe
  const manifest = this.extractManifest(film);
  resources = this.createFilmResources(recipeId, manifest, film);
  this.filmResourcesMap.set(recipeId, resources);
  
  console.log(`Created film buffers for recipe '${recipeId}'`);
  return resources;
}

setActiveRecipe(recipeId: string): void {
  if (!this.filmResourcesMap.has(recipeId)) {
    throw new Error(`No film resources for recipe: ${recipeId}`);
  }
  
  this.activeRecipeId = recipeId;
  console.log(`Active recipe: ${recipeId}`);
}

getFilmResources(recipeId: string): FilmResources | null {
  return this.filmResourcesMap.get(recipeId) || null;
}

clearFilmBuffers(recipeId?: string): void {
  const targetId = recipeId || this.activeRecipeId;
  if (!targetId) return;
  
  const resources = this.filmResourcesMap.get(targetId);
  if (!resources) return;
  
  const { clearColor } = resources.manifest;
  
  // Clear current framebuffer
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, resources.framebuffers.current.glFramebuffer);
  this.gl.clearColor(...clearColor);
  this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  
  // Clear previous if double-buffered
  if (resources.needsSwap && resources.framebuffers.previous !== resources.framebuffers.current) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, resources.framebuffers.previous.glFramebuffer);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
  
  console.log(`Cleared film buffers for recipe '${targetId}'`);
}

// Robust manifest comparison
private manifestsEqual(a: FilmManifest, b: FilmManifest): boolean {
  // Check texture count
  if (a.textures.length !== b.textures.length) {
    return false;
  }
  
  // Check each texture specification
  for (let i = 0; i < a.textures.length; i++) {
    const at = a.textures[i];
    const bt = b.textures[i];
    
    // Compare properties (order-independent for robustness)
    if (at.name !== bt.name || 
        at.format !== bt.format || 
        at.persistent !== bt.persistent) {
      return false;
    }
  }
  
  // Check clear color
  if (a.clearColor.length !== b.clearColor.length) {
    return false;
  }
  
  for (let i = 0; i < a.clearColor.length; i++) {
    if (Math.abs(a.clearColor[i] - b.clearColor[i]) > 0.0001) {
      return false;
    }
  }
  
  return true;
}
```

## Film Resource Creation

```typescript
private createFilmResources(
  recipeId: string, 
  manifest: FilmManifest, 
  film: ModuleDescriptor
): FilmResources {
  const resources: FilmResources = {
    recipeId,
    textures: new Map(),
    framebuffers: {
      current: null!,
      previous: null!
    },
    manifest,
    needsSwap: manifest.textures.some(t => t.persistent)
  };
  
  const viewport = this.gl.getParameter(this.gl.VIEWPORT);
  const width = viewport[2];
  const height = viewport[3];
  
  // Create textures
  for (const texSpec of manifest.textures) {
    if (texSpec.persistent) {
      // Double buffering for persistent textures
      const currentTex = this.createTexture({
        id: `film_${recipeId}_${texSpec.name}_current`,
        width, height,
        format: texSpec.format,
        type: this.getTypeForFormat(texSpec.format),
        usage: 'film',
        persistent: true
      });
      
      const previousTex = this.createTexture({
        id: `film_${recipeId}_${texSpec.name}_previous`,
        width, height,
        format: texSpec.format,
        type: this.getTypeForFormat(texSpec.format),
        usage: 'film',
        persistent: true
      });
      
      resources.textures.set(`${texSpec.name}_current`, currentTex);
      resources.textures.set(`${texSpec.name}_previous`, previousTex);
    } else {
      // Single buffer for non-persistent
      const tex = this.createTexture({
        id: `film_${recipeId}_${texSpec.name}`,
        width, height,
        format: texSpec.format,
        type: this.getTypeForFormat(texSpec.format),
        usage: 'film',
        persistent: false
      });
      resources.textures.set(texSpec.name, tex);
    }
  }
  
  // Create framebuffers
  if (resources.needsSwap) {
    resources.framebuffers.current = this.createFramebuffer({
      id: `film_${recipeId}_current`,
      attachments: this.buildAttachments(resources, 'current'),
      width, height
    });
    
    resources.framebuffers.previous = this.createFramebuffer({
      id: `film_${recipeId}_previous`,
      attachments: this.buildAttachments(resources, 'previous'),
      width, height
    });
  } else {
    resources.framebuffers.current = this.createFramebuffer({
      id: `film_${recipeId}_single`,
      attachments: this.buildAttachments(resources, null),
      width, height
    });
    resources.framebuffers.previous = resources.framebuffers.current;
  }
  
  return resources;
}

private extractManifest(film: ModuleDescriptor): FilmManifest {
  const textures = [];
  
  for (const resource of film.resources?.textures || []) {
    textures.push({
      name: resource.name,
      format: this.parseFormat(resource.format),
      persistent: resource.persistent !== false  // Default true
    });
  }
  
  // Default if no resources specified
  if (textures.length === 0) {
    textures.push({
      name: 'radiance',
      format: TextureFormat.RGBA32F,
      persistent: true
    });
  }
  
  return {
    textures,
    clearColor: [0, 0, 0, 0]
  };
}
```

## Frame Lifecycle Contract

```typescript
prepareFrame(): void {
  if (!this.activeRecipeId) {
    throw new Error('No active recipe - call setActiveRecipe() first');
  }
  
  const resources = this.filmResourcesMap.get(this.activeRecipeId);
  if (!resources) {
    throw new Error(`No film resources for active recipe: ${this.activeRecipeId}`);
  }
  
  // Bind previous frame textures for reading
  let unit = TEXTURE_UNITS.FILM_START;
  
  for (const [name, texture] of resources.textures) {
    if (name.includes('previous')) {
      this.bindTexture(texture.id, unit++);
    }
  }
  
  // Set current framebuffer as render target
  this.bindFramebuffer(resources.framebuffers.current.id);
}

finalizeFrame(): void {
  if (!this.activeRecipeId) return;
  
  const resources = this.filmResourcesMap.get(this.activeRecipeId);
  if (!resources) return;
  
  // Swap buffers for next frame if needed
  if (resources.needsSwap) {
    this.swapFilmBuffers();
  }
}

swapFilmBuffers(): void {
  if (!this.activeRecipeId) return;
  
  const resources = this.filmResourcesMap.get(this.activeRecipeId);
  if (!resources || !resources.needsSwap) return;
  
  // Swap current and previous
  [resources.framebuffers.current, resources.framebuffers.previous] = 
  [resources.framebuffers.previous, resources.framebuffers.current];
}
```

## Texture Management

```typescript
createTexture(spec: TextureSpec): Texture {
  const bytes = this.estimateTextureMemory(spec);
  if (!this.canAllocate(bytes)) {
    throw new ResourceAllocationError('texture', bytes);
  }
  
  const glTexture = this.gl.createTexture();
  if (!glTexture) {
    throw new Error('Failed to create texture');
  }
  
  this.gl.bindTexture(this.gl.TEXTURE_2D, glTexture);
  
  // Set parameters
  this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, 
    spec.filter || this.gl.NEAREST);
  this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, 
    spec.filter || this.gl.NEAREST);
  this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, 
    spec.wrap || this.gl.CLAMP_TO_EDGE);
  this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, 
    spec.wrap || this.gl.CLAMP_TO_EDGE);
  
  // Allocate storage
  const format = this.getGLFormat(spec.format);
  const type = this.getGLType(spec.type);
  const internalFormat = this.getInternalFormat(spec.format);
  
  this.gl.texImage2D(
    this.gl.TEXTURE_2D, 0, internalFormat,
    spec.width, spec.height, 0,
    format, type, spec.data || null
  );
  
  const texture: Texture = {
    id: spec.id,
    glTexture,
    spec,
    memoryBytes: bytes
  };
  
  this.textures.set(spec.id, texture);
  return texture;
}

bindTexture(textureId: string, unit: number): void {
  const texture = this.textures.get(textureId);
  if (!texture) {
    throw new Error(`Texture not found: ${textureId}`);
  }
  
  this.gl.activeTexture(this.gl.TEXTURE0 + unit);
  this.gl.bindTexture(this.gl.TEXTURE_2D, texture.glTexture);
  texture.boundUnit = unit;
}
```

## Memory Management

```typescript
getMemoryStats(): MemoryStats {
  let textureMemory = 0;
  let framebufferMemory = 0;
  let largestTexture = '';
  let largestSize = 0;
  
  // Sum all texture memory
  for (const texture of this.textures.values()) {
    textureMemory += texture.memoryBytes;
    if (texture.memoryBytes > largestSize) {
      largestSize = texture.memoryBytes;
      largestTexture = texture.id;
    }
  }
  
  // Estimate framebuffer memory
  for (const fb of this.framebuffers.values()) {
    for (const texId of fb.attachedTextures) {
      const tex = this.textures.get(texId);
      if (tex) framebufferMemory += tex.memoryBytes;
    }
  }
  
  return {
    textureMemory,
    framebufferMemory,
    totalMemory: textureMemory + framebufferMemory,
    textureCount: this.textures.size,
    framebufferCount: this.framebuffers.size,
    largestTexture,
    lastCleanup: 0
  };
}

canAllocate(bytes: number): boolean {
  const stats = this.getMemoryStats();
  const estimatedLimit = 512 * 1024 * 1024;  // 512MB conservative
  return (stats.totalMemory + bytes) < estimatedLimit;
}

private estimateTextureMemory(spec: TextureSpec): number {
  let bytesPerPixel = 4;  // Default RGBA8
  
  switch (spec.format) {
    case TextureFormat.RGBA32F:
    case TextureFormat.RGB32F:
      bytesPerPixel = 16;  // 4 floats × 4 bytes
      break;
    case TextureFormat.RGBA16F:
    case TextureFormat.RGB16F:
      bytesPerPixel = 8;   // 4 half-floats × 2 bytes
      break;
    case TextureFormat.R32F:
      bytesPerPixel = 4;   // 1 float × 4 bytes
      break;
    case TextureFormat.RG32F:
      bytesPerPixel = 8;   // 2 floats × 4 bytes
      break;
  }
  
  return spec.width * spec.height * bytesPerPixel;
}
```

## Context Loss Handling

```typescript
// Called from Engine when WebGL context is lost
// Called from Engine when WebGL context is lost
handleContextLoss(): void {
    console.warn('WebGL context lost - all GPU resources invalidated');

    // Clear references but don't try to delete WebGL resources
    // (they're already gone)
    this.textures.clear();
    this.framebuffers.clear();

    // Note: Film resources will need to be recreated when context is restored
    // IMPORTANT: All accumulation will be lost!
    for (const recipeId of this.filmResourcesMap.keys()) {
    console.warn(`Recipe '${recipeId}' accumulation will be lost on context restore`);
}

// Snapshots remain in system memory and could be shown as reference
if (this.snapshots.size > 0) {
    console.log(`${this.snapshots.size} snapshot(s) available as reference after context loss:`);
    for (const [recipeId, snapshot] of this.snapshots) {
        const age = Date.now() - snapshot.timestamp;
        console.log(`  - ${recipeId}: frame ${snapshot.frame} (${Math.floor(age / 1000)}s ago)`);
    }
}

this.filmResourcesMap.clear();
this.activeRecipeId = null;
}

// Called from Engine after context is restored
handleContextRestore(): void {
  console.log('ResourceManager ready for resource recreation');
  // Resources will be recreated as recipes are re-selected
  // Note: Previous accumulation cannot be recovered
}
```

## Cleanup Contract

```typescript
private cleanupRecipeResources(recipeId: string): void {
  const resources = this.filmResourcesMap.get(recipeId);
  if (!resources) return;
  
  // Delete textures
  for (const texture of resources.textures.values()) {
    this.deleteTexture(texture.id);
  }
  
  // Delete framebuffers
  if (resources.framebuffers.current) {
    this.deleteFramebuffer(resources.framebuffers.current.id);
  }
  if (resources.framebuffers.previous && 
      resources.framebuffers.previous !== resources.framebuffers.current) {
    this.deleteFramebuffer(resources.framebuffers.previous.id);
  }
  
  this.filmResourcesMap.delete(recipeId);
}

dispose(): void {
    // Clean up all film resources
    for (const recipeId of this.filmResourcesMap.keys()) {
    this.cleanupRecipeResources(recipeId);
}

// Clean up remaining textures
for (const texture of this.textures.values()) {
    this.gl.deleteTexture(texture.glTexture);
}

// Clean up framebuffers
for (const fb of this.framebuffers.values()) {
    this.gl.deleteFramebuffer(fb.glFramebuffer);
}

// Clear all maps including snapshots
this.textures.clear();
this.framebuffers.clear();
this.filmResourcesMap.clear();
this.snapshots.clear();
this.activeRecipeId = null;
}
```

## Minimal Working Example

```typescript
// Create resource manager
const gl = canvas.getContext('webgl2')!;
const resources = new ResourceManager(gl);

// Check capabilities
const validation = resources.validateCapabilities();
if (!validation.valid) {
  console.error('GPU limitations:', validation.errors);
}

// Define film modules for different recipes
const pathTracerFilm: ModuleDescriptor = {
    id: { kind: 'film', name: 'variance', version: '1.0.0' },
    fragment: {
        functions: `
      Radiance film_accumulate(Spectrum radiance, vec2 pixel) {
        // Implementation - uses KIND prefix
      }
    `
    },
  resources: {
    textures: [
      { name: 'radiance', format: 'rgba32f', persistent: true },
      { name: 'variance', format: 'rgba32f', persistent: true }
    ]
  }
};

const debugFilm: ModuleDescriptor = {
  id: { kind: 'film', name: 'simple', version: '1.0.0' },
  fragment: { 
    functions: `
      Radiance simple_accumulate(Spectrum radiance, vec2 pixel) {
        // Implementation
      }
    ` 
  },
  resources: {
    textures: [
      { name: 'color', format: 'rgba32f', persistent: false }
    ]
  }
};

// Setup film buffers for each recipe
const pathTracerResources = resources.setupFilmBuffers('pathtracer', pathTracerFilm);
const debugResources = resources.setupFilmBuffers('debug', debugFilm);

// Start with path tracer
resources.setActiveRecipe('pathtracer');

// Render some frames (accumulating)
for (let i = 0; i < 100; i++) {
  resources.prepareFrame();
  // ... render ...
  resources.finalizeFrame();
}

// Switch to debug view (different buffers)
resources.setActiveRecipe('debug');
resources.prepareFrame();
// ... render debug ...
resources.finalizeFrame();

// Switch back to path tracer (continues accumulation!)
resources.setActiveRecipe('pathtracer');
resources.prepareFrame();
// ... continues from frame 100 ...
resources.finalizeFrame();

// Clear accumulation for current recipe
resources.clearFilmBuffers();

// Handle context loss (if it happens)
gl.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  resources.handleContextLoss();
  // WARNING: All accumulation will be lost!
});

gl.canvas.addEventListener('webglcontextrestored', () => {
  resources.handleContextRestore();
  // Must recreate resources and restart accumulation
});

// Check memory usage
const stats = resources.getMemoryStats();
console.log(`GPU memory: ${(stats.totalMemory / 1024 / 1024).toFixed(2)}MB`);

// Cleanup
resources.dispose();
```

## Invariants

1. **Each recipe has own buffers** - No sharing between recipes
2. **Active recipe required** - Must call setActiveRecipe() before frames
3. **Manifest comparison robust** - Property-by-property comparison, not JSON
4. **Texture units 0-7** reserved for film textures
5. **Double buffering** for persistent textures only
6. **Resources tracked** per recipe for proper cleanup
7. **Context loss handled** - But accumulation cannot be recovered

## Error Handling

| Error | Response |
|-------|----------|
| No HDR support | Provide LDR fallback suggestion |
| No active recipe | Throw when prepareFrame() called |
| Recipe not found | Throw when setting active |
| Texture creation failure | Throw ResourceAllocationError |
| Out of memory | Return false from canAllocate() |
| Missing texture | Throw when binding |
| Context lost | Clear all references, warn about accumulation loss |
| Context restored | Ready for recreation, accumulation lost |

## Performance Requirements

- Capability check: Once at startup
- Recipe switching: O(1) - just change pointer
- Buffer reuse check: O(n) where n = texture count (typically 2-3)
- Texture creation: < 10ms for 1920x1080 RGBA32F
- Frame preparation: O(n) where n = film textures (typically 2-3)
- Memory calculation: O(t) where t = total textures
- Manifest comparison: O(textures) - typically 1-3 textures
