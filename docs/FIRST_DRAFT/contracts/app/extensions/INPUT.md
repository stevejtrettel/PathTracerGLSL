# Input Extension Contract

Input extensions manage camera controls and user input for navigation.

## Extended Interface

Input extensions implement the base Extension interface and provide camera state access:

```typescript
interface InputExtension extends Extension {
  // Required: Current camera state
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
  
  // Optional: Control mode switching
  setMode?(mode: ControlMode): void;
  getMode?(): ControlMode;
  
  // Optional: Input sensitivity
  setSensitivity?(value: number): void;
  setSpeed?(value: number): void;
}

interface CameraState {
  position: [number, number, number];
  rotation?: [number, number, number];  // Euler angles
  target?: [number, number, number];     // For orbit mode
  up?: [number, number, number];         // Up vector
}

type ControlMode = 'fly' | 'orbit' | 'turntable' | 'locked';
```

## Standard Behavior

All input extensions should:
1. Update `camera.*` parameters in ParameterStore
2. Emit `camera.updated` events when camera moves
3. Reset accumulation on camera movement
4. Support smooth transitions between positions

## Event Protocol

### Emitted Events
```typescript
// Camera has moved
bus.emit('camera.updated', {
  state: CameraState,
  delta?: CameraState,  // Change from previous
  source: 'keyboard' | 'mouse' | 'gamepad' | 'animation'
});

// Control mode changed
bus.emit('camera.mode_changed', {
  mode: ControlMode,
  previous: ControlMode
});
```

### Listened Events
```typescript
// Request camera movement
bus.on('camera.move_to', (state: CameraState) => {
  this.animateTo(state);
});

// Request control mode change
bus.on('camera.set_mode', (mode: ControlMode) => {
  this.setMode(mode);
});
```

## Control Schemes

### Fly Mode
WASD + mouse look (FPS-style):
```typescript
class FlyControls implements InputExtension {
  name = 'fly-controls';
  dependencies = [];  // Input controls are independent
  
  private position = [0, 0, 5];
  private rotation = [0, 0, 0];
  private velocity = [0, 0, 0];
  
  install(app: ResearchApp, bus: EventEmitter) {
    // WASD for movement
    document.addEventListener('keydown', (e) => {
      switch(e.key) {
        case 'w': this.velocity[2] = -this.speed; break;
        case 's': this.velocity[2] = this.speed; break;
        case 'a': this.velocity[0] = -this.speed; break;
        case 'd': this.velocity[0] = this.speed; break;
      }
    });
    
    // Mouse for rotation
    canvas.addEventListener('mousemove', (e) => {
      if (this.mousePressed) {
        this.rotation[1] += e.movementX * this.sensitivity;
        this.rotation[0] += e.movementY * this.sensitivity;
        this.updateCamera();
      }
    });
  }
  
  getCamera(): CameraState {
    return { 
      position: this.position,
      rotation: this.rotation 
    };
  }
}
```

### Orbit Mode
Rotate around target point:
```typescript
class OrbitControls implements InputExtension {
  name = 'orbit-controls';
  dependencies = [];  // Input controls are independent
  
  private target = [0, 0, 0];
  private distance = 5;
  private theta = 0;  // Horizontal angle
  private phi = Math.PI / 4;  // Vertical angle
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Mouse drag to orbit
    canvas.addEventListener('mousemove', (e) => {
      if (this.mousePressed) {
        this.theta += e.movementX * 0.01;
        this.phi = clamp(this.phi + e.movementY * 0.01, 0.1, Math.PI - 0.1);
        this.updateCamera();
      }
    });
    
    // Scroll to zoom
    canvas.addEventListener('wheel', (e) => {
      this.distance *= 1 + e.deltaY * 0.001;
      this.updateCamera();
    });
  }
  
  private updateCamera() {
    const x = this.distance * Math.sin(this.phi) * Math.cos(this.theta);
    const y = this.distance * Math.cos(this.phi);
    const z = this.distance * Math.sin(this.phi) * Math.sin(this.theta);
    
    this.position = [
      this.target[0] + x,
      this.target[1] + y,
      this.target[2] + z
    ];
    
    app.parameterStore.batch({
      'camera.position': this.position,
      'camera.target': this.target
    });
  }
}
```

## Animation Support

Input extensions can provide smooth transitions:

```typescript
class AnimatedInputExtension implements InputExtension {
  async animateTo(target: CameraState, duration: number = 1000) {
    const start = this.getCamera();
    const startTime = performance.now();
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      
      // Smooth ease-in-out
      const ease = t < 0.5 
        ? 2 * t * t 
        : -1 + (4 - 2 * t) * t;
      
      this.position = lerp3(start.position, target.position, ease);
      this.updateCamera();
      
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.bus.emit('camera.animation_complete');
      }
    };
    
    animate();
  }
}
```

## Saved Positions

Input extensions should support bookmarking views:

```typescript
interface SavedView {
  name: string;
  state: CameraState;
  timestamp?: number;
}

class BookmarkableInput implements InputExtension {
  private bookmarks: Map<string, SavedView> = new Map();
  
  saveView(name: string) {
    this.bookmarks.set(name, {
      name,
      state: this.getCamera(),
      timestamp: Date.now()
    });
  }
  
  loadView(name: string) {
    const view = this.bookmarks.get(name);
    if (view) {
      this.animateTo(view.state);
    }
  }
  
  listViews(): SavedView[] {
    return Array.from(this.bookmarks.values());
  }
}
```

## Integration Example

```typescript
const app = new ResearchApp(canvas);

// Add input controls
const controls = new OrbitControls({
  sensitivity: 0.5,
  speed: 0.1,
  smoothing: true
});

app.use(controls);

// Switch modes programmatically
controls.setMode('fly');

// Get current camera for saving
const camera = controls.getCamera();
sessionManager.saveCamera(camera);

// Animate to saved position
controls.animateTo(savedCamera, 2000);
```

## Best Practices

1. **Always update through ParameterStore** - Don't bypass the central state
2. **Emit events for camera changes** - Other extensions may need to know
3. **Support multiple control schemes** - Different tasks need different controls
4. **Smooth movement** - Avoid jarring transitions
5. **Save/restore camera state** - Part of session management
6. **Respect existing parameters** - Read initial camera position from ParameterStore
