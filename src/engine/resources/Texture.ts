/**
 * Purpose: Thin wrapper around a 2D texture with size/format metadata and safe (re)creation.
 * Public contract: class Texture { create(gl, w,h, format); bind(unit); resize(gl,w,h); dispose(gl); }
 * Inputs: WebGL2 context, width/height, GL format and parameters.
 * Outputs: GL texture object with known lifetime.
 * Lifecycle: Created on demand; reused via ResourcePool; reallocated on resize or format change.
 * Invariants: No implicit FBO creation; never reads back from GPU; parameters validated against capabilities.
 */
