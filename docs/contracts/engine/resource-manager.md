                                     # Resource Manager Contract

## Purpose

The ResourceManager handles all GPU memory allocation including textures, buffers, and framebuffers. It validates GPU capabilities at startup, manages film buffer reuse through a manifest system, and provides fallbacks for limited devices.

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
  clearTexture(textureId: string): void;
  
  // Framebuffer management
  createFramebuffer(spec: FramebufferSpec): Framebuffer;
  deleteFramebuffer(framebufferId: string): void;
  getFramebuffer(framebufferId: string): Framebuffer | null;
  bindFramebuffer(framebufferId: string | null): void;  // null = screen
  checkFramebufferComplete(framebufferId: string): boolean;
  
  // Film buffer management
  setupFilmBuffers(film: ModuleDescriptor): FilmResources;
  getFilmResources(): FilmResources | null;
  swapFilmBuffers(): void;
  clearFilmBuffers(): void;
  getFilmManifest(): FilmManifest | null;
  
  // Resource lifecycle
  prepareFrame(): void;
  finalizeFrame(): void;
  
  // Memory monitoring
  getMemoryStats(): MemoryStats;
  getTextureCount(): number;
  getFramebufferCount(): number;
  canAllocate(bytes: number): boolean;
  
  // Cleanup
  cleanup(): void;
  dispose(): void;
}
```

## Initialization Contract

```typescript
class ResourceManager {
  private gl: WebGL2RenderingContext;
  private capabilities: CapabilityReport;
  private textures: Map<string, Texture>;
  private framebuffers: Map<string, Framebuffer>;
  private filmResources: FilmResources | null = null;
  private currentManifest: FilmManifest | null = null;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.textures = new Map();
    this.framebuffers = new Map();
    
    // Check capabilities immediately
    this.capabilities = this.detectCapabilities();
    
    // Log critical capabilities
    console.log('GPU Capabilities:');
    console.log(`  HDR: ${this.capabilities.floatRenderTargets ? 'Yes' : 'No'}`);
    console.log(`  Max texture size: ${this.capabilities.maxTextureSize}`);
    console.log(`  Texture units: ${this.capabilities.maxTextureUnits}`);
  }
  
  private detectCapabilities(): CapabilityReport {
    return {
      webgl2: true,  // Already checked by Engine
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
      drawBuffers: !!this.gl.getExtension('WEBGL_draw_buffers'),
      textureFloat: true,  // WebGL2 always has this
      colorBufferFloat: !!this.gl.getExtension('EXT_color_buffer_float'),
      anisotropicFiltering: !!this.gl.getExtension('EXT_texture_filter_anisotropic'),
      maxAnisotropy: this.gl.getExtension('EXT_texture_filter_anisotropic') ?
        this.gl.getParameter(0x84FF) : 0,  // MAX_TEXTURE_MAX_ANISOTROPY_EXT
        
      vendor: this.gl.getParameter(this.gl.VENDOR),
      renderer: this.gl.getParameter(this.gl.RENDERER),
      glVersion: this.gl.getParameter(this.gl.VERSION),
      shadingLanguageVersion: this.gl.getParameter(this.gl.SHADING_LANGUAGE_VERSION)
    };
  }
}
```

## Capability Validation Contract

```typescript
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
  if (this.capabilities.maxColorAttachments < 4) {
    warnings.push(`Only ${this.capabilities.maxColorAttachments} color attachments - some film modules may not work`);
  }
  
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

suggestFallback(capability: string): FallbackSuggestion | null {
  switch (capability) {
    case 'floatRenderTargets':
      return {
        capability,
        issue: 'HDR rendering not supported',
        suggestion: 'Use LDR film modules instead',
        alternativeModule: { kind: 'film', name: 'simple_ldr' }
      };
      
    case 'maxTextureUnits':
      return {
        capability,
        issue: 'Limited texture units',
        suggestion: 'Reduce material texture usage',
        reducedFeatures: ['normal_maps', 'roughness_maps']
      };
      
    default:
      return null;
  }
}
```

## Texture Management Contract

```typescript
interface FramebufferSpec {
  id: string;
  attachments: Array<{
    type: 'color' | 'depth' | 'stencil';
    index?: number;                   // For multiple color attachments
    texture?: Texture;
    format?: TextureFormat;           // If creating internal renderbuffer
  }>;
  width: number;
  height: number;
}

interface Framebuffer {
  id: string;
  glFramebuffer: WebGLFramebuffer;
  spec: FramebufferSpec;
  complete: boolean;
  attachedTextures: string[];         // Texture IDs
}

createTexture(spec: TextureSpec): Texture {
  // Check if we can allocate
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
    memoryBytes: bytes,
    lastUsedFrame: 0
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

private estimateTextureMemory(spec: TextureSpec): number {
  const bytesPerPixel = this.getBytesPerPixel(spec.format, spec.type);
  return spec.width * spec.height * bytesPerPixel;
}
```

## Film Buffer Management Contract

```typescript
setupFilmBuffers(film: ModuleDescriptor): FilmResources {
  const manifest = this.extractManifest(film);
  
  // Check if we can reuse existing buffers
  if (this.currentManifest && this.manifestsEqual(this.currentManifest, manifest)) {
    console.log('Reusing film buffers (manifest unchanged)');
    this.clearFilmBuffers();
    return this.filmResources!;
  }
  
  // Need new resources
  if (this.filmResources) {
    console.log('Manifest changed, reallocating film buffers');
    this.cleanupFilmResources();
  }
  
  // Validate we can handle requirements
  const validation = this.validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Cannot create film buffers: ${validation.errors.join(', ')}`);
  }
  
  // Create new resources
  this.filmResources = this.createFilmResources(manifest, film);
  this.currentManifest = manifest;
  
  return this.filmResources;
}

private extractManifest(film: ModuleDescriptor): FilmManifest {
  const textures = [];
  
  // Parse film resources
  for (const resource of film.resources?.textures || []) {
    textures.push({
      name: resource.name,
      format: this.parseFormat(resource.format),
      persistent: resource.persistent || false
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

private manifestsEqual(a: FilmManifest, b: FilmManifest): boolean {
  if (a.textures.length !== b.textures.length) return false;
  
  for (let i = 0; i < a.textures.length; i++) {
    const ta = a.textures[i];
    const tb = b.textures[i];
    
    if (ta.name !== tb.name || 
        ta.format !== tb.format || 
        ta.persistent !== tb.persistent) {
      return false;
    }
  }
  
  return true;
}

private validateManifest(manifest: FilmManifest): ValidationResult {
  const errors: string[] = [];
  
  // Check HDR requirements
  const needsHDR = manifest.textures.some(t => 
    t.format === TextureFormat.RGBA32F || 
    t.format === TextureFormat.RGB32F
  );
  
  if (needsHDR && !this.capabilities.floatRenderTargets) {
    errors.push('Film requires HDR but float render targets not available');
  }
  
  // Check attachment count
  const colorAttachments = manifest.textures.filter(t => t.persistent).length;
  if (colorAttachments > this.capabilities.maxColorAttachments) {
    errors.push(
      `Film needs ${colorAttachments} color attachments ` +
      `but GPU only supports ${this.capabilities.maxColorAttachments}`
    );
  }
  
  return { valid: errors.length === 0, errors };
}
```

## Film Resource Creation Contract

```typescript
private createFilmResources(manifest: FilmManifest, film: ModuleDescriptor): FilmResources {
  const resources: FilmResources = {
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
      // Need double buffering for persistent textures
      const currentTex = this.createTexture({
        id: `film_${texSpec.name}_current`,
        width,
        height,
        format: texSpec.format,
        type: this.getTypeForFormat(texSpec.format),
        usage: 'film',
        persistent: true
      });
      
      const previousTex = this.createTexture({
        id: `film_${texSpec.name}_previous`,
        width,
        height,
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
        id: `film_${texSpec.name}`,
        width,
        height,
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
      id: 'film_current',
      attachments: this.buildAttachments(resources, 'current'),
      width,
      height
    });
    
    resources.framebuffers.previous = this.createFramebuffer({
      id: 'film_previous',
      attachments: this.buildAttachments(resources, 'previous'),
      width,
      height
    });
  } else {
    // Single framebuffer for non-persistent
    resources.framebuffers.current = this.createFramebuffer({
      id: 'film_single',
      attachments: this.buildAttachments(resources, null),
      width,
      height
    });
    resources.framebuffers.previous = resources.framebuffers.current;
  }
  
  return resources;
}

swapFilmBuffers(): void {
  if (!this.filmResources || !this.filmResources.needsSwap) return;
  
  // Swap current and previous
  [this.filmResources.framebuffers.current,
   this.filmResources.framebuffers.previous] = 
  [this.filmResources.framebuffers.previous,
   this.filmResources.framebuffers.current];
}

clearFilmBuffers(): void {
  if (!this.filmResources) return;
  
  const { clearColor } = this.currentManifest!;
  
  // Clear current
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, 
    this.filmResources.framebuffers.current.glFramebuffer);
  this.gl.clearColor(...clearColor);
  this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  
  // Clear previous if different
  if (this.filmResources.needsSwap) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, 
      this.filmResources.framebuffers.previous.glFramebuffer);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
}
```

## Frame Lifecycle Contract

```typescript
prepareFrame(): void {
  if (!this.filmResources) return;
  
  // Bind previous frame textures for reading
  let unit = TEXTURE_UNITS.FILM_START;
  
  for (const [name, texture] of this.filmResources.textures) {
    if (name.includes('previous')) {
      this.bindTexture(texture.id, unit++);
    }
  }
  
  // Set current framebuffer as render target
  this.bindFramebuffer(this.filmResources.framebuffers.current.id);
}

finalizeFrame(): void {
  if (!this.filmResources) return;
  
  // Swap buffers for next frame
  if (this.filmResources.needsSwap) {
    this.swapFilmBuffers();
  }
  
  // Update usage timestamps
  const frame = performance.now();
  for (const texture of this.textures.values()) {
    if (texture.boundUnit !== undefined) {
      texture.lastUsedFrame = frame;
    }
  }
}
```

## Memory Management Contract

```typescript
getMemoryStats(): MemoryStats {
  let textureMemory = 0;
  let framebufferMemory = 0;
  let largestTexture = '';
  let largestSize = 0;
  
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
      if (tex) {
        framebufferMemory += tex.memoryBytes;
      }
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
  const estimatedLimit = 512 * 1024 * 1024;  // 512MB conservative estimate
  
  return (stats.totalMemory + bytes) < estimatedLimit;
}
```

## Minimal Working Example

```typescript
// Create resource manager
const gl = canvas.getContext('webgl2')!;
const resources = new ResourceManager(gl);

// Check capabilities
const caps = resources.getCapabilities();
const validation = resources.validateCapabilities();

if (!validation.valid) {
  console.error('GPU limitations:', validation.errors);
  
  // Get fallback suggestions
  if (!caps.floatRenderTargets) {
    const fallback = resources.suggestFallback('floatRenderTargets');
    console.log('Suggestion:', fallback?.suggestion);
  }
}

// Setup film buffers from module
const varianceFilm: ModuleDescriptor = {
  id: { kind: 'film', name: 'variance', version: '1.0.0' },
  fragment: {
    functions: '...',
    provides: ['accumulate']
  },
  resources: {
    textures: [
      { name: 'radiance', type: 'texture2D', format: 'rgba32f', persistent: true },
      { name: 'variance', type: 'texture2D', format: 'rgba32f', persistent: true },
      { name: 'samples', type: 'texture2D', format: 'r32i', persistent: true }
    ]
  }
};

const filmResources = resources.setupFilmBuffers(varianceFilm);

// Each frame
resources.prepareFrame();
// ... render ...
resources.finalizeFrame();

// Check memory usage
const stats = resources.getMemoryStats();
console.log(`GPU memory: ${(stats.totalMemory / 1024 / 1024).toFixed(2)}MB`);

// Switch to different film (may reuse buffers)
const simpleFilm: ModuleDescriptor = {
  id: { kind: 'film', name: 'simple', version: '1.0.0' },
  resources: {
    textures: [
      { name: 'radiance', type: 'texture2D', format: 'rgba32f', persistent: true }
    ]
  }
};

// This will reuse buffers if manifest is compatible
const newResources = resources.setupFilmBuffers(simpleFilm);

// Cleanup
resources.dispose();
```

## Invariants

1. **Capabilities checked** at construction
2. **Manifests compared** before reallocation
3. **Texture units 0-7** reserved for film
4. **Double buffering** for persistent textures
5. **Framebuffers complete** before use
6. **Memory tracked** accurately
7. **Resources cleaned** on dispose

## Error Handling

The ResourceManager MUST handle these error conditions:

| Error | Response |
|-------|----------|
| No HDR support | Provide LDR fallback suggestion |
| Texture creation failure | Throw ResourceAllocationError |
| Framebuffer incomplete | Throw with attachment details |
| Out of memory | Return false from canAllocate |
| Invalid format | Throw with format info |
| Missing texture | Throw when binding |

## Performance Requirements

- Capability check: Once at startup
- Manifest comparison: O(n) where n = texture count
- Texture creation: < 10ms for 1920x1080 RGBA32F
- Buffer swap: O(1) pointer swap
- Memory calculation: O(n) where n = texture count
