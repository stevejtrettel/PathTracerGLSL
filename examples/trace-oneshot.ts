/**
 * Integration example: trace-oneshot (Camera + World + OneShot tracer)
 *
 * Replaces the flatcolor example with a single-bounce, direct-light pass.
 * - Camera: Pinhole (generateRay)
 * - World:  SDFStub (analytic sphere + albedo)
 * - Tracer: OneShot (Lambert w/ directional sun)
 */

import { assembleTraceFragment } from '../src/engine/shaders/AssemblerLite';
import {ShaderProgram} from '../src/engine/shaders/ShaderProgram';
import {Fullscreen} from '../src/engine/execution/Fullscreen';

import PinholeCamera from '../src/photography/camera/PinholeCamera';
import SDFStubWorld from '../src/world/scene/SDFStub';
import OneShotTracer from '../src/photography/tracer/OneShot';

// Fullscreen vertex
const VERT_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[](
  vec2(-1.0,-1.0),
  vec2( 3.0,-1.0),
  vec2(-1.0, 3.0)
);
out vec2 v_uv;
void main(){
  vec2 p = POS[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
  v_uv = p * 0.5 + 0.5;
}
` as const;

// Assemble fragment: Camera → World → Tracer
const FRAG_SRC = assembleTraceFragment(PinholeCamera, SDFStubWorld, OneShotTracer);

// Minimal page setup
const canvas = document.createElement('canvas');
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.display = 'block';
document.body.style.margin = '0';
document.body.appendChild(canvas);

// GL init
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) throw new Error('WebGL2 not available');

const program = ShaderProgram.create(gl, { vertex: VERT_SRC, fragment: FRAG_SRC });
const fullscreen = Fullscreen.create(gl);

// State
let frame = 0;
const t0 = performance.now();

// Helpers
function fitCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
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
            1,0,0,0,
            0,1,0,0,
            0,0,1,0,
            0,0,0,1
        ])
    );
    gl.uniform1f(program.uniform('g_camera_pinhole_fovY')!, 50.0);
    gl.uniform2f(program.uniform('g_camera_pinhole_sensorShift')!, 0.0, 0.0);
}

function setWorldUniforms() {
    // world.sdf_stub → g_world_sdf_stub_*
    gl.uniform3f(program.uniform('g_world_sdf_stub_sphereCenter')!, 0.0, 0.0, -3.0);
    gl.uniform1f(program.uniform('g_world_sdf_stub_sphereRadius')!, 1.0);
    gl.uniform3f(program.uniform('g_world_sdf_stub_sphereAlbedo')!, 0.85, 0.2, 0.15);
}

function setTracerUniforms() {
    // tracer.oneshot → g_tracer_oneshot_*
    gl.uniform3f(program.uniform('g_tracer_oneshot_sunDir')!, 0.6, 0.5, 0.6);  // direction-ish
    gl.uniform3f(program.uniform('g_tracer_oneshot_sunTint')!, 1.6, 1.5, 1.4); // warm tint
    gl.uniform1f(program.uniform('g_tracer_oneshot_sunStrength')!, 3.0);
    gl.uniform1f(program.uniform('g_tracer_oneshot_exposureEV')!, 0.0);
}

// Render
function render() {
    fitCanvas();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    program.use(gl);
    fullscreen.bind(gl);

    setSystemUniforms();
    setCameraUniforms();
    setWorldUniforms();
    setTracerUniforms();

    fullscreen.draw(gl);
    frame++;
    requestAnimationFrame(render);
}

// Start
render();
window.addEventListener('resize', fitCanvas, { passive: true });
