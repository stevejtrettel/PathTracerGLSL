// Phase 1: Wire up ModuleRegistry → ShaderCompiler → RenderExecutor
// Goal: See red screen, validate Engine pillar foundation

import { ModuleRegistry } from '../../src/engine/ModuleRegistry.js';
import { ShaderCompiler } from '../../src/engine/ShaderCompiler.js';
import { RenderExecutor } from '../../src/engine/RenderExecutor.js';
import { redModule } from "./red-module";

function main() {
    // Get canvas and set up WebGL2
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    // Resize canvas to window
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('WebGL2 not supported');
    }

    console.log('Phase 1: Testing Engine pillar foundation');

    // Create engine components
    const registry = new ModuleRegistry();
    const compiler = new ShaderCompiler();
    const executor = new RenderExecutor(gl);

    console.log('Engine components created');

    // Register our test module
    registry.register(redModule);
    console.log('Test module registered');

    // Compile module to GLSL source
    const fragmentSource = compiler.compile([registry.get('test', 'red')]);
    console.log('GLSL compiled');
    console.log('Generated fragment shader:');
    console.log(fragmentSource);

    // Load shader into executor
    executor.loadShader(fragmentSource);
    console.log('Shader loaded into GPU');

    // Execute one frame
    executor.execute();
    console.log('SUCCESS: Red screen rendered!');
    console.log('Phase 1 complete - Engine pillar foundation works');
}

// Handle window resize
function handleResize() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}

window.addEventListener('resize', handleResize);

// Error handling wrapper
try {
    main();
} catch (error) {
    console.error('Phase 1 failed:', error);
    document.body.innerHTML = `
    <div style="color: red; padding: 20px; font-family: monospace;">
      <h2>Phase 1 Failed</h2>
      <p>Error: ${error.message}</p>
      <p>Check console for details</p>
    </div>
  `;
}
