// src/tracer/ProgressiveRenderer.ts
import { BufferManager } from "../systems/BufferManager";
import ScreenPresenter from "../rendering/ScreenPresenter";
import type { Plugin } from "../core/types";
import type UniformManager from "../systems/UniformManager";
import type FullscreenQuad from "../rendering/FullscreenQuad";

export class ProgressiveRenderer {
    private gl: WebGL2RenderingContext;
    private bm: BufferManager;
    private presenter?: ScreenPresenter;

    private readonly historyBase = "history";
    private frameIndex = 0;
    private sampleCount = 0;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.bm = new BufferManager(gl);
    }

    /** Ensure presenter exists with the given postprocess plugin */
    ensurePresenter(vertexSrc: string, postprocess: Plugin): void {
        if (!this.presenter) {
            this.presenter = new ScreenPresenter(this.gl, vertexSrc, postprocess);
        } else {
            this.presenter.updatePostprocess(vertexSrc, postprocess);
        }
    }

    /** Ensure history buffers are allocated at the right size */
    ensureHistory(width: number, height: number): void {
        this.bm.createPair(this.historyBase, {
            format: "rgba16f",
            size: { w: width, h: height },
            lifetime: "history",
            filtering: "nearest",
            clear: [0, 0, 0, 0],
        });
    }

    /** Reset accumulation counters and clear history */
    resetAccumulation(): void {
        this.frameIndex = 0;
        this.sampleCount = 0;
        this.bm.clearByLifetime("history");
    }

    /** Execute progressive rendering: accumulate HDR samples and present through postprocess */
    render(quad: FullscreenQuad, noPrefix: UniformManager): void {
        if (!this.presenter) {
            console.warn("[ProgressiveRenderer] Presenter not initialized");
            quad.draw(); // fallback
            return;
        }

        // Bind previous history as u_historyColor (TU0)
        this.bm.bindPairReadAsTexture(this.historyBase, 0);
        (noPrefix as any).set1i?.("u_historyColor", 0);
        (noPrefix as any).set1i?.("u_frameIndex", this.frameIndex);
        (noPrefix as any).set1i?.("u_sampleCount", this.sampleCount);

        // Draw into WRITE side (HDR)
        this.bm.bindPairWriteAsDrawTarget(this.historyBase);
        quad.draw();
        this.bm.unbindDrawTarget();

        // Present freshly written HDR (pre-swap) via postprocess chain
        const justWritten = this.bm.pairWrite(this.historyBase);
        this.bm.bindAsTexture(justWritten, 0);
        this.presenter.blitFromTexUnit(0);

        // Advance accumulation
        this.bm.swapPair(this.historyBase);
        this.sampleCount++;
        this.frameIndex++;
    }

    /** Handle resize: reallocate buffers and reset accumulation */
    resize(width: number, height: number): void {
        this.bm.resizePair(this.historyBase, width, height);
        this.resetAccumulation();
    }

    /** Get current frame statistics */
    getStats(): { frameIndex: number; sampleCount: number } {
        return { frameIndex: this.frameIndex, sampleCount: this.sampleCount };
    }

    /** Clean up GPU resources */
    dispose(): void {
        this.bm.dispose();
        // Note: presenter disposal handled separately if needed
    }
}
