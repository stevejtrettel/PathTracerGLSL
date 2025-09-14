/**
 * Purpose: Wrap an FBO with named color/depth attachments and completeness checks.
 * Public contract: class Framebuffer { attachColor(slot, texture); bind(gl); unbind(gl); dispose(gl); }
 * Inputs: GL textures from ResourcePool, depth/stencil options.
 * Outputs: A complete FBO ready for Pass targets.
 * Lifecycle: Created when a pass needs an offscreen target; revalidated after resize/reattach.
 * Invariants: No draw calls; asserts GL_FRAMEBUFFER_COMPLETE; attachment ownership remains with ResourcePool.
 */
