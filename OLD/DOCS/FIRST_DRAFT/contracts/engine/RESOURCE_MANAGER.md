# Resource Manager Contract

The ResourceManager handles all GPU memory allocation including textures, buffers, and framebuffers with capability checking and resource reuse.

## Core Interface

```typescript
interface ResourceManager {
  // Capability checking
  getCapabilities(): CapabilityReport;
  validateCapabilities(): ValidationResult;
  
  // Texture management
  createTexture(spec: TextureSpec): WebGLTexture;
  deleteTexture(id: string): void;
  bindTexture(id: string, unit: number): void;
  
  // Framebuffer management
  createFramebuffer(spec: FramebufferSpec): Framebuffer;
  deleteFramebuffer(id: string): void;
  bindFramebuffer(id: string | null): void;  // null = screen
  
  // Film buffer management with manifest
  setupFilmBuffers(film: ModuleDescriptor): FilmResources;
  swapFilmBuffers(): void;
  clearFilmBuffers(): void;
  
  // Memory monitoring
  getMemoryUsage(): MemoryStats;
  canAllocate(bytes: number): boolean;
  requestFallback(): FallbackOptions;
}
```

## Capability Checking

```typescript
interface CapabilityReport {
  floatRenderTargets: boolean;
  floatLinearFiltering: boolean;
  maxTextureSize: number;
  maxTextureUnits: number;
  maxColorAttachments: number;
  maxViewportDims: [number, number];
}

class CapabilityChecker {
  static check(gl: WebGL2RenderingContext): CapabilityReport {
    return {
      floatRenderTargets: !!gl.getExtension('EXT_color_buffer_float'),
      floatLinearFiltering: !!gl.getExtension('OES_texture_float_linear'),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
      maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)
    };
  }
  
  static validate(capabilities: CapabilityReport): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // HDR rendering requires float render targets
    if (!capabilities.floatRenderTargets) {
      errors.push('Float render targets not supported - HDR rendering unavailable');
    }
    
    // Check minimum requirements
    if (capabilities.maxTextureUnits < 8) {
      errors.push(`Only ${capabilities.maxTextureUnits} texture units available (minimum 8 required)`);
    }
    
    if (capabilities.maxColorAttachments < 4) {
      warnings.push(`Only ${capabilities.maxColorAttachments} color attachments available`);
    }
    
    // Suggest fallbacks
    const fallbackSuggestion = !capabilities.floatRenderTargets 
      ? 'Use LDR film module with 8-bit textures' 
      : undefined;
    
    return { 
      isValid: errors.length === 0, 
      errors,
      warnings,
      fallbackSuggestion
    };
  }
}
```

## Film Manifest System

```typescript
// Simple manifest for resource reuse
interface FilmManifest {
  textures: Array<{
    name: string;
    format: TextureFormat;
    persistent: boolean;
  }>;
}

class ResourceManager {
  private currentManifest: FilmManifest | null = null;
  private filmResources: FilmResources | null = null;
  private capabilities: CapabilityReport;
  
  constructor(private gl: WebGL2RenderingContext, private resolution: Resolution) {
    this.capabilities = CapabilityChecker.check(gl);
    const validation = CapabilityChecker.validate(this.capabilities);
    
    if (!validation.isValid) {
      console.error('GPU capability issues:', validation.errors);
      if (validation.fallbackSuggestion) {
        console.log('Suggestion:', validation.fallbackSuggestion);
      }
    }
  }
  
  setupFilmBuffers(film: ModuleDescriptor): FilmResources {
    const manifest = this.extractManifest(film);
    
    // Reuse existing resources if manifest matches
    if (this.currentManifest && this.manifestsEqual(this.currentManifest, manifest)) {
      // Just clear buffers, don't reallocate
      console.log('Reusing existing film buffers');
      this.clearFilmBuffers();
      return this.filmResources!;
    }
    
    // Need new resources
    console.log('Allocating new film buffers');
    if (this.filmResources) {
      this.cleanup();
    }
    
    // Check if we can handle the requirements
    const validation = this.validateManifest(manifest);
    if (!validation.isValid) {
      throw new Error(`Cannot create film buffers: ${validation.errors.join(', ')}`);
    }
    
    this.filmResources = this.createFilmResources(manifest);
    this.currentManifest = manifest;
    return this.filmResources;
  }
  
  private manifestsEqual(a: FilmManifest, b: FilmManifest): boolean {
    if (a.textures.length !== b.textures.length) return false;
    
    for (let i = 0; i < a.textures.length; i++) {
      if (a.textures[i].name !== b.textures[i].name ||
          a.textures[i].format !== b.textures[i].format ||
          a.textures[i].persistent !== b.textures[i].persistent) {
        return false;
      }
    }
    return true;
  }
  
  private extractManifest(film: ModuleDescriptor): FilmManifest {
    return {
      textures: film.resources?.textures?.map(t => ({
        name: t.name,
        format: this.mapFormat(t.type, t.format),
        persistent: t.persistent || false
      })) || []
    };
  }
  
  private validateManifest(manifest: FilmManifest): ValidationResult {
    const errors: string[] = [];
    
    // Check if we need HDR but don't have it
    const needsHDR = manifest.textures.some(t => 
      t.format === TextureFormat.RGBA32F || 
      t.format === TextureFormat.RGB32F
    );
    
    if (needsHDR && !this.capabilities.floatRenderTargets) {
      errors.push('Film requires HDR but float render targets not available');
    }
    
    // Check attachment count
    if (manifest.textures.length > this.capabilities.maxColorAttachments) {
      errors.push(`Film needs ${manifest.textures.length} attachments but GPU only supports ${this.capabilities.maxColorAttachments}`);
    }
    
    return { isValid: errors.length === 0, errors };
  }
  
  getCapabilities(): CapabilityReport {
    return this.capabilities;
  }
}
```

## Texture Management

```typescript
interface TextureSpec {
  id: string;                         // Unique identifier
  width: number;
  height: number;
  format: TextureFormat;
  type: TextureType;
  filter?: FilterMode;                // Default: NEAREST
  wrap?: WrapMode;                    // Default: CLAMP_TO_EDGE
  data?: ArrayBufferView | null;     // Initial data
}

enum TextureFormat {
  RGB = WebGL2RenderingContext.RGB,
  RGBA = WebGL2RenderingContext.RGBA,
  RGB32F = WebGL2RenderingContext.RGB32F,
  RGBA32F = WebGL2RenderingContext.RGBA32F,
  RGB16F = WebGL2RenderingContext.RGB16F,
  RGBA16F = WebGL2RenderingContext.RGBA16F,
  R32F = WebGL2RenderingContext.R32F,
  RG32F = WebGL2RenderingContext.RG32F,
  R32I = WebGL2RenderingContext.R32I  // For sample count
}

enum TextureType {
  UNSIGNED_BYTE = WebGL2RenderingContext.UNSIGNED_BYTE,
  FLOAT = WebGL2RenderingContext.FLOAT,
  HALF_FLOAT = WebGL2RenderingContext.HALF_FLOAT,
  INT = WebGL2RenderingContext.INT
}

interface Texture {
  id: string;
  glTexture: WebGLTexture;
  spec: TextureSpec;
  boundUnit?: number;                // Currently bound texture unit
  memoryBytes: number;               // Estimated memory usage
}
```

## Film Buffer System

```typescript
interface FilmResources {
  textures: Map<string, Texture>;
  framebuffers: {
    current: Framebuffer;           // Being written to
    previous: Framebuffer;          // Being read from
  };
  uniformBindings: Map<string, number>;  // Texture name → unit
  manifest: FilmManifest;             // For comparison
}

class ResourceManager {
  private createFilmResources(manifest: FilmManifest): FilmResources {
    const resources: FilmResources = {
      textures: new Map(),
      framebuffers: { current: null!, previous: null! },
      uniformBindings: new Map(),
      manifest
    };
    
    // Create textures based on manifest
    for (const tex of manifest.textures) {
      if (tex.persistent) {
        // Need two for ping-pong
        resources.textures.set(`${tex.name}_current`, 
          this.createTexture({
            id: `film_${tex.name}_current`,
            width: this.resolution.width,
            height: this.resolution.height,
            format: tex.format,
            type: this.getTypeForFormat(tex.format)
          })
        );
        
        resources.textures.set(`${tex.name}_previous`, 
          this.createTexture({
            id: `film_${tex.name}_previous`,
            width: this.resolution.width,
            height: this.resolution.height,
            format: tex.format,
            type: this.getTypeForFormat(tex.format)
          })
        );
      } else {
        // Single buffer for temporary
        resources.textures.set(tex.name,
          this.createTexture({
            id: `film_${tex.name}`,
            width: this.resolution.width,
            height: this.resolution.height,
            format: tex.format,
            type: this.getTypeForFormat(tex.format)
          })
        );
      }
    }
    
    // Create framebuffers
    resources.framebuffers.current = this.createFramebuffer({
      id: "film_current",
      attachments: Array.from(resources.textures.values())
        .filter(t => t.id.includes("current"))
    });
    
    resources.framebuffers.previous = this.createFramebuffer({
      id: "film_previous",
      attachments: Array.from(resources.textures.values())
        .filter(t => t.id.includes("previous"))
    });
    
    return resources;
  }
  
  swapFilmBuffers() {
    if (!this.filmResources) return;
    
    // Swap current and previous for next frame
    [this.filmResources.framebuffers.current,
     this.filmResources.framebuffers.previous] = 
    [this.filmResources.framebuffers.previous,
     this.filmResources.framebuffers.current];
  }
  
  clearFilmBuffers() {
    if (!this.filmResources) return;
    
    // Clear all persistent textures
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.filmResources.framebuffers.current.glFramebuffer);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.filmResources.framebuffers.previous.glFramebuffer);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
  
  private cleanup() {
    // Delete old textures and framebuffers
    if (this.filmResources) {
      for (const texture of this.filmResources.textures.values()) {
        this.gl.deleteTexture(texture.glTexture);
      }
      this.gl.deleteFramebuffer(this.filmResources.framebuffers.current.glFramebuffer);
      this.gl.deleteFramebuffer(this.filmResources.framebuffers.previous.glFramebuffer);
    }
  }
  
  private getTypeForFormat(format: TextureFormat): TextureType {
    switch (format) {
      case TextureFormat.RGB32F:
      case TextureFormat.RGBA32F:
      case TextureFormat.R32F:
      case TextureFormat.RG32F:
        return TextureType.FLOAT;
      case TextureFormat.RGB16F:
      case TextureFormat.RGBA16F:
        return TextureType.HALF_FLOAT;
      case TextureFormat.R32I:
        return TextureType.INT;
      default:
        return TextureType.UNSIGNED_BYTE;
    }
  }
}
```

## Mobile Fallbacks

```typescript
interface FallbackOptions {
  textureFormat: {
    from: TextureFormat;
    to: TextureFormat;
  };
  resolution: {
    from: [number, number];
    to: [number, number];
  };
  features: {
    hdr?: false;                     // Disable HDR
    multipleBuffers?: false;         // Use single accumulation buffer
  };
}

class ResourceManager {
  requestFallback(): FallbackOptions | null {
    const isMobile = /Mobile|Android|iOS/.test(navigator.userAgent);
    
    // If we don't have HDR, suggest LDR fallback
    if (!this.capabilities.floatRenderTargets) {
      return {
        textureFormat: {
          from: TextureFormat.RGBA32F,
          to: TextureFormat.RGBA  // 8-bit
        },
        resolution: {
          from: [this.resolution.width, this.resolution.height],
          to: [this.resolution.width, this.resolution.height]  // Keep same
        },
        features: {
          hdr: false
        }
      };
    }
    
    // Mobile optimizations
    if (isMobile) {
      return {
        textureFormat: {
          from: TextureFormat.RGBA32F,
          to: TextureFormat.RGBA16F    // Half precision
        },
        resolution: {
          from: [this.resolution.width, this.resolution.height],
          to: [Math.floor(this.resolution.width / 2), Math.floor(this.resolution.height / 2)]
        },
        features: {
          multipleBuffers: false
        }
      };
    }
    
    return null;  // No fallback needed
  }
}
```

## Integration with Engine

```typescript
class ResourceManager {
  constructor(
    private gl: WebGL2RenderingContext,
    private resolution: { width: number, height: number }
  ) {
    // Check capabilities on construction
    this.capabilities = CapabilityChecker.check(gl);
    const validation = CapabilityChecker.validate(this.capabilities);
    
    if (!validation.isValid) {
      console.error('GPU limitations:', validation.errors);
      
      // Suggest fallbacks
      const fallback = this.requestFallback();
      if (fallback) {
        console.log('Suggested fallback:', fallback);
      }
    }
  }
  
  // Called by ShaderCompiler after compilation
  setupForProgram(program: CompiledProgram) {
    // Extract Film requirements
    const film = program.recipe.photography.film;
    
    try {
      this.filmResources = this.setupFilmBuffers(film);
    } catch (error) {
      // Try with fallback
      const fallback = this.requestFallback();
      if (fallback) {
        console.warn('Using fallback configuration:', fallback);
        // Would need to modify film descriptor here
        throw new Error('Fallback film modules not yet implemented');
      }
      throw error;
    }
    
    // Bind textures to standard units
    for (const [name, texture] of this.filmResources.textures) {
      const unit = this.getUnitForFilmTexture(name);
      this.bindTexture(texture.id, unit);
    }
  }
  
  // Called by RenderExecutor each frame
  prepareFrame() {
    if (!this.filmResources) return;
    
    // Bind previous frame textures for reading
    this.gl.bindFramebuffer(
      this.gl.READ_FRAMEBUFFER,
      this.filmResources.framebuffers.previous.glFramebuffer
    );
    
    // Set current as render target
    this.gl.bindFramebuffer(
      this.gl.DRAW_FRAMEBUFFER,
      this.filmResources.framebuffers.current.glFramebuffer
    );
  }
  
  // Called after frame completes
  finalizeFrame() {
    this.swapFilmBuffers();
  }
}
```

## Performance Considerations

- Check capabilities once at startup
- Reuse film buffers when manifest matches (no reallocation)
- Clear rather than reallocate when resetting accumulation
- Pool texture allocations when possible
- Provide clear fallback paths for limited devices
- Log manifest comparisons for debugging
