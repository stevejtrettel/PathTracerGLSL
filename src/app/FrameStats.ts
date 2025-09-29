// app/FrameStats.ts
export class FrameStats {
    private frameCount = 0;
    private lastTime = performance.now();
    private fps = 0;
    private resolution: [number, number] | null = null;

    private element: HTMLDivElement;
    public visible = true;

    constructor() {
        this.element = document.createElement('div');
        this.element.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            color: white;
            font-family: monospace;
            font-size: 14px;
            background: rgba(0,0,0,0.7);
            padding: 8px 12px;
            border-radius: 4px;
            pointer-events: none;
            z-index: 1000;
            min-width: 120px;
        `;
        document.body.appendChild(this.element);
        this.updateDisplay();
    }

    update(sampleCount?: number): void {
        this.frameCount++;
        const now = performance.now();
        const elapsed = now - this.lastTime;

        if (elapsed >= 500) {
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.lastTime = now;
            this.updateDisplay(sampleCount);
        }
    }

    setResolution(width: number, height: number): void {
        this.resolution = [width, height];
        this.updateDisplay();
    }

    private updateDisplay(sampleCount?: number): void {
        if (!this.visible) return;

        let html = `FPS: ${this.fps}`;
        if (sampleCount !== undefined) {
            html += `<br>SPP: ${sampleCount}`;
        }
        if (this.resolution) {
            html += `<br>${this.resolution[0]}×${this.resolution[1]}`;
        }
        this.element.innerHTML = html;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        this.element.style.display = visible ? 'block' : 'none';
    }

    dispose(): void {
        this.element.remove();
    }
}
