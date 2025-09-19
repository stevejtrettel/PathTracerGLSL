/**
 * Integration example: trace-flatcolor
 *
 * Purpose
 *   Minimal end-to-end pixel test using the rigorously tested pieces:
 *     - AssemblerLite: builds a concrete fragment (no #ifdefs)
 *     - PinholeCamera: provides generateRay (not actually used by FlatColor, but fine)
 *     - FlatColorTracer: provides tracePixel (returns constant color)
 *     - ShaderProgram + Fullscreen: small GL executor primitives
 *
 * How to run
 *   1) Ensure this file is included by your dev entry (e.g., import it from main.ts),
 *      or directly point Vite to it as a page entry.
 *   2) npm run dev   → you should see a solid magenta frame.
 *
 * Notes
 *   - This example creates its own canvas and appends to document.body, so no HTML edits.
 *   - Resize is handled; uniforms are re-set each frame as needed.
 */

import { assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import { ShaderProgram } from '../src/engine/shaders/ShaderProgram';
import { Fullscreen } from '../src/engine/execution/FullScreen';

import PinholeCamera from '../src/photography/camera/PinholeCamera';
import FlatColorTracer from '../src/photography/tracer/FlatColor';

// --- Fullscreen vertex (matches Assembler glue's varyings) ---
const VERT_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);
out vec2 v_uv;
void main(){
  vec2 p = POS[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
  v_uv = p * 0.5 + 0.5;
}
` as const;

// --- Assemble a concrete fragment (Camera + Tracer) ---
const FRAG_SRC = assembleTraceFragment(PinholeCamera, FlatColorTracer);

// --- Minimal page setup (no HTML edits needed) ---
const canvas = document.createElement('canvas');
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.display = 'block';
document.body.style.margin = '0';
document.body.appendChild(canvas);

// --- WebGL2 context ---
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) {
    throw new Error('WebGL2 not available');
}

// --- Create program & fullscreen helper ---
const program = ShaderProgram.create(gl, { vertex: VERT_SRC, fragment: FRAG_SRC });
const fullscreen = Fullscreen.create(gl);

// --- State ---
let frame = 0;
const t0 = performance.now();

// --- Utilities ---
function fitCanvasToCSSPixels(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // cap for perf
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
    }
}

function setSystemUniforms() {
    gl.uniform2f(program.uniform('g_sys_resolution')!, canvas.width, canvas.height);
    gl.uniform1i(program.uniform('g_sys_frame')!, frame);
    gl.uniform1f(program.uniform('g_sys_time')!, (performance.now() - t0) * 1e-3);
}

function setCameraUniforms() {
    // camera.pinhole → g_camera_pinhole_*
    gl.uniformMatrix4fv(
        program.uniform('g_camera_pinhole_cameraToWorld')!,
        false,
        new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ])
    );
    gl.uniform1f(program.uniform('g_camera_pinhole_fovY')!, 60.0);
    gl.uniform2f(program.uniform('g_camera_pinhole_sensorShift')!, 0.0, 0.0);
}

function setTracerUniforms() {
    // tracer.flat_color → g_tracer_flat_color_*
    gl.uniform3f(program.uniform('g_tracer_flat_color_color')!, 1.0, 0.0, 1.0); // magenta
    gl.uniform1f(program.uniform('g_tracer_flat_color_exposureEV')!, 0.0);
}

// --- Render loop ---
function render() {
    fitCanvasToCSSPixels(canvas, gl);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    program.use(gl);
    fullscreen.bind(gl);

    setSystemUniforms();
    setCameraUniforms();
    setTracerUniforms();

    fullscreen.draw(gl);
    frame++;

    requestAnimationFrame(render);
}

// --- Kickoff ---
render();

// --- Handle resizes ---
window.addEventListener('resize', () => fitCanvasToCSSPixels(canvas, gl), { passive: true });
