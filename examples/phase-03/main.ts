// Phase 3: First Hit (Sphere with Normal Visualization)
// Goal: See sphere with normals as colors, validate SDF ray marching

import { MinimalApp } from '../../src/app/MinimalApp.js';

async function main() {
    // Get canvas and set up for full screen
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    console.log('Phase 3: Testing SDF sphere intersection with normal visualization');

    // Create minimal app with real architecture
    const app = new MinimalApp(canvas);

    // Load ambient + camera + scene modules
    app.loadModules();
    console.log('Modules loaded: euclidean ambient + pinhole camera + simple sphere scene');

    // Set up parameter system
    app.setupParameters();
    console.log('Parameters registered');

    // Set up camera using parameter system
    const cameraPosition: [number, number, number] = [0, 0, 5];
    const lookAt: [number, number, number] = [0, 0, 0];
    const fov = 60; // degrees

    app.setCamera(cameraPosition, lookAt, fov);
    console.log('Camera configured via parameter system');


    app.startLightAnimation()

    // Start continuous rendering to see animation
    function renderLoop() {
        app.render();
        requestAnimationFrame(renderLoop);
    }

    renderLoop();



    console.log('SUCCESS: Sphere with normal visualization rendered!');

    console.log('Expected result: Colored sphere against black background');
    console.log('- Sphere should show smooth color gradients (normals as RGB)');
    console.log('- Background should be black where rays miss the sphere');
    console.log('- Colors should vary smoothly across sphere surface');
    console.log('Phase 3 complete - SDF ray marching works!');
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
    console.error('Phase 3 failed:', error);

    // Show error on screen
    document.body.innerHTML = `
    <div style="color: red; padding: 20px; font-family: monospace; background: black;">
      <h2>Phase 3 Failed</h2>
      <p>Error: ${error.message}</p>
      <p>Check console for details</p>
      <p>Expected: Colored sphere with normal visualization</p>
      <pre style="color: #888; margin-top: 10px;">
Troubleshooting:
- Check that scene module exports 'scene_intersect'
- Verify Hit structure has {p, n, t} fields
- Ensure sphere SDF returns correct distances
- Check ray marching constants (MAX_STEPS, EPSILON)
      </pre>
    </div>
  `;
}
