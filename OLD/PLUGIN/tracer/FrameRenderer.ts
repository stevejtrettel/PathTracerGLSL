// src/tracer/FrameRenderer.ts
import type { Plugin, PipelineContext } from "../core/types";
import type { CompiledPipeline } from "./types";
import UniformManager from "../systems/UniformManager";
import FullscreenQuad from "../rendering/FullscreenQuad";
import { ProgressiveRenderer } from "./ProgressiveRenderer";

export class FrameRenderer {
    private gl: WebGL2RenderingContext;
    private quad: FullscreenQuad;
    private progressive?: ProgressiveRenderer;
    private vertexSrc: string;

    constructor(gl: WebGL2RenderingContext, vertexSrc: string) {
        this.gl = gl;
        this.vertexSrc = vertexSrc;
        this.quad = new FullscreenQuad(gl);
    }

    /** Render a frame using the compiled pipeline */
    render(compiled: CompiledPipeline, ctx: PipelineContext, canvas: HTMLCanvasElement): void {
        // Use pipeline program
        compiled.program.use();

        // Set global uniforms (no prefix)
        const noPrefix = new UniformManager(this.gl, compiled.program, "");
        noPrefix.set2f("u_resolution", canvas.width, canvas.height);

        // Determine render path
        const integrator = this.findRolePlugin(compiled, "integrator");
        const isProgressive = !!(integrator && (integrator as any).progressive === true);

        // Set per-plugin uniforms
        for (const p of compiled.plugins) {
            const view = compiled.nsViews.get(p.namespace);
            if (view && p.applyUniforms) {
                p.applyUniforms(view, ctx);
            }
        }

        if (isProgressive) {
            this.renderProgressive(compiled, noPrefix);
        } else {
            this.renderOneShot();
        }
    }

    /** Initialize/update progressive resources for the current pipeline */
    ensureProgressiveResources(compiled: CompiledPipeline, canvas: HTMLCanvasElement): void {
        const integrator = this.findRolePlugin(compiled, "integrator");
        const isProgressive = !!(integrator && (integrator as any).progressive === true);

        if (!isProgressive) {
            // Not progressive, don't need the renderer
            return;
        }

        // Create progressive renderer if needed
        if (!this.progressive) {
            this.progressive = new ProgressiveRenderer(this.gl);
        }

        // Ensure history buffers are allocated
        this.progressive.ensureHistory(canvas.width, canvas.height);

        // Update presenter with current postprocess plugin
        const post = this.findRolePlugin(compiled, "postprocess");
        if (!post) throw new Error("[FrameRenderer] No postprocess plugin registered.");
        this.progressive.ensurePresenter(this.vertexSrc, post);

        // Reset accumulation for fresh start
        this.progressive.resetAccumulation();
    }

    /** Handle canvas resize */
    resize(width: number, height: number): void {
        this.gl.viewport(0, 0, width, height);
        if (this.progressive) {
            this.progressive.resize(width, height);
        }
    }

    /** Reset accumulation if using progressive rendering */
    resetAccumulation(): void {
        this.progressive?.resetAccumulation();
    }

    /** Clean up GPU resources */
    dispose(): void {
        this.quad.dispose();
        this.progressive?.dispose();
    }

    // --- Private helpers ---

    private renderProgressive(compiled: CompiledPipeline, noPrefix: UniformManager): void {
        if (!this.progressive) {
            console.warn("[FrameRenderer] Progressive integrator active but ProgressiveRenderer not initialized.");
            this.quad.draw(); // fallback
            return;
        }

        // Delegate to progressive renderer
        this.progressive.render(this.quad, noPrefix);
    }

    private renderOneShot(): void {
        // Draw straight to default framebuffer
        this.quad.draw();
    }

    private findRolePlugin(compiled: CompiledPipeline, role: string): Plugin | undefined {
        for (const p of compiled.plugins) {
            if ((p as any).role === role) return p;
        }
        return undefined;
    }
}
