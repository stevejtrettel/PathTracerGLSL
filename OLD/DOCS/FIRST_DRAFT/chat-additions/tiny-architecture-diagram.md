# Tiny Architecture Diagram

A compact view of how **App**, **Engine**, **Photography**, and **World** connect.

---

## ASCII (one screen)

```
        ┌────────────┐             ┌──────────────┐
        │    App     │             │    Engine    │
        │────────────│             │──────────────│
        │ Recipe     │             │ ShaderCompiler
        │ Parameter  │◄────────────┤ UniformBinder
        │ Coordinator│──────────┐  │ ResourceMgr
        │ Extensions │          │  │ RenderExec
        └─────┬──────┘          │  └───────┬──────┘
              │                 │          │
              │ parameters      │ uniforms │ FBOs/targets
              ▼                 │          ▼
        ┌────────────┐          │    ┌──────────────┐
        │ Photography│  GLSL    │    │    Film      │
        │ (Camera,   │◄─────────┼────┤ attachments  │
        │ Estimator, │   link   │    │ (GPU)        │
        │ Film, Dev) │──────────┼──► │ tonemap_out  │
        └─────┬──────┘          │    └──────────────┘
              │                 │
              │ calls           │ draw FS triangle
              ▼                 │
        ┌────────────┐          │
        │   World    │          │
        │ (Geom,     │          │
        │  Scene,    │          │
        │  Material, │          │
        │  Lights)   │          │
        └────────────┘          │
                                ▼
                         ┌──────────────┐
                         │    Display   │
                         └──────────────┘
```

---

## Mermaid (optional)

```mermaid
flowchart LR
  subgraph APP[App]
    R[Recipe] --> P[ParameterStore]
    C[RenderCoordinator]
    X[Extensions/Services]
  end

  subgraph ENG[Engine]
    SC[ShaderCompiler]
    UB[UniformBinder]
    RM[ResourceManager]
    RE[RenderExecutor]
  end

  subgraph PHOTO[Photography]
    Cam[Camera]
    Est[Estimator]
    Fil[Film]
    Dev[Developer]
  end

  subgraph WRLD[World]
    Geom[Geometry]
    Scn[Scene]
    Mat[Materials]
    Lgt[Lights]
  end

  R --> SC
  P --> UB
  C --> RE
  UB --> RE
  RM --> RE

  Est --> Scn
  Est --> Mat
  Est --> Lgt
  Cam --> Est
  Est --> Fil
  Dev --> RE

  RE -->|draw full-screen triangle| Display[(Display)]
```