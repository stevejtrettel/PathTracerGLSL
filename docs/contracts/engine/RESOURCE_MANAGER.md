# Resource Manager Contract

The ResourceManager handles all GPU memory allocation including textures, buffers, and framebuffers.

## Core Interface

```typescript
interface ResourceManager {
  // Texture management
  createTexture(spec: TextureSpec): WebGLTexture;
  deleteTexture(id: string): void;
  bindTexture(id: string, unit: number): void;
  
  // Framebuffer management
  createFramebuffer(spec: FramebufferSpec): Framebuffer;
  deleteFramebuffer(id: string): void;
  bindFramebuffer(id: string | null): void;  // null = screen
  
  // Film buffer management
  setupFilmBuffers(film: ModuleDescriptor): FilmResources;
  swapFilmBuffers(): void;
  clearFilmBuffers(): void;
  
  // Memory monitoring
  getMemoryUsage(): MemoryStats;
  canAllocate(bytes: number): boolean;
  requestFallback(): FallbackOptions;
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

Films declare their buffer needs in the ModuleDescriptor:

```typescript
// In Film's ModuleDescriptor:
{
  resources: {
    textures: [
      { 
        name: "radiance",
        type: "vec4",
        format: "32bit",
        persistent: true      // Survives frame-to-frame
      },
      { 
        name: "variance",
        type: "vec3",
        format: "32bit",
        persistent: true
      },
      { 
        name: "samples",
        type: "int",
        format: "32bit",
        persistent: true
      }
    ]
  }
}
```

ResourceManager creates matching GPU resources:

```typescript
interface FilmResources {
  textures: Map<string, Texture>;
  framebuffers: {
    current: Framebuffer;           // Being written to
    previous: Framebuffer;          // Being read from
  };
  uniformBindings: Map<string, number>;  // Texture name → unit
}

class ResourceManager {
  setupFilmBuffers(film: ModuleDescriptor): FilmResources {
    const resources: FilmResources = {
      textures: new Map(),
      framebuffers: { current: null, previous: null },
      uniformBindings: new Map()
    };
    
    // Create double-buffered textures for persistence
    for (const tex of film.resources?.textures || []) {
      if (tex.persistent) {
        // Need two for ping-pong
        resources.textures.set(`${tex.name}_current`, 
          this.createTexture({
            id: `film_${tex.name}_current`,
            width: this.resolution.width,
            height: this.resolution.height,
            format: this.mapFormat(tex.type, tex.format),
            type: this.mapType(tex.format)
          })
        );
        
        resources.textures.set(`${tex.name}_previous`, 
          this.createTexture({
            id: `film_${tex.name}_previous`,
            width: this.resolution.width,
            height: this.resolution.height,
            format: this.mapFormat(tex.type, tex.format),
            type: this.mapType(tex.format)
          })
        );
      } else {
        // Single buffer for temporary
        resources.textures.set(tex.name,
          this.createTexture({ /* ... */ })
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
    // Swap current and previous for next frame
    [this.filmResources.framebuffers.current,
     this.filmResources.framebuffers.previous] = 
    [this.filmResources.framebuffers.previous,
     this.filmResources.framebuffers.current];
  }
}
```

## Framebuffer Management

```typescript
interface FramebufferSpec {
  id: string;
  attachments: Array<{
    texture: WebGLTexture;
    attachment: AttachmentPoint;
  }>;
  depthBuffer?: boolean;             // Add depth attachment
  stencilBuffer?: boolean;           // Add stencil attachment
}

enum AttachmentPoint {
  COLOR0 = WebGL2RenderingContext.COLOR_ATTACHMENT0,
  COLOR1 = WebGL2RenderingContext.COLOR_ATTACHMENT1,
  COLOR2 = WebGL2RenderingContext.COLOR_ATTACHMENT2,
  COLOR3 = WebGL2RenderingContext.COLOR_ATTACHMENT3,
  DEPTH = WebGL2RenderingContext.DEPTH_ATTACHMENT,
  STENCIL = WebGL2RenderingContext.STENCIL_ATTACHMENT
}

interface Framebuffer {
  id: string;
  glFramebuffer: WebGLFramebuffer;
  attachments: Map<AttachmentPoint, WebGLTexture>;
  width: number;
  height: number;
}
```

## Memory Management

```typescript
interface MemoryStats {
  texturesBytes: number;             // Total texture memory
  buffersBytes: number;              // Vertex/index buffers
  totalBytes: number;
  availableBytes?: number;           // If queryable
  textureCount: number;
  bufferCount: number;
}

interface MemoryPressure {
  level: "low" | "medium" | "high" | "critical";
  recommendation: MemoryStrategy;
}

enum MemoryStrategy {
  CONTINUE,                          // Enough memory
  REDUCE_PRECISION,                  // Use 16bit instead of 32bit
  REDUCE_RESOLUTION,                 // Halve resolution
  TILE_RENDERING,                    // Switch to tiled mode
  ABORT                             // Cannot continue
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
    variance?: false;                // Disable variance tracking
    multipleBuffers?: false;         // Use single accumulation buffer
  };
}

class ResourceManager {
  requestFallback(): FallbackOptions {
    const isMobile = /Mobile|Android|iOS/.test(navigator.userAgent);
    const memoryPressure = this.getMemoryPressure();
    
    if (isMobile || memoryPressure.level === "high") {
      return {
        textureFormat: {
          from: TextureFormat.RGBA32F,
          to: TextureFormat.RGBA16F    // Half precision
        },
        resolution: {
          from: [this.resolution.width, this.resolution.height],
          to: [this.resolution.width / 2, this.resolution.height / 2]
        },
        features: {
          variance: false               // Simpler film
        }
      };
    }
    
    return null;  // No fallback needed
  }
}
```

## Texture Unit Management

WebGL2 has limited texture units (16-32):

```typescript
interface TextureUnitManager {
  units: Array<{
    index: number;                   // 0-31
    texture: WebGLTexture | null;
    lastUsed: number;                // Timestamp for LRU
  }>;
  
  // Reserve units for specific purposes
  reserveUnit(purpose: string): number;
  releaseUnit(unit: number): void;
  
  // Get available unit (may evict LRU)
  getAvailableUnit(): number;
}

// Standard unit reservations:
enum ReservedUnits {
  FILM_RADIANCE = 0,
  FILM_VARIANCE = 1,
  FILM_SAMPLES = 2,
  ENVIRONMENT_MAP = 3,
  MATERIAL_TEXTURES_START = 4,
  // ... up to MAX_TEXTURE_UNITS - 1
}
```

## Resource Lifecycle

```typescript
interface ResourceLifecycle {
  // Called when switching recipes
  onRecipeChange(oldRecipe: Recipe, newRecipe: Recipe): void {
    // Check if resources are compatible
    if (this.canReuse(oldRecipe, newRecipe)) {
      // Keep existing buffers
      this.clearFilmBuffers();  // Just clear, don't deallocate
    } else {
      // Need new buffers
      this.cleanup();
      this.allocate(newRecipe);
    }
  }
  
  // Called on context loss
  onContextLost(): void {
    // Mark all resources invalid
    this.invalidateAll();
  }
  
  // Called on context restored
  onContextRestored(): void {
    // Recreate all resources
    this.recreateAll();
  }
}
```

## Environment Map Management

For HDR environment maps:

```typescript
interface EnvironmentMapManager {
  loadHDR(url: string): Promise<HDRTexture>;
  generateImportanceCDF(hdr: HDRTexture): WebGLTexture;
  bindEnvironment(unit: number): void;
}

interface HDRTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  importanceMap: WebGLTexture;      // For importance sampling
}
```

## Validation

The ResourceManager validates:
1. Texture formats supported by GPU
2. Maximum texture size limits
3. Framebuffer completeness
4. Texture unit availability
5. Memory allocation success
6. Attachment point limits (max color attachments)

## Error Handling

```typescript
class ResourceAllocationError extends Error {
  constructor(
    public resource: string,
    public requested: number,        // Bytes requested
    public available?: number,        // Bytes available
    public fallback?: FallbackOptions
  ) {
    super(`Failed to allocate ${resource}: ${requested} bytes`);
  }
}

// Usage:
try {
  texture = resourceManager.createTexture(spec);
} catch (e) {
  if (e instanceof ResourceAllocationError && e.fallback) {
    // Try with fallback options
    spec = applyFallback(spec, e.fallback);
    texture = resourceManager.createTexture(spec);
  } else {
    throw e;
  }
}
```

## Integration with Engine

```typescript
class ResourceManager {
  constructor(
    private gl: WebGL2RenderingContext,
    private resolution: { width: number, height: number }
  ) {}
  
  // Called by ShaderCompiler after compilation
  setupForProgram(program: CompiledProgram) {
    // Extract Film requirements
    const film = program.recipe.photography.film;
    this.filmResources = this.setupFilmBuffers(film);
    
    // Bind textures to standard units
    for (const [name, texture] of this.filmResources.textures) {
      const unit = this.getUnitForFilmTexture(name);
      this.bindTexture(texture.id, unit);
    }
  }
  
  // Called by RenderExecutor each frame
  prepareFrame() {
    // Bind previous frame textures for reading
    this.bindFramebuffer(this.filmResources.framebuffers.previous);
    
    // Set current as render target
    this.gl.bindFramebuffer(
      GL.FRAMEBUFFER,
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

- Pool texture allocations when possible
- Use texture arrays for material properties
- Lazy allocation - only create when needed
- Monitor memory pressure and suggest fallbacks early
- Reuse framebuffers when switching between compatible recipes
- Clear rather than reallocate when resetting accumulation
