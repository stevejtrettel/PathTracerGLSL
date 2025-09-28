// main.ts - Phase 8: Progressive accumulation with anti-aliasing

import { MinimalApp } from '../src/app/MinimalApp.js';

async function main() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    // Create and initialize app
    const app = new MinimalApp(canvas);
    app.loadModules();
    app.setupParameters();

    // Configure camera
    app.setCamera([0, 0, 5], [0, 0, 0], 60);

    // Start progressive rendering
    app.startRenderLoop();

    // Optional: animate light
    // app.startLightAnimation();

    console.log('Progressive rendering started');
}

// Handle window resize
window.addEventListener('resize', () => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // TODO: Need to handle resize in app/engine
    }
});

// Run
main().catch(error => {
    console.error('Failed to start:', error);
    document.body.innerHTML = `
        <div style="color: red; padding: 20px; font-family: monospace;">
            <h2>Failed to start</h2>
            <p>${error.message}</p>
        </div>
    `;
});
