# Controls System

The **controls system** defines how the camera frame is updated each frame, entirely on the CPU side. Controls are plugins like cameras, integrators, or scenes, but they typically contribute **no GLSL**. Instead, they expose an `update(ctx, dt)` method that manipulates the active geometry frame.

---

## Philosophy

- **CPU-side only.** Controls don’t inject GLSL; they update the camera frame before rendering.
- **Capability-driven.** If a plugin has an `update()` method, Tracer calls it every frame.
- **Geometry-agnostic.** Controls talk to whatever geometry runtime is active through the shared contract:
    ```ts
  moveLocal(frame, localVec, speed, dt)
  rotateLocal(frame, angularVec, rotSpeed, dt)
  stabilize(frame)
````

* **Deterministic & parameterized.** Behavior is driven by parameters and context, not hard-coded values.
* **Attach/detach.** Controls manage their own DOM listeners with `attach(el)` / `detach()`.

---

## How Tracer Uses Controls

1. `tracer.use(control)` — registers the control plugin.
2. `tracer.buildAll()` — compiles shader programs; controls don’t affect the GPU.
3. `tracer.frame()`:

   * (a) Applies control parameters
   * (b) Calls `control.update(ctx, dt)` to move/rotate the camera
   * (c) Draws the frame

Controls can be **enabled/disabled** at runtime using the parameter system:

```ts
tracer.setParameter("ctrl.keyboard", "enabled", true);
```

---

## Available Control Plugins

### 1. KeyboardControl

*File: `src/plugins/controls/KeyboardControl.ts`*

* **Style:** Keyboard-only “pilot” controls with keymap + smoothing.
* **Default layout (new):**

  * **Rotation:** WASD + QE (yaw/pitch + roll)
    → Roll is **enabled by default**.
  * **Translation:** Arrow keys + `'` (Quote) and `/` (Slash).
* **Modifiers:** Shift (boost), Ctrl (slow), R (stabilize).
* **Parameters:**

* `enabled` (boolean)
* `moveSpeed` (float, units/s)
* `rotSpeed` (angle, deg/s)
* `boostFactor`, `slowFactor`
* `invertY` (boolean)
* `rollEnabled` (boolean)
* `smoothing` (float; 0 = off)
* **Options:**

* `{ keymap?: Partial<KeyMap>, preventDefault?: boolean, attachTo?: HTMLElement }`
* **API:**

* `setKeyMap(partialOrFullMap)` — hot-swap bindings at runtime.

---

### 2. FPSControls

*File: `src/plugins/controls/FPSControls.ts`*

* **Style:** Pointer-lock mouse look + keyboard for movement.
                                                    * **Usage:** Click canvas to lock pointer, move mouse to yaw/pitch. WASD for translation, QE for roll.
                                                                                                                                                     * **Parameters:**

* `enabled`
* `moveSpeed`
* `rotSpeed` (keyboard)
* `mouseSensitivity` (deg/pixel)
* `boostFactor`, `slowFactor`
* `invertY`, `rollEnabled`, `smoothing`
* **Keymap (defaults):**

* Forward: W
* Back: S
* Left: A
* Right: D
* Up: Space
* Down: C
* Roll: Q/E
* Boost: Shift
* Slow: Ctrl
* Pointer lock toggle: P

---

### 3. OrbitControls

*File: `src/plugins/controls/OrbitControls.ts`*

* **Style:** Trackball-style orbit around a target with pan/zoom.
* **Inputs:**

* Left-drag: orbit
* Right-drag or Ctrl+Left: pan
* Wheel: zoom
* **Parameters:**

* `enabled`
* `target: vec3`
* `distance`, `minDistance`, `maxDistance`
* `invertY`
* `orbitSensitivity` (deg/pixel)
* `panPerPx` (world units/pixel)
* `zoomPerWheel` (scale factor)
* `damping` (smoothness)

---

## Example: Using Keyboard Controls

    ```ts
import Tracer from "./tracer/Tracer";
import { createEuclideanModule } from "./geometry/Euclidean/EuclideanModule";
import PinholeCamera from "./plugins/camera/PinholeCamera";
import SceneSDFDemo from "./scene/examples/SceneSDFDemo";
import Lambert from "./integrators/examples/LambertIntegrator";
import SRGB from "./plugins/display/SRGBDisplay";
import KeyboardControl from "./plugins/controls/KeyboardControl";

const tracer = new Tracer({ canvas, vertexSrc });
const { module: geo, frame } = createEuclideanModule();

tracer.use(geo.shader)
      .setContext({ geometry: { runtime: geo.runtime, frame } });

tracer.use(new PinholeCamera({ fovYDeg: 60, parameters: ["fov"] }));
tracer.use(new SceneSDFDemo());
tracer.use(new Lambert({ animate: true }));
tracer.use(new SRGB());

// Add controls
const controls = new KeyboardControl({ preventDefault: true });
tracer.use(controls);

tracer.buildAll();
```

Toggle roll on/off at runtime:

    ```ts
tracer.setParameter("ctrl.keyboard", "rollEnabled", true);
```

Swap key bindings at runtime:

    ```ts
controls.setKeyMap({ forward: "KeyI", back: "KeyK" });
```

---

## Switching Controls at Runtime

For some demos, you may register multiple controls but activate only one:

    ```ts
const kb = new KeyboardControl();
const fps = new FPSControls();
const orb = new OrbitControls();

tracer.use(kb).use(fps).use(orb);
tracer.buildAll();

function activate(ns, plugin) {
  tracer.setParameter("ctrl.keyboard", "enabled", false);
  tracer.setParameter("ctrl.fps", "enabled", false);
  tracer.setParameter("ctrl.orbit", "enabled", false);

  try { kb.detach(); } catch {}
  try { fps.detach(); } catch {}
  try { orb.detach(); } catch {}

  tracer.setParameter(ns, "enabled", true);
  plugin.attach(canvas);
}

// e.g. start with FPS:
activate("ctrl.fps", fps);
```

---

## Current Default KeyMap

    ```ts
// Rotation: WASD + QE
// Translation: arrows + Quote(')/Slash(/)
export const DefaultKeyMap = {
  forward: "ArrowUp",
  back:    "ArrowDown",
  left:    "ArrowLeft",
  right:   "ArrowRight",
  up:      "Quote",
  down:    "Slash",

  yawL:    "KeyA",
  yawR:    "KeyD",
  pitchU:  "KeyW",
  pitchD:  "KeyS",
  rollL:   "KeyQ",
  rollR:   "KeyE",

  boost:   "ShiftLeft",
  slow:    "ControlLeft",
  stabilize: "KeyR",
};
```

---

## Implementing Your Own Control

A minimal CPU-only control:

    ```ts
export default class MyControl implements Plugin {
  readonly role = "controls";
  readonly namespace = "ctrl.mycontrol";

  uniforms() { return []; }
  chunks()   { return []; }

  parameters() {
    return [{ name: "enabled", type: "boolean", default: true }];
  }
  applyParameters(view, ctx) {
    this.enabled = !!view.get("enabled");
  }

  attach(el) { window.addEventListener("keydown", this.onKey); }
  detach()   { window.removeEventListener("keydown", this.onKey); }

  update(ctx, dt) {
    if (!this.enabled || !ctx.geometry) return;
    const { runtime, frame } = ctx.geometry;
    runtime.rotateLocal(frame, { x: 0, y: 1, z: 0 }, 0.2, dt);
    runtime.stabilize?.(frame);
  }
}
```

---

## Tips & Gotchas

* **Q/E don’t work?** In `KeyboardControl` they map to roll. Make sure `rollEnabled` is true (it is by default now).
* **Prevent page scrolling:** Pass `{ preventDefault: true }` to `KeyboardControl` or `FPSControls` so arrow keys don’t scroll.
* **Disable controls during long renders:** Toggle `enabled` to false; geometry stops updating but plugin stays registered.
* **Determinism:** Keep randomness seeded if you want reproducible flythroughs.
* **Variants vs Controls:** Variants swap *shader* plugins; controls are independent. Manage them separately.

---

