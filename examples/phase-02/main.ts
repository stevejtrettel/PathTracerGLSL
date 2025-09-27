// Phase 2: First Ray + Minimal App Shell
// Goal: See ray directions as colors, validate module composition

import { MinimalApp } from '../../src/app/MinimalApp.js';

async function main() {
    // Get canvas and set up for full screen
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    console.log('Phase 2: Testing ParameterStore → Engine architecture');

    // Create minimal app with real architecture
    const app = new MinimalApp(canvas);

    // Load ambient + camera modules
    app.loadModules();
    console.log('Modules loaded: euclidean ambient + pinhole camera');

    // Set up parameter system
    app.setupCameraParameters();
    console.log('Camera parameters registered');

    // Set up camera using parameter system
    const cameraPosition: [number, number, number] = [0, 0, 5];
    const lookAt: [number, number, number] = [0, 0, 0];
    const fov = 60; // degrees

    app.setCamera(cameraPosition, lookAt, fov);
    console.log('Camera configured via parameter system');

    // Render one frame
    app.render();
    console.log('SUCCESS: Ray direction gradient rendered!');

    console.log('Expected result: Gradient showing ray directions as colors');
    console.log('- Center should be blue-ish (rays going forward, Z direction)');
    console.log('- Edges should show field of view spread as different colors');
    console.log('Phase 2 complete - module composition works!');
}

// Handle window resize
function handleResize() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Could trigger app re-render here if we had continuous rendering
    }
}

window.addEventListener('resize', handleResize);

// Error handling wrapper
try {
    await main();
} catch (error) {
    console.error('Phase 2 failed:', error);

    // Show error on screen
    document.body.innerHTML = `
    <div style="color: red; padding: 20px; font-family: monospace; background: black;">
      <h2>Phase 2 Failed</h2>
      <p>Error: ${error.message}</p>
      <p>Check console for details</p>
      <p>Expected: Gradient showing ray directions</p>
    </div>
  `;
}
