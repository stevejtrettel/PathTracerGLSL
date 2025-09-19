
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
  suggestFallback(capability: string): FallbackOption | null;
  
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
  cleanup(): void;
  
  // Memory monitoring
  getMemoryUsage(): MemoryStats;
  getTextureCount(): number;
  getFramebufferCount(): number;
  canAllocate(bytes: number): boolean;
  
  // Resolution management
  getResolution(): Resolution;
  setResolution(width: number, height: number): void;
  supportsResolution(width: number, height: number): boolean;
}
```

## Capability System

### Capability Report Structure

```typescript
interface CapabilityReport {
  // Critical capabilities
  floatRenderTargets: boolean;         // HDR support
  floatLinearFiltering: boolean;       // Smooth HDR filtering
  
  // Limits
  maxTextureSize: number;               // Maximum texture dimension
  maxTextureUnits: number;              // Simultaneous textures
  maxColorAttachments: number;          // MRT support
  maxViewportDims: [number, number];    // Maximum viewport size
  maxRenderBufferSize: number;          // Maximum renderbuffer dimension
  
  // Optional features
  depthTexture: boolean;                // Depth as texture
  drawBuffers: boolean;                 // Multiple render targets
  textureFloat: boolean;                // Float textures
  colorBufferFloat: boolean;            // Float framebuffers
  anisotropicFiltering: boolean;       // AF support
  maxAnisotropy: number;                // AF level
}
```

### Capability Validation

The ResourceManager MUST check these capabilities at initialization:

| Capability | Required For | Minimum | Fallback |
|-----------|--------------|---------|----------|
| `floatRenderTargets` | HDR rendering | Yes for HDR | Use LDR film |
| `maxTextureUnits` | Material textures | 8 | Reduce features |
| `maxColorAttachments` | Variance tracking | 2 | Simple film only |
| `maxTextureSize` | Film buffers | 2048 | Reduce resolution |

### Validation Result

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];                    // Critical issues
  warnings: string[];                  // Non-critical issues
  fallbackSuggestions: FallbackOption[];
}

interface FallbackOption {
  capability: string;
  issue: string;
  suggestion: string;
  alternativeModule?: ModuleDescriptor;
  reducedFeatures?: string[];
}
```

## Texture Management

### Texture Specification

```typescript
interface TextureSpec {
  id: string;                          // Unique identifier
  width: number;
  height: number;
  format: TextureFormat;
  type: DataType;
  
  // Optional
  data?: ArrayBufferView | null;       // Initial data
  filter?: FilterMode;                 // Default: NEAREST
  wrap?: WrapMode;                     // Default: CLAMP_TO_EDGE
  generateMipmap?: boolean;            // Default: false
  flipY?: boolean;                     // Default: false
  premultiplyAlpha?: boolean;          // Default: false
  
  // Usage hints
  usage: 'film' | 'asset' | 'temporary';
  persistent?: boolean;                // Keep across frames
}

interface Texture {
  id: string;
  glTexture: WebGLTexture;
  spec: TextureSpec;
  boundUnit?: number;                  // Currently bound unit
  memoryBytes: number;                 // Estimated size
  lastUsedFrame?: number;              // For cleanup
}
```

### Texture Formats

The ResourceManager MUST support these formats:

| Format | Type | Use Case | Fallback |
|--------|------|----------|----------|
| RGBA32F | FLOAT | HDR accumulation | RGBA16F or RGBA8 |
| RGB32F | FLOAT | HDR radiance | RGB16F or RGB8 |
| RGBA16F | HALF_FLOAT | Mobile HDR | RGBA8 |
| RGBA8 | UNSIGNED_BYTE | LDR/UI | Required |
| R32F | FLOAT | Depth/single channel | R16F |
| RG32F | FLOAT | Motion vectors | RG16F |
| R32I | INT | Sample count | R16I |

### Texture Operations

The ResourceManager MUST:
- Track all allocated textures by ID
- Bind textures to specified texture units (0-31)
- Automatically unbind when binding null
- Clear texture to zero/black when requested
- Delete GPU resources when texture deleted
- Estimate memory usage for monitoring

## Framebuffer Management

### Framebuffer Specification

```typescript
interface FramebufferSpec {
  id: string;
  attachments: Array<{
    type: 'color' | 'depth' | 'stencil' | 'depth_stencil';
    attachment: number;                // Color attachment index
    texture?: Texture;                 // Attach texture
    renderbuffer?: WebGLRenderbuffer;  // Or renderbuffer
  }>;
  width: number;
  height: number;
}

interface Framebuffer {
  id: string;
  glFramebuffer: WebGLFramebuffer;
  spec: FramebufferSpec;
  complete: boolean;                   // Framebuffer complete status
}
```

### Framebuffer Requirements

The ResourceManager MUST:
- Create framebuffers with multiple attachments
- Validate framebuffer completeness after creation
- Bind framebuffer for rendering (null = default framebuffer)
- Track draw buffers for MRT
- Handle depth/stencil attachments

## Film Buffer System

### Film Manifest

```typescript
interface FilmManifest {
  textures: Array<{
    name: string;                      // 'radiance', 'variance', etc.
    format: TextureFormat;
    persistent: boolean;               // Needs ping-pong buffers
  }>;
  resolution: Resolution;
  clearColor: [number, number, number, number];
}
```

### Film Resources

```typescript
interface FilmResources {
  textures: Map<string, Texture>;     // All film textures
  framebuffers: {
    current: Framebuffer;              // Being written to
    previous: Framebuffer;             // Being read from
  };
  manifest: FilmManifest;              // For comparison
  needsSwap: boolean;                 // Uses ping-pong
}
```

### Film Buffer Setup Process

The ResourceManager MUST implement this process:

1. **Extract manifest** from film module descriptor
2. **Compare** with current manifest (if any)
3. **Reuse** if manifests match (just clear buffers)
4. **Allocate** new resources if different:
    - Create textures (double for persistent)
    - Create framebuffers
    - Validate completeness
5. **Clean up** old resources if replaced

### Manifest Comparison

Two manifests are equal if:
- Same number of textures
- Same texture names, formats, and persistence flags
- Same resolution

### Buffer Swapping

For films with persistent textures (accumulation):
- Maintain current/previous framebuffers
- Swap after each frame
- Previous becomes current, current becomes previous

## Resource Lifecycle

### Frame Preparation

`prepareFrame()` MUST:
1. Bind previous frame textures for reading
2. Set current framebuffer as render target
3. Update texture unit bindings
4. Clear non-persistent buffers if requested

### Frame Finalization

`finalizeFrame()` MUST:
1. Unbind all textures
2. Swap film buffers if needed
3. Update last-used timestamps
4. Check for memory pressure

### Cleanup

`cleanup()` MUST:
1. Delete all textures
2. Delete all framebuffers
3. Reset film resources
4. Clear manifest

## Memory Management

### Memory Statistics

```typescript
interface MemoryStats {
  textureMemory: number;               // Bytes in textures
  framebufferMemory: number;           // Bytes in framebuffers
  totalMemory: number;                 // Total GPU memory used
  textureCount: number;                // Number of textures
  framebufferCount: number;            // Number of framebuffers
  largestTexture: string;              // ID of largest texture
  lastCleanup: number;                 // Timestamp of last cleanup
}
```

### Memory Monitoring

The ResourceManager MUST:
- Track estimated memory per texture/framebuffer
- Sum total GPU memory usage
- Provide allocation feasibility check
- Suggest cleanup when pressure detected

Memory estimation formula:
```
bytes = width * height * bytesPerPixel * (mipmap ? 1.33 : 1)
```

## Mobile/Limited Device Support

### Automatic Fallbacks

The ResourceManager MUST detect and suggest fallbacks:

| Limitation | Detection | Fallback |
|-----------|-----------|----------|
| No float textures | Missing `EXT_color_buffer_float` | RGBA8 with range mapping |
| Limited texture units | `MAX_TEXTURE_UNITS < 8` | Reduce texture features |
| Small max texture | `MAX_TEXTURE_SIZE < 2048` | Reduce resolution |
| No MRT | `MAX_COLOR_ATTACHMENTS < 2` | Simple film only |
| Low memory | Allocation failure | Lower precision/resolution |

### Platform Detection

```typescript
interface PlatformInfo {
  isMobile: boolean;
  isWebGL1: boolean;                  // Requires WebGL2
  vendor: string;
  renderer: string;
  maxMemory?: number;                 // If queryable
}
```

## Error Handling

The ResourceManager MUST handle these errors:

### Allocation Errors
- Out of memory → Suggest resolution reduction
- Texture too large → Suggest smaller dimensions
- Too many textures → Suggest feature reduction

### Capability Errors
- Missing required extension → Suggest fallback module
- Insufficient texture units → Reduce features
- No HDR support → Force LDR film

### Validation Errors
- Incomplete framebuffer → Log attachment issue
- Invalid format combination → Suggest valid combination
- Dimension mismatch → Resize to match

## Integration Requirements

### With ShaderCompiler
- Provide capability report for conditional compilation
- Report available texture units for material features

### With UniformBinder
- Provide texture unit bindings for samplers
- Map film texture names to uniform locations

### With RenderExecutor
- Set up framebuffers for rendering
- Manage viewport constraints

### With Engine
- Initialize with WebGL context
- Validate capabilities before compilation
- Provide fallback suggestions to App

## Performance Requirements

- Texture creation: < 10ms for 1920x1080 RGBA32F
- Framebuffer creation: < 5ms with 4 attachments
- Manifest comparison: < 1ms
- Buffer swap: < 0.1ms
- Memory calculation: O(n) where n = texture count

## Invariants

1. Film buffers always match current film module manifest
2. Framebuffers are complete before use
3. Texture units 0-7 reserved for film, 8-15 for materials
4. Memory usage tracking is always current
5. Capability report is immutable after initialization
6. Fallback suggestions are always available for missing capabilities

## Usage Example

```typescript
const resources = new ResourceManager(gl, { width: 1920, height: 1080 });

// Check capabilities
const caps = resources.getCapabilities();
if (!caps.floatRenderTargets) {
  const fallback = resources.suggestFallback('floatRenderTargets');
  console.log(fallback.suggestion); // "Use LDR film module"
}

// Set up film buffers
const filmResources = resources.setupFilmBuffers(varianceFilm);
// If manifest matches previous, buffers are reused

// Each frame
resources.prepareFrame();
// ... render ...
resources.finalizeFrame();

// Query memory
const stats = resources.getMemoryUsage();
console.log(`GPU memory: ${stats.totalMemory / 1024 / 1024}MB`);
```
