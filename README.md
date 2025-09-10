# Modular Path Tracer

This project is a **rendering laboratory** designed for mathematical clarity and modularity.  
Core principles:

- **Geometry-first**: shaders compile *for a geometry platform* (Euclidean, hyperbolic, spherical).
- **Plugin model**: cameras, integrators, displays, controls are modular, swappable units.
- **Textbook readability**: code mirrors mathematics; each component has a single responsibility.
- **Clean layering**:
  - `core` = declarative engine (no GPU, no strings).
  - `systems` = mechanics (shader assembly, uniform binding).
  - `rendering` = WebGL helpers (ProgramCache, FullscreenQuad).
  - `tracer` = ergonomic façade (`Tracer`) for building/running pipelines.

---

## Documentation

- [about.md](src/info/about.md) — **Big picture overview**  
  Philosophy, plugin architecture, geometry-first shader model, and the **future file tree** with division of labor.

- [current.md](src/info/current.md) — **Current build status**  
  What is already implemented, what is in progress, and the **next concrete steps**.

---

## 🔧 Development Setup

```bash
# install dependencies
npm install

# run dev server
npm run dev

# build for production
npm run build
```

---

## 🚀 Quick Start

Open `src/main.ts` to see the current demo.  
You can run it with Vite:

```bash
npm run dev
```

This launches a browser window with the current tracer demo.

---


## 🖥️ Typical Usage Example

The design goal is to configure and run the tracer with just a few lines of code:

```ts
import Tracer from "./app/Tracer";
import fullscreenVert from "./glsl/fullscreen.vert";

// Plugins
import EuclideanGeometryPlugin from "./geometry/EuclideanGeometryPlugin";
import PinholeCameraPlugin from "./camera/PinholeCameraPlugin";
import NormalsIntegrator from "./integration/NormalsIntegrator";
import SRGBDisplayPlugin from "./display/SRGBDisplayPlugin";

// Setup canvas + tracer
const canvas = document.createElement("canvas");
document.body.appendChild(canvas);

const tracer = new Tracer({ canvas, vertexSrc: fullscreenVert });

// Configure pipeline
tracer
  .use(new EuclideanGeometryPlugin())
  .use(new PinholeCameraPlugin({ fov: 60 }))
  .use(new NormalsIntegrator())
  .use(new SRGBDisplayPlugin())
  .build();

// Main loop
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  tracer.setSize(canvas.width, canvas.height);
}
window.addEventListener("resize", resize);
resize();

(function loop() {
  tracer.frame();
  requestAnimationFrame(loop);
})();
```

This example shows the **intended usage**: swap geometry, camera, integrator, and display independently without touching the engine or systems. 

---
