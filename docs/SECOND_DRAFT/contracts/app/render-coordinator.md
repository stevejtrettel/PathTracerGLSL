# Render Coordinator Contract

## Purpose

The RenderCoordinator manages the execution of rendering across three modes: interactive (real-time preview), progressive (accumulation), and production (tiled high-res). It owns the critical decision of when to reset accumulation based on parameter changes. The coordinator tells the Engine when to render but never touches WebGL directly.

## Required Interface

```typescript
interface RenderCoordinator {
  // Mode management
  setMode(mode: RenderMode): void;
  getMode(): RenderMode;
  
  // Execution control
  start(): void;
  stop(): void;
  isRunning(): boolean;
  
  // Accumulation management
  resetAccumulation(): void;
  getAccumulationCount(): number;
  shouldResetForParameter(path: string): boolean;
  
  // Configuration
  configure(config: RenderConfig): void;
  
  // Progress callback
  onProgress?: (info: ProgressInfo) => void;
}
```

## Core Architecture

```typescript
class RenderCoordinator {
  private engine: Engine;
  private mode: RenderMode = 'progressive';
  private running = false;
  private animationId?: number;
  
  // Accumulation tracking
  private accumulator = {
    count: 0,
    startTime: 0,
    reset: () => {
      this.accumulator.count = 0;
      this.accumulator.startTime = performance.now();
    }
  };
  
  // Reset configuration
  private resetPrefixes = ['camera.', 'material.', 'scene.', 'lights.'];
  private noResetPrefixes = ['developer.', 'ui.', 'debug.'];
  
  constructor(engine: Engine) {
    this.engine = engine;
  }
}
```

## Execution Modes

### Interactive Mode
```typescript
private runInteractive(): void {
  // Real-time preview, no accumulation
  const frame = () => {
    if (!this.running || this.mode !== 'interactive') return;
    
    this.engine.renderFrame();
    
    // No accumulation increment
    // Maintain target FPS
    
    this.animationId = requestAnimationFrame(frame);
  };
  
  this.animationId = requestAnimationFrame(frame);
}
```

### Progressive Mode
```typescript
private runProgressive(): void {
  // Continuous accumulation
  this.accumulator.reset();
  
  const frame = () => {
    if (!this.running || this.mode !== 'progressive') return;
    
    this.engine.renderFrame();
    this.accumulator.count++;
    
    // Report progress periodically
    if (this.accumulator.count % 10 === 0) {
      this.onProgress?.({
        mode: 'progressive',
        samples: this.accumulator.count,
        elapsedTime: performance.now() - this.accumulator.startTime
      });
    }
    
    // Check convergence if configured
    if (this.config.targetSamples && this.accumulator.count >= this.config.targetSamples) {
      this.stop();
      return;
    }
    
    this.animationId = requestAnimationFrame(frame);
  };
  
  this.animationId = requestAnimationFrame(frame);
}
```

### Production Mode
```typescript
private async runProduction(): Promise<void> {
  // Tiled rendering for high resolution
  const tiles = this.generateTiles(this.config.resolution!, this.config.tiles!.tileSize);
  
  for (let i = 0; i < tiles.length; i++) {
    if (!this.running) break;
    
    const tile = tiles[i];
    this.engine.setViewport(tile.x, tile.y, tile.width, tile.height);
    
    // Reset for this tile
    this.accumulator.reset();
    
    // Render tile to target samples
    while (this.accumulator.count < this.config.tiles!.samplesPerTile) {
      if (!this.running) break;
      
      await this.engine.renderFrame();
      this.accumulator.count++;
      
      // Report tile progress
      this.onProgress?.({
        mode: 'production',
        currentTile: i + 1,
        totalTiles: tiles.length,
        tileProgress: this.accumulator.count / this.config.tiles!.samplesPerTile
      });
    }
    
    // Save tile if configured
    if (this.config.checkpoints?.enabled) {
      await this.saveTile(tile, i);
    }
  }
}
```

## Reset Logic

The coordinator owns the decision about when parameter changes require accumulation reset:

```typescript
shouldResetForParameter(path: string): boolean {
  // Check no-reset list first (higher priority)
  for (const prefix of this.noResetPrefixes) {
    if (path.startsWith(prefix)) return false;
  }
  
  // Check reset triggers
  for (const prefix of this.resetPrefixes) {
    if (path.startsWith(prefix)) return true;
  }
  
  // Default to reset for safety
  console.warn(`Unknown parameter ${path}, assuming reset needed`);
  return true;
}

resetAccumulation(): void {
  this.accumulator.reset();
  
  // Tell engine to clear film buffers
  this.engine.clearFilm();
  
  // Notify progress listeners
  this.onProgress?.({
    mode: this.mode,
    samples: 0,
    message: 'Accumulation reset'
  });
}
```

## Control Flow

```typescript
start(): void {
  if (this.running) return;
  
  this.running = true;
  
  switch (this.mode) {
    case 'interactive':
      this.runInteractive();
      break;
      
    case 'progressive':
      this.runProgressive();
      break;
      
    case 'production':
      this.runProduction().catch(error => {
        console.error('Production render failed:', error);
        this.stop();
      });
      break;
  }
}

stop(): void {
  this.running = false;
  
  if (this.animationId) {
    cancelAnimationFrame(this.animationId);
    this.animationId = undefined;
  }
  
  // Production mode handles its own stopping
}

setMode(mode: RenderMode): void {
  if (this.running) {
    this.stop();
  }
  
  this.mode = mode;
  
  // Mode-specific initialization
  if (mode === 'interactive') {
    this.accumulator.count = 0;  // No accumulation
  }
}
```

## Usage Example

```typescript
// Create coordinator
const coordinator = new RenderCoordinator(engine);

// Configure for progressive rendering
coordinator.configure({
  mode: 'progressive',
  targetSamples: 100,
  samplesPerPass: 1
});

// Set up progress reporting
coordinator.onProgress = (info) => {
  console.log(`Samples: ${info.samples}`);
  updateProgressBar(info.samples / 100);
};

// Wire up to parameter store
parameterStore.onChange = (changes) => {
  // Let coordinator decide about reset
  const needsReset = changes.changes.some(
    change => coordinator.shouldResetForParameter(change.path)
  );
  
  if (needsReset) {
    coordinator.resetAccumulation();
  }
};

// Start rendering
coordinator.start();

// Switch modes
coordinator.setMode('interactive');
coordinator.start();

// Production render
coordinator.setMode('production');
coordinator.configure({
  mode: 'production',
  resolution: [4096, 4096],
  tiles: {
    tileSize: 512,
    samplesPerTile: 1000
  }
});
coordinator.start();
```

## Key Responsibilities

1. **Manage render modes** - Switch between interactive/progressive/production
2. **Control execution** - Start/stop render loops
3. **Track accumulation** - Count samples and time
4. **Decide reset need** - Determine which parameters trigger reset
5. **Report progress** - Emit progress events for UI

## What RenderCoordinator Does NOT Do

- Touch WebGL or GPU
- Update uniforms
- Manage parameter state
- Create UI elements
- Handle file I/O

## Mode Characteristics

| Mode | Accumulation | Use Case | Frame Control |
|------|--------------|----------|---------------|
| Interactive | No | Camera movement, preview | 60 FPS target |
| Progressive | Yes | Quality rendering | Continuous |
| Production | Per-tile | Final output, huge resolution | Tiles with checkpoints |

## Invariants

1. Only one mode active at a time
2. Accumulation count resets to 0 on reset
3. Interactive mode never accumulates
4. Production mode resets per tile
5. Reset decision based on parameter path prefixes
6. Engine handles all GPU operations

## Integration

```
ParameterStore → RenderCoordinator.shouldResetForParameter()
                            ↓
                  RenderCoordinator.resetAccumulation()
                            ↓
                      Engine.clearFilm()

RenderCoordinator.start() → Engine.renderFrame() [loop]
```

The coordinator orchestrates rendering execution but delegates all GPU work to the Engine.
