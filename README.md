# PathTracerGLSL

A WebGL2 path tracer with a three-layer architecture (Compiler → Engine → App) designed for flexibility and real-time experimentation.

## Status

The **App** and **Engine** layers are complete. The **Compiler** is currently a placeholder (`SimpleCompiler`) that produces hardcoded GLSL for a few strategies. The next major milestone is building the real Compiler that generates shaders from scene descriptions.

See [docs/architecture.md](docs/architecture.md) for a detailed breakdown of what's built vs what's planned.

## Quick Start

```bash
npm install
npm run dev     # Dev server on port 3000
npm run build   # Production build
npm run test    # Run tests
```

Open the dev server and you'll see a Cornell Box path tracer with interactive controls.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      APP LAYER                        │
│  App (thin facade)                                    │
│  ├── RendererManager     — compilation & switching    │
│  ├── ProductionRenderManager — production lifecycle   │
│  ├── RenderCoordinator   — render loop & modes        │
│  ├── ParameterStore      — centralized state          │
│  ├── EventBus + events.ts — typed pub/sub             │
│  └── Extensions          — modular UI & controls      │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│                    ENGINE LAYER                        │
│  Engine, ResourceManager, RenderExecutor,             │
│  ParameterManager, GPUProfiler, TextureRegistry       │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│                   COMPILER LAYER                      │
│  SimpleCompiler (placeholder)                         │
│  SceneDescription + RenderStrategy → CompiledRenderer │
└──────────────────────────────────────────────────────┘
```

`App` is a thin facade (~400 lines) delegating to internal managers. The engine is completely decoupled from scenes and rendering algorithms — it only executes `CompiledRenderer` objects, self-contained specifications of shaders, framebuffers, render passes, and uniform bindings.

## Example

```typescript
import { App, STRATEGY_PRESETS } from './src/app/index.js';
import { OrbitControls, StatsPanel, AppShortcutsExtension } from './src/app/extensions/index.js';

const app = App.create(document.body, { layout: 'fullscreen' });

await app.initialize({
    scene: { id: 'cornell-box', name: 'Cornell Box' },
    strategies: [
        STRATEGY_PRESETS['pathtracer-full'].strategy,
        STRATEGY_PRESETS.pathtracer.strategy,
        STRATEGY_PRESETS['debug-aovs'].strategy
    ]
});

app.use(new OrbitControls());
app.use(new StatsPanel());
app.use(new AppShortcutsExtension());
app.start();
```

## Keyboard Controls

| Key | Action |
|-----|--------|
| 1/2/3 | Switch between renderers |
| r | Reset accumulation |
| Space | Toggle rendering |
| Tab | Toggle parameter panel |
| i | Toggle stats |
| x / Shift+X | Export PNG / HDR |

## Features

- **Multiple Strategies** — Switch instantly between debug, direct lighting, and full path tracing
- **Progressive Rendering** — Interactive mode with live preview, production mode for high-quality output
- **Live Parameters** — Real-time controls with automatic accumulation reset
- **MRT / AOVs** — Multiple render targets for albedo, normals, depth output
- **Tiled Rendering** — Render high-resolution images in tiles
- **Extensions** — Modular features via clean plugin interface
- **Session Management** — Save/restore complete render state
- **GPU Profiling** — Per-pass timing

## Documentation

| File | Description |
|------|-------------|
| [TODO.md](TODO.md) | Active task list |
| [docs/architecture.md](docs/architecture.md) | Full technical architecture reference |
| [docs/compiler-engine-contract.md](docs/compiler-engine-contract.md) | Locked compiler-engine contract |
| [docs/architecture-decisions.md](docs/architecture-decisions.md) | Summary of locked decisions |
| [docs/](docs/) | UI components, layout system, production rendering |

## Tech Stack

- WebGL2 / GLSL 300 es
- TypeScript (strict)
- Vite
- No frameworks — pure WebGL2, no three.js
