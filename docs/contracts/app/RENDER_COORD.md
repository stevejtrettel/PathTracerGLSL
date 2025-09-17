# Render Coordinator Contract

The RenderCoordinator manages rendering execution, supporting multiple modes from interactive preview to tiled production rendering.

## Core Interface

```typescript
interface RenderCoordinator {
  // Mode management
  setMode(mode: RenderMode): void;
  getMode(): RenderMode;
  
  // Execution control
  start(): Promise<void>;
  stop(): void;
  reset(): void;
  
  // Accumulation
  resetAccumulation(): void;
  getAccumulationCount(): number;
  
  // Parameter change handling
  handleParameterChange(path: string, oldValue: any, newValue: any): void;
  
  // Progress tracking
  onProgress?: (info: ProgressInfo) => void;
  onComplete?: (result: RenderResult) => void;
  
  // Configuration
  configure(config: RenderConfig): void;
}

type RenderMode = 'interactive' | 'progressive' | 'production';
```

## Render Modes

### Interactive Mode
Real-time preview without accumulation:
```typescript
{
  mode: 'interactive',
  targetFps: 30,          // Maintain framerate
  accumulate: false,      // No multi-sample accumulation
  resolution: 'adaptive'  // May reduce resolution for speed
}
```

### Progressive Mode
Continuous accumulation until stopped:
```typescript
{
  mode: 'progressive',
  samplesPerFrame: 1,     // Samples per render pass
  maxSamples: Infinity,   // Continue indefinitely
  accumulate: true        // Accumulate samples
}
```

### Production Mode
High-quality rendering with tiling support:
```typescript
{
  mode: 'production',
  resolution: [4096, 4096],  // Final image size
  tileSize: 512,             // Tile dimensions
  samplesPerTile: 1000,      // Convergence per tile
  saveCheckpoints: true      // Save after each tile
}
```

## Configuration

```typescript
interface RenderConfig {
  // Common
  resolution?: [number, number];
  samplesPerPass?: number;
  
  // Progressive
  targetSamples?: number;
  convergenceThreshold?: number;
  
  // Production
  tiles?: TileConfig;
  checkpoints?: CheckpointConfig;
  output?: OutputConfig;
}

interface TileConfig {
  tileSize: number;          // Square tile dimension
  overlap?: number;          // Pixel overlap for filtering
  order?: 'spiral' | 'linear' | 'random';
}
```

## Execution Flow

### Progressive Rendering
```typescript
class RenderCoordinator {
  private async runProgressive() {
    this.accumulator.reset();
    
    while (this.isRunning && !this.hasConverged()) {
      // Render one sample
      await this.engine.renderFrame();
      this.accumulator.increment();
      
      // Notify progress
      if (this.accumulator.count % 10 === 0) {
        this.onProgress?.({
          samples: this.accumulator.count,
          variance: this.computeVariance(),
          time: performance.now() - this.startTime
        });
      }
      
      // Yield to browser
      await this.nextFrame();
    }
    
    this.onComplete?.({
      samples: this.accumulator.count,
      time: performance.now() - this.startTime
    });
  }
}
```

### Tiled Production
```typescript
class RenderCoordinator {
  private async runProduction(config: ProductionConfig) {
    const tiles = this.generateTiles(config);
    
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      
      // Configure viewport for tile
      this.engine.setViewport(tile.bounds);
      
      // Reset accumulation for this tile
      this.accumulator.reset();
      
      // Render tile to convergence
      while (this.accumulator.count < config.samplesPerTile) {
        await this.engine.renderFrame();
        this.accumulator.increment();
        
        this.onProgress?.({
          tile: i + 1,
          totalTiles: tiles.length,
          tileSamples: this.accumulator.count,
          tileProgress: this.accumulator.count / config.samplesPerTile
        });
      }
      
      // Save tile
      const pixels = await this.engine.readPixels(tile.bounds);
      await this.saveTile(tile, pixels);
      
      // Checkpoint if requested
      if (config.saveCheckpoints) {
        await this.saveCheckpoint(i, tiles.length);
      }
    }
    
    // Combine tiles into final image
    await this.combineTiles(tiles, config.resolution);
  }
}
```

## Accumulator

Internal accumulation tracking:

```typescript
interface Accumulator {
  count: number;           // Current sample count
  startTime: number;       // When accumulation started
  
  reset(): void;           // Clear and restart
  increment(): void;       // Add one sample
  
  isActive: boolean;       // Currently accumulating?
}
```

## Accumulation Reset Management

The RenderCoordinator owns all decisions about when to reset accumulation:

```typescript
class RenderCoordinator {
    // Parameters that trigger accumulation reset (prefix-based)
    private resetPrefixes = new Set([
        'camera.',         // Any camera parameter
        'material.',       // Any material parameter  
        'scene.',          // Any scene change
        'lights.',         // Any light change
        'estimator.'       // Algorithm parameters
    ]);

    // Parameters that DON'T trigger reset (prefix-based)
    private noResetPrefixes = new Set([
        'developer.',      // Tonemapping only
        'film.',           // Visualization only
        'ui.',             // UI state
        'debug.'           // Debug flags
    ]);

    handleParameterChange(path: string, oldValue: any, newValue: any) {
        // Skip if unchanged
        if (this.valuesEqual(oldValue, newValue)) return;

        // Check if reset needed
        if (this.shouldResetForParameter(path)) {
            this.resetAccumulation();
        }
    }

    private shouldResetForParameter(path: string): boolean {
        // Check no-reset list first
        for (const prefix of this.noResetPrefixes) {
            if (path.startsWith(prefix)) return false;
        }

        // Check reset triggers
        for (const prefix of this.resetPrefixes) {
            if (path.startsWith(prefix)) return true;
        }

        // Default: reset to be safe
        console.warn(`Unknown parameter ${path}, resetting accumulation`);
        return true;
    }
}
```


## Progress Reporting

```typescript
interface ProgressInfo {
  // Common fields
  samples?: number;        // Total samples accumulated
  time?: number;          // Milliseconds elapsed
  
  // Progressive mode
  variance?: number;       // Current variance estimate
  convergence?: number;    // Estimated completion percentage
  
  // Production mode
  tile?: number;          // Current tile index
  totalTiles?: number;    // Total tile count
  tileSamples?: number;   // Samples in current tile
  tileProgress?: number;  // Current tile completion [0,1]
}
```

## Integration with Engine

The RenderCoordinator doesn't directly call WebGL. Instead:

```typescript
class RenderCoordinator {
  constructor(private engine: Engine) {}
  
  private async renderFrame() {
    // Tell engine to render
    await this.engine.renderFrame();
    
    // Engine handles:
    // - GL draw calls
    // - Uniform updates
    // - Buffer management
    
    // Coordinator handles:
    // - Sample counting
    // - Progress tracking
    // - Mode switching
  }
}
```

## Lifecycle Management

```typescript
// Start rendering
coordinator.setMode('progressive');
coordinator.configure({ targetSamples: 100 });
await coordinator.start();

// Change parameters (resets accumulation)
parameterStore.set('material.roughness', 0.5);
// Coordinator automatically resets via onChange handler

// Stop rendering
coordinator.stop();

// Switch modes
coordinator.setMode('production');
coordinator.configure({ 
  resolution: [4096, 4096],
  tiles: { tileSize: 512 }
});
await coordinator.start();
```

## Error Handling

```typescript
interface RenderError {
  type: 'shader' | 'memory' | 'timeout' | 'user_cancelled';
  message: string;
  tile?: number;        // For production mode
  canResume?: boolean;  // Can continue from checkpoint?
}

coordinator.onError = (error: RenderError) => {
  if (error.canResume) {
    // Offer to resume from checkpoint
  } else {
    // Start over or abort
  }
};
```

## Performance Utilities

```typescript
interface RenderStats {
  samplesPerSecond: number;
  framesPerSecond: number;
  gpuMemoryUsed: number;
  estimatedTimeRemaining: number;
}

coordinator.getStats(): RenderStats;
```

## Best Practices

1. **Reset accumulation** when scene/material parameters change
2. **Use appropriate mode** for the task (preview vs final)
3. **Save checkpoints** for long production renders
4. **Monitor GPU memory** when using large resolutions
5. **Yield to browser** periodically to maintain responsiveness
6. **Report progress** at reasonable intervals (not every sample)
