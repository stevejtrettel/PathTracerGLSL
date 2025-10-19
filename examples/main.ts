// main.ts - Phase 8: Progressive accumulation with anti-aliasing

import { App } from '../src/app/App.js';

async function main() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    // Create app
    const app = new App(canvas);

    // Initialize with HDR loading and start render loop
    await app.initialize();

    console.log('Progressive rendering started with HDR environment');

    // Store app reference for resize handler
    (window as any).app = app;
}

// Handle window resize
window.addEventListener('resize', () => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Get app reference and update resolution
        const app = (window as any).app;
        if (app) {
            app.parameterStore.set('resolution', [window.innerWidth, window.innerHeight]);
            app.engine.handleResize(window.innerWidth, window.innerHeight);
        }
    }
});

// Run
main().catch(error => {
    console.error('Failed to start:', error);
    document.body.innerHTML = `
        <div style="color: red; padding: 20px; font-family: monospace;">
            <h2>Failed to start</h2>
            <p>${error.message}</p>
            <pre>${error.stack}</pre>
        </div>
    `;
});
