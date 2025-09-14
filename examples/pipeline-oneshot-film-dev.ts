/**
 * Integration example: tracer → film.passthrough → developer.linear_srgb
 *
 * What this does
 *   1) Assembles a concrete tracer fragment (Pinhole + SDFStub + OneShot).
 *   2) Runs the tracer into an offscreen rgba16f texture (T_tracer).
 *   3) Runs film.passthrough(T_tracer) → radiance rgba16f texture (T_radiance).
 *   4) Runs developer.linear_srgb(T_radiance) → default framebuffer (screen).
 *
 * Notes
 *   - We use ShaderProgram + Fullscreen helpers you already have.
 *   - We bind system uniforms and module uniforms explicitly (prefixed names).
 *   - We guard for EXT_color_buffer_float and allocate RGBA16F render targets.
 */

import { assembleTraceFragment, assembleFragment } from '../src/engine/shaders/AssemblerLite';
import {ShaderProgram} from '../src/engine/shaders/ShaderProgram';
import {Fullscreen} from '../src/engine/execution/Fullscreen';

import PinholeCamera from '../src/photography/camera/PinholeCamera';
import SDFStubWorld from '../src/world/scene/SDFStub';
import OneShotTracer from '../src/photography/tracer/OneShot';

import PassthroughFilm from '../src/photography/film/Passthrough';
import LinearSRGBDeveloper from '../src/photography/developer/LinearSRGB';

// ----------------------------- Fullscreen vertex -----------------------------
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

// ------------------------------ Assemble shaders -----------------------------
const FRAG_TRACE = assembleTraceFragment(PinholeCamera, SDFStubWorld, OneShotTracer);

const FRAG_FILM = assembleFragment(
    [PassthroughFilm],
    `
  in vec2 v_uv;
  out vec4 fragColor;
  vec4 film_accumulate(vec2 v_uv);
  void main() {
    fragColor = film_accumulate(v_uv); // semantic 'radiance' is produced to the FBO we bind
  }
`
);

const FRAG_DEVELOP = assembleFragment(
    [LinearSRGBDeveloper],
    `
  in vec2 v_uv;
  out vec4 fragColor;
  vec4 develop(vec2 v_uv);
  void main() {
    fragColor = develop(v_uv); // samples g_dev_radiance
  }
`
);

// -------------------------------- Page setup --------------------------------
const canvas = document.createElement('canvas');
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.display = 'block';
document.body.style.margin = '0';
document.body.appendChild(canvas);

const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) throw new Error('WebGL2 not available');

// Require color buffer float support for RGBA16F render targets
const extCBF = gl.getExtension('EXT_color_buffer_float');
if (!extCBF) {
    throw new Error('EXT_color_buffer_float not supported; RGBA16F render targets unavailable.');
}

// ---------------------------- Programs & helpers -----------------------------
const progTrace   = ShaderProgram.create(gl, { vertex: VERT_SRC, fragment: FRAG_TRACE });
const progFilm    = ShaderProgram.create(gl, { vertex: VERT_SRC, fragment: FRAG_FILM });
const progDevelop = ShaderProgram.create(gl, { vertex: VERT_SRC, fragment: FRAG_DEVELOP });

const fullscreen = Fullscreen.create(gl);

// -------------------------- Render targets (RTs) -----------------------------
type RT = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };

let RT_tracer: RT | null = null;    // tracer output (rgba16f)
let RT_radiance: RT | null = null;  // film output (semantic 'radiance', rgba16f)

function createRT(w: number, h: number): RT {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        w,
        h,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null
    );

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('FBO incomplete (RGBA16F): 0x' + status.toString(16));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { tex, fbo, w, h };
}

function destroyRT(rt: RT | null) {
    if (!rt) return;
    gl.deleteFramebuffer(rt.fbo);
    gl.deleteTexture(rt.tex);
}

function fitCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);

        // (Re)create render targets at the new size
        destroyRT(RT_tracer);   RT_tracer = createRT(w, h);
        destroyRT(RT_radiance); RT_radiance = createRT(w, h);
    }
}
fitCanvas();
window.addEventListener('resize', fitCanvas, { passive: true });

// ------------------------------- Uniform utils -------------------------------
let frame = 0;
const t0 = performance.now();

function setSystemUniforms(prog: ShaderProgram) {
    gl.uniform2f(prog.uniform('g_sys_resolution')!, canvas.width, canvas.height);
    gl.uniform1i(prog.uniform('g_sys_frame')!, frame);
    gl.uniform1f(prog.uniform('g_sys_time')!, (performance.now() - t0) * 1e-3);
}

function setCameraUniforms(prog: ShaderProgram) {
    gl.uniformMatrix4fv(
        prog.uniform('g_camera_pinhole_cameraToWorld')!,
        false,
        new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ])
    );
    gl.uniform1f(prog.uniform('g_camera_pinhole_fovY')!, 60.0);
    gl.uniform2f(prog.uniform('g_camera_pinhole_sensorShift')!, 0.0, 0.0);
}

function setWorldUniforms(prog: ShaderProgram) {
    gl.uniform3f(prog.uniform('g_world_sdf_stub_sphereCenter')!, 0.0, 0.0, -3.0);
    gl.uniform1f(prog.uniform('g_world_sdf_stub_sphereRadius')!, 1.0);
    gl.uniform3f(prog.uniform('g_world_sdf_stub_sphereAlbedo')!, 0.9, 0.35, 0.15);
}

function setTracerUniforms(prog: ShaderProgram) {
    gl.uniform3f(prog.uniform('g_tracer_oneshot_sunDir')!, 0.6, 0.4, 0.6);
    gl.uniform3f(prog.uniform('g_tracer_oneshot_sunTint')!, 1.8, 1.6, 1.4);
    gl.uniform1f(prog.uniform('g_tracer_oneshot_sunStrength')!, 3.0);
    gl.uniform1f(prog.uniform('g_tracer_oneshot_exposureEV')!, 0.0);
}

function setFilmUniforms(prog: ShaderProgram) {
    // Bind the tracer output texture at unit 0 to film’s input sampler
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, RT_tracer!.tex);
    gl.uniform1i(prog.uniform('g_film_passthrough_u_traceColor')!, 0);
}

function setDeveloperUniforms(prog: ShaderProgram) {
    // Bind the film's semantic radiance at unit 0 to the reserved developer uniform
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, RT_radiance!.tex);
    gl.uniform1i(prog.uniform('g_dev_radiance')!, 0); // reserved; unprefixed
}

// --------------------------------- Render loop --------------------------------
function render() {
    fitCanvas();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // Pass 1: tracer → RT_tracer
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT_tracer!.fbo);
    gl.viewport(0, 0, RT_tracer!.w, RT_tracer!.h);
    progTrace.use(gl);
    fullscreen.bind(gl);
    setSystemUniforms(progTrace);
    setCameraUniforms(progTrace);
    setWorldUniforms(progTrace);
    setTracerUniforms(progTrace);
    fullscreen.draw(gl);

    // Pass 2: film.passthrough(T_tracer) → RT_radiance
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT_radiance!.fbo);
    gl.viewport(0, 0, RT_radiance!.w, RT_radiance!.h);
    progFilm.use(gl);
    fullscreen.bind(gl);
    setSystemUniforms(progFilm);
    setFilmUniforms(progFilm);
    fullscreen.draw(gl);

    // Pass 3: developer.linear_srgb(T_radiance) → default framebuffer (screen)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    progDevelop.use(gl);
    fullscreen.bind(gl);
    setSystemUniforms(progDevelop);
    setDeveloperUniforms(progDevelop);
    fullscreen.draw(gl);

    frame++;
    requestAnimationFrame(render);
}

render();
