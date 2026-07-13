# PathTracerGLSL

A WebGL2 **research path tracer** with a four-layer architecture (App → Engine → Compiler → Components) designed for swappable rendering research: exchange material models, transport techniques, and estimators from a registry, with a numeric witness suite guarding correctness.

## Status

All four layers are live. The **Compiler** (Analyze → Validate → Plan → Generate) emits a bespoke, function-shaped GLSL program per scene×strategy pair; **Components** (`src/components/`) is the swappable research library — materials (Lambert, smooth dielectric with the η² factor, GGX), homogeneous media (null interfaces, chromatic channel-MIS sampling, HG phase, equiangular NEE), area lights with full MIS, samplable environments (image + procedural, equirect/octahedral charts), and the generated transport loop. **Adding a material model or sampling technique is one folder + one registry line.** The measurement side is built too: `npm run witness` renders the durable GPU test registry (`tests/witnesses/` — furnace/Beer–Lambert/η² exact numbers, cross-strategy convergence gates, equal-spp noise comparisons) and every export embeds a reproducibility stamp (scene, strategy, parameters, spp, RNG salt, git hash).

Still Euclidean-only: heterogeneous media and curved spaces (H³, black-hole metrics) are the road ahead — their seams are pinned in [docs/fable-compiler-contracts.md](docs/fable-compiler-contracts.md).

See [docs/README.md](docs/README.md) for the documentation map and [CLAUDE.md](CLAUDE.md) for agent onboarding.

## Quick Start

```bash
npm install
npm run dev      # Dev server on port 3000 — the scene-suite gallery
npm run witness  # Numeric GPU test suite, headless (minutes; scene filters: npm run witness -- furnace eta)
npx vitest run   # Structure tests + glslang static compile of every registry pair
npm run build    # Production build
```

Open the dev server and you'll see the scene-suite gallery: witness scenes (each card states its derived pass criterion) plus demos. Click a card to render it in the lab — orbit controls, keys 1-9 switch estimators, `r` resets accumulation.

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
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│                 COMPONENTS LAYER (leaf)               │
│  src/components/ — the swappable research library:    │
│  materials, lights, phase, geometry, transport, env,  │
│  sampler, camera, film — GLSL occupants + registries  │
└──────────────────────────────────────────────────────┘
```

`App` is a thin facade (~400 lines) delegating to internal managers. The engine is completely decoupled from scenes and rendering algorithms — it only executes `CompiledRenderer` objects, self-contained specifications of shaders, framebuffers, render passes, and uniform bindings.

## Example

```typescript
import { App } from './src/app/index.js';
import { cornellBox, cornellStrategy } from './tests/witnesses/scenes/cornellBox.js';
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

(This is the pattern [pages/scene-lab.ts](pages/scene-lab.ts) uses for every suite entry; the fixture imported here lives in [tests/witnesses/scenes/cornellBox.ts](tests/witnesses/scenes/cornellBox.ts).)

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
| [CLAUDE.md](CLAUDE.md) | Agent onboarding — current state, conventions, gotchas, doc map |
| [docs/README.md](docs/README.md) | Full documentation index |
| [docs/fable-compiler-contracts.md](docs/fable-compiler-contracts.md) | GLSL contracts governing all compiler work (+ migration roadmap) |
| [docs/compiler-engine-contract.md](docs/compiler-engine-contract.md) | Locked compiler-engine contract |
| [tests/witnesses/README.md](tests/witnesses/README.md) | The GPU witness system — gate policy, adding a witness |

## Tech Stack

- WebGL2 / GLSL 300 es
- TypeScript (strict)
- Vite
- No frameworks — pure WebGL2, no three.js
