/**
 * Purpose: Encapsulate canvas + WebGL2 context creation and common GL state (viewport, clear color) with a small logging facility.
 * Public contract: class Context { gl; canvas; width; height; log(); capabilities(); }
 * Inputs: HTMLCanvasElement, desired context attributes.
 * Outputs: A configured WebGL2RenderingContext and basic capability info.
 * Lifecycle: create on startup; update size on resize; destroy on teardown.
 * Invariants: Single GL context owner; does not compile/link shaders or allocate textures; thread-safe re: resize calls.
 */
