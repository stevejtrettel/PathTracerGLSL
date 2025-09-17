
## App Pillar File Tree

```
app/
├── core/
│   ├── ResearchApp.ts          # Main orchestrator class
│   ├── ParameterStore.ts       # Central state management
│   ├── RenderCoordinator.ts    # Render execution control
│   ├── SessionManager.ts       # Save/load functionality
│   ├── EventBus.ts            # Simple event emitter
│   └── ServiceRegistry.ts      # Extension service management
│
├── extensions/
│   ├── base/
│   │   └── Extension.ts        # Base extension interface
│   │
│   └── core/                   # Minimal essential extensions
│       ├── InputController.ts  # Basic camera controls (WASD+mouse)
│       └── SimpleUI.ts         # Minimal parameter display
│
├── types/
│   ├── Recipe.ts               # Recipe type definitions
│   ├── Parameter.ts            # Parameter metadata types
│   ├── Session.ts              # Session format types
│   ├── Events.ts               # Event type definitions
│   └── Extension.ts            # Extension interfaces
│
├── utils/
│   ├── Validators.ts           # Parameter validation
│   ├── FileIO.ts              # Browser/Node file operations
│   └── Debounce.ts            # Throttling utilities
│
├── __tests__/
│   ├── ParameterStore.test.ts
│   ├── RenderCoordinator.test.ts
│   └── ServiceRegistry.test.ts
│
└── index.ts                    # Public API exports
```

## Engine Pillar File Tree

```
engine/
├── core/
│   ├── Engine.ts               # Main GPU orchestrator
│   ├── GLState.ts              # WebGL state management
│   ├── GLContext.ts            # Context creation & capabilities
│   └── DrawCall.ts             # Encapsulated draw operations
│
├── compilation/
│   ├── ShaderCompiler.ts       # GLSL compilation pipeline
│   ├── ProgramCache.ts         # Compiled program storage
│   ├── ModuleLinker.ts         # Module dependency resolution
│   ├── GLSLPreprocessor.ts     # Include/macro processing
│   └── stages/
│       ├── CollectStage.ts     # Gather modules
│       ├── ValidateStage.ts    # Check dependencies
│       ├── AssembleStage.ts    # Build GLSL source
│       ├── CompileStage.ts     # Compile shaders
│       └── LinkStage.ts        # Link program
│
├── resources/
│   ├── UniformManager.ts       # Uniform tracking & updates
│   ├── UniformBuffer.ts        # UBO management (if using)
│   ├── TextureManager.ts       # Texture allocation
│   ├── FramebufferManager.ts   # Render targets
│   └── BufferManager.ts        # Vertex/index buffers
│
├── execution/
│   ├── RenderPass.ts           # Single pass execution
│   ├── RenderPipeline.ts       # Multi-pass orchestration
│   ├── ViewportManager.ts      # Viewport/scissor for tiling
│   └── TimingQuery.ts          # GPU performance timing
│
├── types/
│   ├── Recipe.ts               # Recipe → GPU translation types
│   ├── Uniforms.ts             # Uniform type definitions
│   ├── Program.ts              # Shader program types
│   ├── Resources.ts            # Buffer/texture types
│   └── Errors.ts               # Engine error types
│
├── templates/
│   ├── vertex/
│   │   └── fullscreen.glsl     # Fullscreen quad vertex shader
│   │
│   └── fragment/
│       ├── main_progressive.glsl    # Progressive accumulation main()
│       ├── main_interactive.glsl    # Single-sample main()
│       └── main_production.glsl     # Tiled rendering main()
│
├── utils/
│   ├── GLEnums.ts              # WebGL constant mappings
│   ├── ShaderError.ts          # Shader error parsing
│   ├── Diagnostics.ts          # Debug & validation helpers
│   └── PixelReader.ts          # Read pixels for screenshots
│
├── __tests__/
│   ├── ShaderCompiler.test.ts
│   ├── UniformManager.test.ts
│   ├── ProgramCache.test.ts
│   └── fixtures/
│       └── test_shaders.glsl
│
└── index.ts                    # Public API exports
```

## Key Files to Implement First

### App Priority Order:
1. `EventBus.ts` - Needed by everything
2. `ParameterStore.ts` - Core state
3. `RenderCoordinator.ts` - Render loop
4. `ResearchApp.ts` - Ties it together

### Engine Priority Order:
1. `GLContext.ts` - WebGL setup
2. `ShaderCompiler.ts` - Compile shaders
3. `UniformManager.ts` - Update uniforms
4. `Engine.ts` - Main interface
