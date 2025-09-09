// src/main.ts

// Get the canvas and WebGL context
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2');

if (!gl) {
    throw new Error('WebGL2 not supported');
}

console.log('WebGL2 context created successfully!');

// Resize canvas to match display size
function resizeCanvas() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}

// Set up resize handling
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Clear to a test color so we know it's working
gl.clearColor(0.2, 0.4, 0.8, 1.0);  // Nice blue
gl.clear(gl.COLOR_BUFFER_BIT);

console.log('Canvas cleared to blue - WebGL is working!');
