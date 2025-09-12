# Camera Plugin Documentation

## Overview

Camera plugins provide the `generateRay()` function that creates rays from screen coordinates. The system currently includes two camera types with different characteristics.

## Pinhole Camera

Simple camera with perfect focus everywhere (infinite depth of field).

### Usage

```typescript
import PinholeCameraPlugin from "./camera/PinholeCamera";

// Basic usage - fixed FOV
tracer.use(new PinholeCameraPlugin({ 
  fovYDeg: 60 
}));

// With adjustable FOV parameter
tracer.use(new PinholeCameraPlugin({ 
  fovYDeg: 60,
  parameters: ['fov']
}));

// All parameters exposed
tracer.use(new PinholeCameraPlugin({ 
  fovYDeg: 45,
  parameters: true
}));
```

### Options

- **fovYDeg**: Field of view in degrees (default: 60)
- **parameters**: Which parameters to expose for runtime control
    - `false` or omitted: No parameters (fixed camera)
    - `['fov']`: Expose field of view
    - `true`: Expose all available parameters

### Exposed Parameters

When enabled, the FOV parameter provides:
- Range: 10° to 120°
- UI: Slider control
- Units: Degrees (converted to radians internally)

### Characteristics

- Everything in perfect focus
- No depth of field effects
- Good for architectural visualization
- Fast rendering (single ray per pixel)

## Thin Lens Camera

Physically-based camera with depth of field effects.

### Usage

```typescript
import ThinLensCameraPlugin from "./camera/ThinLensCamera";

// Photographer-style with f-stop
tracer.use(new ThinLensCameraPlugin({
  fovYDeg: 60,
  fStop: 2.8,
  focusDistance: 5,
  parameters: ['fStop', 'focusDistance']
}));

// Direct aperture control
tracer.use(new ThinLensCameraPlugin({
  fovYDeg: 60,
  aperture: 0.02,      // In world units (meters)
  focusDistance: 5,
  parameters: ['aperture', 'focusDistance']
}));

// Full control
tracer.use(new ThinLensCameraPlugin({
  fovYDeg: 60,
  fStop: 1.4,
  focusDistance: 3,
  parameters: true     // All parameters
}));

// Pinhole mode (tiny aperture)
tracer.use(new ThinLensCameraPlugin({
  fovYDeg: 60,
  aperture: 0,         // Acts like pinhole
  focusDistance: 5
}));
```

### Options

- **fovYDeg**: Field of view in degrees (default: 60)
- **aperture**: Physical aperture radius in world units (meters)
- **fStop**: Alternative to aperture - sets via f-stop number
- **focalLengthMM**: Focal length in mm (default: 50), used for f-stop calculation
- **focusDistance**: Distance to focal plane in world units (default: 5)
- **parameters**: Which parameters to expose

### Aperture Control Methods

The thin lens camera offers two ways to control aperture:

#### 1. Direct Aperture (Physical)
```typescript
aperture: 0.02  // 2cm radius opening
```
- Direct control over blur amount
- Linear relationship with DOF strength
- Good for programmatic control

#### 2. F-Stop (Photographic)
```typescript
fStop: 2.8
focalLengthMM: 50
```
- Familiar to photographers
- Standard stops: 1.0, 1.4, 2.0, 2.8, 4.0, 5.6, 8.0, 11, 16, 22
- Aperture calculated as: `focalLength / (2 * fStop)`

### Exposed Parameters

Available parameters when enabled:

- **fov**: Field of view (10° - 120°)
- **aperture**: Direct aperture size (0 - 0.1m)
- **fStop**: F-stop value (dropdown with standard stops)
- **focusDistance**: Distance to focal plane (0.1 - 50m)

### Depth of Field Effects

DOF strength depends on:
1. **Aperture size**: Larger = more blur
2. **Focus distance**: Objects at this distance are sharp
3. **Distance from focal plane**: Further = more blur

### Common Setups

#### Portrait Photography
```typescript
{
  focalLengthMM: 85,
  fStop: 1.4,           // Wide open for bokeh
  focusDistance: 2,     // Focus on subject
  parameters: ['fStop', 'focusDistance']
}
```

#### Landscape Photography
```typescript
{
  focalLengthMM: 24,
  fStop: 8,             // Small aperture for deep focus
  focusDistance: 10,    // Hyperfocal distance
  parameters: ['fStop']
}
```

#### Macro Photography
```typescript
{
  focalLengthMM: 100,
  fStop: 2.8,
  focusDistance: 0.3,   // Very close focus
  parameters: ['focusDistance', 'fStop']
}
```

## Camera Selection Guide

### Use Pinhole When:
- You need everything in focus
- Rendering performance is critical
- Creating technical/architectural visualizations
- Debugging scenes (simpler ray generation)

### Use Thin Lens When:
- You want realistic depth of field
- Creating photographic-style renders
- Need selective focus for artistic effect
- Simulating real camera behavior

## Implementation Notes

### Ray Generation

Both cameras transform from film UV coordinates [0,1]² to rays:

1. Convert UV to normalized device coordinates [-1,1]²
2. Account for aspect ratio
3. Apply field of view
4. Generate ray in camera space
5. Transform to world space using camera frame

### Depth of Field Sampling

The thin lens camera currently uses deterministic sampling based on fragment coordinates. For better quality:
- Future: Integrate with accumulation system
- Use random/quasi-random sampling per frame
- Accumulate multiple samples over time

### Camera Frame

Both cameras read the camera frame from context:
```typescript
ctx.geometry.frame = {
  p: position,   // Camera position
  f: forward,    // Look direction
  u: up,         // Up vector
  r: right       // Right vector
}
```

This frame is typically controlled by a controls plugin or set programmatically.

## Examples with UI Controls

### Simple FOV Control
```typescript
// In main.ts after tracer.build()
const slider = document.createElement('input');
slider.type = 'range';
slider.min = '10';
slider.max = '120';
slider.value = '60';
slider.addEventListener('input', () => {
  tracer.setParameter('cam.pinhole', 'fov', parseFloat(slider.value));
});
document.body.appendChild(slider);
```

### DOF Controls
```typescript
// Focus distance slider
const focusSlider = createSlider(0.1, 50, 5);
focusSlider.addEventListener('input', () => {
  tracer.setParameter('cam.thinlens', 'focusDistance', parseFloat(focusSlider.value));
});

// F-stop dropdown
const fStopSelect = createDropdown([1.4, 2, 2.8, 4, 5.6, 8, 11, 16]);
fStopSelect.addEventListener('change', () => {
  tracer.setParameter('cam.thinlens', 'fStop', parseFloat(fStopSelect.value));
});
```
