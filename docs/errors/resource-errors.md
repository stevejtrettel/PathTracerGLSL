# Resource Loading Validation

Validation for HDR environment maps and texture loading.

## Overview

Resource validation catches errors during HDR loading:
1. **Fetch errors** - 404, network failures, permissions
2. **Buffer validation** - Empty files, size limits, format checks
3. **Data validation** - Dimensions, aspect ratio, data integrity
4. **Texture creation** - GPU limits, WebGL errors

---

## HDR Loading Stages

```
fetch(path)
  ↓
validateHDRResponse()
  ├─ 404 → "HDR file not found"
  ├─ 403 → "Permission denied"
  └─ Other → Status message
  ↓
arrayBuffer()
  ↓
validateHDRBuffer()
  ├─ Empty → "HDR file is empty"
  ├─ Too large → "HDR file too large: XMB"
  └─ Invalid header → Warning
  ↓
HDRLoader.parse()
  ↓
validateHDRData()
  ├─ Invalid dimensions → "Dimensions too large/small"
  ├─ Data size mismatch → "Data size mismatch"
  ├─ Non-POT → Warning
  └─ Unusual aspect → Warning
  ↓
TextureFactory.createRGB32F()
  ↓
validateTextureCreation()
  ├─ Texture null → "Failed to create texture"
  ├─ WebGL error → "WebGL error: ..."
  └─ GPU limit → "Exceeds GPU limit"
```

---

## Validation Functions

### validateHDRResponse

```typescript
function validateHDRResponse(
    response: Response,
    path: string
): ValidationResult
```

**Checks**:
- HTTP status (200 OK)
- 404 → File not found
- 403 → Permission denied
- Other → Generic error

**Example Errors**:
```
❌ HDR loading failed:
  • HDR file not found: /hdri/missing.hdr

❌ HDR loading failed:
  • Permission denied loading HDR file: /hdri/private.hdr

❌ HDR loading failed:
  • Failed to load HDR file '/hdri/env.hdr': 500 Internal Server Error
```

### validateHDRBuffer

```typescript
function validateHDRBuffer(
    buffer: ArrayBuffer,
    path: string,
    config?: HDRValidationConfig
): ValidationResult
```

**Checks**:
- Buffer not empty
- Size within limits (default: 100MB)
- Radiance header present (`#?RADIANCE` or `#?RGBE`)

**Configuration**:
```typescript
interface HDRValidationConfig {
    maxFileSizeMB?: number;  // Default: 100
}
```

**Example Errors**:
```
❌ Invalid HDR file:
  • HDR file is empty: /hdri/empty.hdr

❌ Invalid HDR file:
  • HDR file too large: 150.3MB exceeds limit of 100MB
```

**Example Warnings**:
```
⚠️  HDR file warnings:
  • HDR file '/hdri/custom.hdr' does not have standard Radiance header.
    This may cause parsing errors.
```

### validateHDRData

```typescript
function validateHDRData(
    width: number,
    height: number,
    dataLength: number,
    path: string,
    config?: HDRValidationConfig
): ValidationResult
```

**Checks**:
- Dimensions > 0
- Dimensions within range (default: 16-8192)
- Data length matches width × height × 3
- Power-of-two (warning only)
- Aspect ratio reasonable (warning only)

**Configuration**:
```typescript
interface HDRValidationConfig {
    minWidth?: number;   // Default: 16
    minHeight?: number;  // Default: 16
    maxWidth?: number;   // Default: 8192
    maxHeight?: number;  // Default: 8192
}
```

**Example Errors**:
```
❌ Invalid HDR data:
  • Invalid HDR dimensions: 0x0

❌ Invalid HDR data:
  • HDR dimensions too small: 8x8 (minimum: 16x16)

❌ Invalid HDR data:
  • HDR dimensions too large: 16384x8192 (maximum: 8192x8192)

❌ Invalid HDR data:
  • HDR data size mismatch: expected 12288000 floats (2048x2048x3), got 12000000
```

**Example Warnings**:
```
⚠️  HDR data warnings:
  • HDR dimensions 1024x512 are not power-of-two.
    This may cause performance issues on some GPUs.

⚠️  HDR data warnings:
  • Unusual HDR aspect ratio: 3.5:1.
    Environment maps are typically 2:1 (equirectangular).
```

### validateTextureCreation

```typescript
function validateTextureCreation(
    texture: WebGLTexture | null,
    width: number,
    height: number,
    gl: WebGL2RenderingContext
): ValidationResult
```

**Checks**:
- Texture created successfully
- WebGL errors
- GPU texture size limits

**Example Errors**:
```
❌ Texture creation failed:
  • Failed to create WebGL texture

❌ Texture creation failed:
  • WebGL error during texture creation: OUT_OF_MEMORY (0x505)

❌ Texture creation failed:
  • Texture size 16384x16384 exceeds GPU limit 8192x8192
```

---

## Complete Validation

### validateHDRLoad

Validates entire HDR loading pipeline:

```typescript
function validateHDRLoad(
    response: Response,
    buffer: ArrayBuffer,
    width: number,
    height: number,
    dataLength: number,
    texture: WebGLTexture | null,
    gl: WebGL2RenderingContext,
    path: string,
    config?: HDRValidationConfig
): ValidationResult
```

**Returns**: Combined errors and warnings from all stages.

**Usage**:
```typescript
const response = await fetch(path);
const buffer = await response.arrayBuffer();
const hdr = HDRLoader.parse(buffer);
const texture = textureFactory.createRGB32F(hdr.data, hdr.width, hdr.height);

const result = validateHDRLoad(
    response,
    buffer,
    hdr.width,
    hdr.height,
    hdr.data.length,
    texture,
    gl,
    path
);

if (!result.valid) {
    throw new Error(`HDR validation failed: ${result.errors.join(', ')}`);
}
```

---

## Integration with Engine

```typescript
// Engine.loadEnvironmentHDR()
const res = await fetch(path);

const responseResult = validateHDRResponse(res, path);
if (!responseResult.valid) {
    console.error(`\n❌ HDR loading failed:\n`);
    responseResult.errors.forEach(err => console.error(`  • ${err}`));
    throw new Error(`Failed to load HDR from '${path}'`);
}

const buffer = await res.arrayBuffer();

const bufferResult = validateHDRBuffer(buffer, path);
if (!bufferResult.valid) {
    console.error(`\n❌ Invalid HDR file:\n`);
    bufferResult.errors.forEach(err => console.error(`  • ${err}`));
    throw new Error(`Invalid HDR file '${path}'`);
}

if (bufferResult.warnings?.length > 0) {
    console.warn(`\n⚠️  HDR file warnings:`);
    bufferResult.warnings.forEach(warn => console.warn(`  • ${warn}`));
}

let hdr;
try {
    hdr = HDRLoader.parse(buffer);
} catch (error: any) {
    console.error(`\n❌ HDR parsing failed:\n`);
    console.error(`  • ${error.message}`);
    throw new Error(`Failed to parse HDR file '${path}'`);
}

const dataResult = validateHDRData(hdr.width, hdr.height, hdr.data.length, path);
if (!dataResult.valid) {
    console.error(`\n❌ Invalid HDR data:\n`);
    dataResult.errors.forEach(err => console.error(`  • ${err}`));
    throw new Error(`Invalid HDR data in '${path}'`);
}

const texture = textureFactory.createRGB32F(hdr.data, hdr.width, hdr.height);

const textureResult = validateTextureCreation(texture, hdr.width, hdr.height, gl);
if (!textureResult.valid) {
    console.error(`\n❌ Texture creation failed:\n`);
    textureResult.errors.forEach(err => console.error(`  • ${err}`));
    throw new Error(`Failed to create texture for '${path}'`);
}
```

---

## WebGL Error Names

```typescript
function getGLErrorName(error: number, gl: WebGL2RenderingContext): string {
    switch (error) {
        case gl.INVALID_ENUM: return 'INVALID_ENUM';
        case gl.INVALID_VALUE: return 'INVALID_VALUE';
        case gl.INVALID_OPERATION: return 'INVALID_OPERATION';
        case gl.OUT_OF_MEMORY: return 'OUT_OF_MEMORY';
        case gl.INVALID_FRAMEBUFFER_OPERATION: return 'INVALID_FRAMEBUFFER_OPERATION';
        case gl.CONTEXT_LOST_WEBGL: return 'CONTEXT_LOST_WEBGL';
        default: return 'UNKNOWN_ERROR';
    }
}
```

---

## Common Issues

### 404 Not Found

**Cause**: File path incorrect

**Fix**:
```typescript
// ❌ Wrong
await app.loadEnvironmentHDR('/hdri/studio.hdr');  // Relative to root

// ✅ Correct
await app.loadEnvironmentHDR('./hdri/studio.hdr');  // Relative to current
```

### Oversized Texture

**Cause**: HDR dimensions exceed GPU limits

**Fix**:
- Resize HDR to 4096x2048 or smaller
- Check GPU max texture size: `gl.getParameter(gl.MAX_TEXTURE_SIZE)`

### Out of Memory

**Cause**: Not enough GPU memory for texture

**Fix**:
- Use smaller HDR files
- Reduce resolution
- Check total GPU memory usage

### Non-Power-of-Two Warning

**Cause**: Dimensions not powers of 2

**Impact**: May affect performance on some GPUs

**Fix** (optional):
- Resize to POT (e.g., 2048x1024 instead of 2000x1000)
- Or ignore warning (usually fine on modern GPUs)

---

## Configuration

Custom validation limits:

```typescript
const config: HDRValidationConfig = {
    minWidth: 32,
    minHeight: 32,
    maxWidth: 4096,
    maxHeight: 4096,
    maxFileSizeMB: 50
};

const result = validateHDRBuffer(buffer, path, config);
```

---

## Best Practices

1. **Validate early** - Check file exists before loading
2. **Handle errors gracefully** - Provide fallback environment
3. **Check GPU limits** - Query `MAX_TEXTURE_SIZE`
4. **Use appropriate sizes** - 2048x1024 is usually enough
5. **Compress HDR files** - Reduce file size where possible
6. **Test on multiple devices** - GPU limits vary

---

## Next Steps

- [Validation](validation.md) - Pre-compilation validation
- [Shader Errors](shader-errors.md) - GLSL error translation
- [Error System Overview](README.md) - Complete error system
- [Loading Environments Guide](../guides/loading-environments.md) - HDR usage
