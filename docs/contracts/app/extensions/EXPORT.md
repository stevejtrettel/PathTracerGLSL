# Export Extension Contract

Export extensions handle saving rendered results in various formats and managing output workflows.

## Extended Interface

```typescript
interface ExportExtension extends Extension {
  // Basic export
  exportImage(format: ImageFormat, options?: ExportOptions): Promise<string>;
  exportSequence(frames: Frame[], format: VideoFormat): Promise<string>;
  
  // Advanced export
  exportLayers(layers: RenderLayer[]): Promise<LayerExport>;
  exportData(data: RenderData, format: DataFormat): Promise<string>;
  
  // Batch operations
  exportBatch(configs: BatchExportConfig[]): Promise<BatchExportResult>;
  
  // Management
  getExportQueue(): ExportTask[];
  cancelExport(taskId: string): void;
}

type ImageFormat = 'png' | 'jpg' | 'exr' | 'tiff' | 'hdr';
type VideoFormat = 'mp4' | 'webm' | 'gif' | 'image_sequence';
type DataFormat = 'json' | 'csv' | 'numpy' | 'matlab';
```

## Export Options

```typescript
interface ExportOptions {
  // Common
  filename?: string;
  path?: string;
  quality?: number;           // 0-100 for lossy formats
  
  // Image-specific
  bitDepth?: 8 | 16 | 32;   // Bits per channel
  colorSpace?: 'srgb' | 'linear' | 'aces';
  compression?: 'none' | 'lzw' | 'zip';
  
  // Metadata
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
    renderTime?: number;
    sampleCount?: number;
    recipe?: Recipe;        // Embed full recipe
    custom?: Record<string, any>;
  };
  
  // Processing
  resize?: { width: number; height: number };
  crop?: { x: number; y: number; width: number; height: number };
  watermark?: WatermarkConfig;
}
```

## Implementation Examples

### Basic Image Export
```typescript
class ImageExportExtension implements ExportExtension {
  name = 'export-image';
  dependencies = [];  // Basic export needs nothing
  async exportImage(format: ImageFormat, options?: ExportOptions): Promise<string> {
    // Get pixels from engine
    const pixels = await this.app.engine.readPixels();
    const { width, height } = this.app.engine.getResolution();
    
    switch (format) {
      case 'png':
        return this.exportPNG(pixels, width, height, options);
      case 'exr':
        return this.exportEXR(pixels, width, height, options);
      case 'jpg':
        return this.exportJPEG(pixels, width, height, options);
    }
  }
  
  private async exportPNG(
    pixels: Float32Array, 
    width: number, 
    height: number, 
    options?: ExportOptions
  ): Promise<string> {
    // Convert linear to sRGB if needed
    if (options?.colorSpace === 'linear') {
      pixels = this.linearToSRGB(pixels);
    }
    
    // Convert to 8-bit
    const imageData = new ImageData(
      new Uint8ClampedArray(pixels.map(v => v * 255)),
      width,
      height
    );
    
    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    
    // Add watermark if requested
    if (options?.watermark) {
      this.addWatermark(ctx, options.watermark);
    }
    
    // Convert to blob
    const blob = await new Promise<Blob>(resolve => {
      canvas.toBlob(resolve, 'image/png', options?.quality ?? 100);
    });
    
    // Save or return data URL
    return this.saveBlob(blob, options?.filename ?? 'render.png');
  }
}
```

### EXR Export for Linear Data
```typescript
class EXRExportExtension {
  async exportEXR(
    pixels: Float32Array,
    width: number,
    height: number,
    options?: ExportOptions
  ): Promise<string> {
    // EXR maintains linear HDR data
    const exrData = {
      width,
      height,
      channels: {
        R: new Float32Array(width * height),
        G: new Float32Array(width * height),
        B: new Float32Array(width * height),
        A: new Float32Array(width * height)
      },
      compression: options?.compression ?? 'zip',
      metadata: {
        ...options?.metadata,
        colorSpace: 'linear',
        renderer: 'Research Path Tracer',
        samples: this.app.renderCoordinator.getAccumulationCount()
      }
    };
    
    // Deinterleave channels
    for (let i = 0; i < width * height; i++) {
      exrData.channels.R[i] = pixels[i * 4 + 0];
      exrData.channels.G[i] = pixels[i * 4 + 1];
      exrData.channels.B[i] = pixels[i * 4 + 2];
      exrData.channels.A[i] = pixels[i * 4 + 3];
    }
    
    // Write EXR (would need proper EXR library)
    const buffer = this.encodeEXR(exrData);
    return this.saveBuffer(buffer, options?.filename ?? 'render.exr');
  }
}
```

### Multi-Layer Export
```typescript
interface RenderLayer {
  name: string;             // "beauty", "albedo", "normal", "depth"
  data: Float32Array;
  channels: number;         // 1 for depth, 3 for normal/albedo, 4 for beauty
}

class LayerExportExtension {
  async exportLayers(layers: RenderLayer[]): Promise<LayerExport> {
    const exports = {};
    
    for (const layer of layers) {
      // Export each layer appropriately
      switch (layer.name) {
        case 'beauty':
          exports.beauty = await this.exportImage('exr', {
            filename: 'beauty.exr',
            metadata: { layer: 'beauty' }
          });
          break;
          
        case 'depth':
          // Normalize depth for visualization
          const normalized = this.normalizeDepth(layer.data);
          exports.depth = await this.exportImage('png', {
            filename: 'depth.png',
            colorSpace: 'linear'
          });
          break;
          
        case 'normal':
          // Remap normals from [-1,1] to [0,1]
          const remapped = layer.data.map(v => v * 0.5 + 0.5);
          exports.normal = await this.exportImage('png', {
            filename: 'normal.png',
            colorSpace: 'linear'
          });
          break;
      }
    }
    
    // Also create Photoshop file with layers
    exports.psd = await this.createPSD(layers);
    
    return exports;
  }
}
```

### Animation Export
```typescript
interface Frame {
  pixels: Float32Array;
  timestamp: number;
  index: number;
}

class AnimationExportExtension {
  async exportSequence(frames: Frame[], format: VideoFormat): Promise<string> {
    switch (format) {
      case 'gif':
        return this.createGIF(frames);
      case 'mp4':
        return this.createMP4(frames);
      case 'image_sequence':
        return this.saveImageSequence(frames);
    }
  }
  
  private async createGIF(frames: Frame[]): Promise<string> {
    // Use gif.js or similar
    const gif = new GIF({
      width: this.app.engine.getResolution().width,
      height: this.app.engine.getResolution().height,
      quality: 10,
      workers: 2
    });
    
    for (const frame of frames) {
      const imageData = this.toImageData(frame.pixels);
      gif.addFrame(imageData, { delay: 1000/30 });
    }
    
    return new Promise((resolve) => {
      gif.on('finished', (blob) => {
        resolve(this.saveBlob(blob, 'animation.gif'));
      });
      gif.render();
    });
  }
  
  private async saveImageSequence(frames: Frame[]): Promise<string> {
    const folder = await this.createFolder('sequence');
    
    for (const frame of frames) {
      const filename = `frame_${String(frame.index).padStart(5, '0')}.png`;
      await this.exportImage('png', {
        pixels: frame.pixels,
        filename: `${folder}/${filename}`
      });
    }
    
    return folder;
  }
}
```

### Data Export
```typescript
class DataExportExtension {
  async exportData(data: RenderData, format: DataFormat): Promise<string> {
    switch (format) {
      case 'json':
        return this.exportJSON(data);
      case 'csv':
        return this.exportCSV(data);
      case 'numpy':
        return this.exportNumpy(data);
    }
  }
  
  private exportJSON(data: RenderData): string {
    const json = {
      metadata: {
        timestamp: Date.now(),
        recipe: this.app.currentRecipe,
        samples: this.app.renderCoordinator.getAccumulationCount()
      },
      statistics: {
        renderTime: data.renderTime,
        samplesPerSecond: data.samplesPerSecond,
        variance: data.variance
      },
      parameters: this.app.parameterStore.getAll(),
      image: {
        width: data.width,
        height: data.height,
        format: 'float32',
        channels: 4
      }
    };
    
    return this.saveJSON(json, 'render_data.json');
  }
}
```

## Batch Export

```typescript
interface BatchExportConfig {
  source: 'current' | 'file' | 'memory';
  format: ImageFormat;
  options: ExportOptions;
  
  // For sequences
  frames?: number[];
  
  // For tiles
  tiles?: TileBounds[];
}

class BatchExporter {
  async exportBatch(configs: BatchExportConfig[]): Promise<BatchExportResult> {
    const results = [];
    const queue = this.createQueue(configs);
    
    // Process queue with progress
    for (const task of queue) {
      try {
        const result = await this.processTask(task);
        results.push({ success: true, path: result });
        
        this.bus.emit('export.progress', {
          completed: results.length,
          total: queue.length,
          current: task.options.filename
        });
      } catch (error) {
        results.push({ success: false, error });
      }
    }
    
    return { results, summary: this.createSummary(results) };
  }
}
```

## File Management

```typescript
interface FileManager {
  // Naming patterns
  generateFilename(pattern: string, index?: number): string;
  
  // Organization
  createFolder(name: string): Promise<string>;
  organizeByDate(files: string[]): void;
  
  // Cleanup
  deleteTemporary(): void;
  compressFolder(path: string): Promise<string>;
}

// Example naming patterns:
// "render_{date}_{time}.png" → "render_2024-01-15_14-30-45.png"
// "frame_{index:05d}.exr" → "frame_00042.exr"
// "{recipe}_{parameter}_{value}.jpg" → "glass_ior_1.5.jpg"
```

## Integration with Cloud Services

```typescript
interface CloudExporter {
  uploadToDropbox(file: Blob, path: string): Promise<string>;
  uploadToGoogleDrive(file: Blob, folder: string): Promise<string>;
  uploadToS3(file: Blob, bucket: string): Promise<string>;
}

class CloudExportExtension implements ExportExtension {
    name = 'cloud-export';
    dependencies = ['ui'];  // Needs UI for authentication/progress
  async exportToCloud(
    service: 'dropbox' | 'drive' | 's3',
    options: CloudExportOptions
  ): Promise<string> {
    const pixels = await this.app.engine.readPixels();
    const blob = await this.createBlob(pixels, options.format);
    
    switch (service) {
      case 'dropbox':
        return this.dropbox.upload(blob, options.path);
      case 'drive':
        return this.drive.upload(blob, options.folder);
      case 's3':
        return this.s3.upload(blob, options.bucket);
    }
  }
}
```

## Best Practices

1. **Preserve linear data** - Use EXR for HDR, don't clamp
2. **Embed metadata** - Include recipe, samples, render time
3. **Support automation** - Naming patterns, batch operations
4. **Handle large files** - Stream writing for huge images
5. **Validate before export** - Check resolution, format compatibility
6. **Provide progress** - Long exports need feedback
