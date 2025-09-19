/**
 * Integration example: trace-sky
 *
 * Purpose
 *   End-to-end test of the SkyOnly tracer. Produces a gradient sky with
 *   an optional sun lobe, driven by camera rays.
 *
 * How to run
 *   npm run dev → see horizon/zenith gradient with sun highlight.
 */

import { assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import {ShaderProgram} from '../src/engine/shaders/ShaderProgram';
import {Fullscreen} from '../src/engine/execution/FullScreen';

import PinholeCamera from '../src/photography/camera/PinholeCamera';
import SkyOnlyTracer from '../src/photography/tracer/SkyOnly';

// --- Vertex shader for fullscreen triangle ---
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

// --- Assemble Camera + Tracer ---
const FRAG_SRC = assembleTraceFragment(PinholeCamera, SkyOnlyTracer);

// --- Canvas + GL context ---
const canvas = document.createElement('canvas');
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.display = 'block';
document.body.style.margin = '0';
document.body.appendChild(canvas);

const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 not available');

// --- Program + fullscreen helper ---
const program = ShaderProgram.create(gl, { vertex: VERT_SRC, fragment: FRAG_SRC });
const fullscreen = Fullscreen.create(gl);

// --- State ---
let frame = 0;
const t0 = performance.now();

// --- Utils ---
function fitCanvasToCSSPixels() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
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
    // Horizon color (skyBottom), zenith color (skyTop)
    gl.uniform3f(program.uniform('g_tracer_sky_only_skyBottom')!, 0.6, 0.7, 0.8);
    gl.uniform3f(program.uniform('g_tracer_sky_only_skyTop')!,    0.05, 0.1, 0.35);

    // Sun direction & tint
    gl.uniform3f(program.uniform('g_tracer_sky_only_sunDir')!,    0.6, 0.4, 0.6);
    gl.uniform3f(program.uniform('g_tracer_sky_only_sunTint')!,   1.8, 1.6, 1.4);
    gl.uniform1f(program.uniform('g_tracer_sky_only_sunSize')!,   0.03);

    // Exposure
    gl.uniform1f(program.uniform('g_tracer_sky_only_exposureEV')!, 0.0);
}

// --- Render loop ---
function render() {
    fitCanvasToCSSPixels();
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

render();
window.addEventListener('resize', fitCanvasToCSSPixels, { passive: true });
