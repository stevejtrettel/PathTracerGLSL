
# Phase 3: World Compilation - Conceptual Overview

## The Core Problem We're Solving

Right now our scene is hardcoded GLSL - a single sphere baked into the shader. This is useless for research. We need to transform scene *descriptions* (data) into executable GLSL (code). This is the heart of what makes our renderer programmable.

## Why Compilation?

**The Fundamental Tension**:
- GPUs want static code with no dynamic allocation
- Researchers want flexible, data-driven scenes
- We bridge this gap by compiling scene data → shader code at runtime

Think of it like a specialized compiler that takes:
```
Input: "sphere at origin with radius 1"
Output: "if (intersectSphere(ray, vec3(0,0,0), 1.0, hit)) { ... }"
```

## Phase 3 Sub-Problems

### 3.1: The Compilation Architecture
**What needs solving**: How do we organize a system that transforms data to code?

**Key insights**:
- Scene descriptions are hierarchical (objects contain materials, transforms)
- GLSL needs flat arrays (no dynamic allocation)
- We need deterministic indexing (material 3 is always material 3)
- Compilation happens once, runs many frames

**Design decisions**:
- Separate compilers for Scene vs Lighting (different concerns)
- Output is GLSL strings, not AST (simpler for our needs)
- Fixed array sizes (allocate maximum, use what we need)

### 3.2: Scene Compilation Strategy
**The challenge**: Transform object descriptions into intersection code

**What this really means**:
- Loop unrolling (N objects → N if-statements)
- Material ID assignment (which object has which material?)
- Acceleration structure generation (BVH? Grid? None?)
- Constant propagation (known positions become literals)

**Why it matters**:
- Dynamic loops in shaders are slow
- Branch prediction works better with unrolled code
- Compile-time optimization > runtime flexibility

### 3.3: Material System Design
**The real question**: How do materials reference lights and vice versa?

In path tracing, emissive materials ARE lights. This creates circular dependency:
- Scene needs materials (for shading)
- Materials can be emissive (become lights)
- Lights need to reference materials (for NEE)

**Solution approach**:
- Materials get compiled with scene
- Emissive materials get indexed during compilation
- Light compiler builds lookup table
- Runtime uses indices, not pointers

### 3.4: The Cross-Reference Problem
**What breaks**: How does the light sampler know which triangles are lights?

Traditional approach (doesn't work in GLSL):
- Keep list of emissive triangles
- Sample from list
- Problem: dynamic arrays not allowed

Our approach:
- Compiler builds static array of light indices
- Compiler generates sampling CDFs
- Shader uses pre-computed structures

## What Makes This Hard?

1. **No Pointers**: GLSL has no pointers, so we use indices everywhere
2. **No Allocation**: Everything must be statically sized
3. **No Recursion**: Scene graphs must be flattened
4. **No Polymorphism**: Each material type needs explicit code
5. **Cross-Referencing**: Materials ↔ Lights coupling

## Success Metrics for Phase 3

- Can describe scenes in TypeScript/JSON
- Can change scene without touching GLSL
- Can have multiple materials in one scene
- Area lights work automatically from emissive materials
- Performance comparable to hardcoded version

## What We're Deliberately NOT Solving

- Hot reloading (compile once, run many)
- Procedural geometry (just primitives)
- Instancing (copy objects in description)
- Level-of-detail (always full quality)
- Streaming (entire scene in shader)

## The Philosophical Shift

Phase 1-2: "How do we make a path tracer?"
Phase 3: "How do we make a path tracer GENERATOR?"

We're building a compiler that writes path tracers for us. Each scene gets its own specialized shader, optimized for exactly those objects and materials.

