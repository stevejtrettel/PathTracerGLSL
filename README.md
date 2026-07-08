# PathTracerGLSL

A WebGL2 path tracer with a three-layer architecture (Compiler → Engine → App) designed for flexibility and real-time experimentation.

## Status

The **App** and **Engine** layers are complete. The **Compiler** layer contains a first vertical slice ("step zero"): a genuine Analyze → Validate → Plan → Generate pipeline (`src/compiler/`) that generates GLSL from scene descriptions — but only for the minimal case (Euclidean space, SDF sphere/plane/box, Lambert, point lights + NEE, pinhole, average accumulation, Reinhard). **The real compiler — volumes, swappable material/transport models, multi-region objects, curved spaces — is the work ahead**, designed and pinned in [docs/fable-compiler-contracts.md](docs/fable-compiler-contracts.md) with its §10.1 migration roadmap as the implementation sequence. The old `SimpleCompiler` (hardcoded GLSL) lives in `reference/` as source material only.

See [docs/README.md](docs/README.md) for the documentation map and [CLAUDE.md](CLAUDE.md) for agent onboarding.

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
│  ├── ProductionOrchestrator — production lifecycle    │
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
│  Compiler: Analyze → Validate → Plan → Generate       │
│  SceneDescription + RenderStrategy → CompiledRenderer │
└──────────────────────────────────────────────────────┘
```

`App` is a thin facade (~400 lines) delegating to internal managers. The engine is completely decoupled from scenes and rendering algorithms — it only executes `CompiledRenderer` objects, self-contained specifications of shaders, framebuffers, render passes, and uniform bindings.

## Example

```typescript
import { App } from './src/app/index.js';
import { cornellBox, cornellStrategy } from './src/compiler/scenes/cornellBox.js';
import { OrbitControls, StatsPanel, AppShortcutsExtension } from './src/app/extensions/index.js';

const app = App.create(document.body, { layout: 'fullscreen' });

await app.initialize({
    scene: cornellBox,               // full SceneDescription: objects, materials, lights, ambientSpace
    strategies: [cornellStrategy],   // full RenderStrategy: transport, camera, accumulation, display
    initialParameters: {
        'camera.position': [0, 1, 4],
        'camera.target': [0, 1, 0],
    },
});

app.use(new OrbitControls());
app.use(new StatsPanel());
app.use(new AppShortcutsExtension());
app.start();
```

(This is [examples/cornell-box.ts](examples/cornell-box.ts), the entry point `npm run dev` serves. Note: the legacy `STRATEGY_PRESETS` in `src/app/types.ts` predate the real compiler and do not produce valid strategies — see TODO.md cleanup.)

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
| [CLAUDE.md](CLAUDE.md) | Agent onboarding — conventions, gotchas, doc map |
| [docs/README.md](docs/README.md) | Full documentation index |
| [docs/fable-compiler-contracts.md](docs/fable-compiler-contracts.md) | GLSL contracts governing all compiler work (+ migration roadmap) |
| [docs/compiler-system.md](docs/compiler-system.md) | The compiler as built (vertical slice) |
| [docs/compiler-engine-contract.md](docs/compiler-engine-contract.md) | Locked compiler-engine contract |

## Tech Stack

- WebGL2 / GLSL 300 es
- TypeScript (strict)
- Vite
- No frameworks — pure WebGL2, no three.js
