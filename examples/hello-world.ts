/**
 * Purpose: Minimal smoke test that exercises ShaderProgram + WebGL2 draw call.
 * Public contract: none (script entry).
 * Inputs: Creates (or finds) a canvas, compiles a tiny fullscreen shader, draws a solid color.
 * Outputs: One frame of color on screen; logs compile/link success or any errors.
 * Lifecycle: One-shot render on load; resize-aware (redraws once on resize).
 * Invariants: No engine scaffolding yet; no VAO/VBO helpers; vertex shader uses gl_VertexID.
 */

import { ShaderProgram } from '../src/engine/shaders/ShaderProgram';
import type { ShaderSources } from '../src/engine/shaders/Types';

/* ----------------------------- Setup canvas ------------------------------ */

function ensureCanvas(id = 'rp-hello'): HTMLCanvasElement {
    let canvas = document.getElementById(id) as HTMLCanvasElement | null;
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.display = 'block';
        document.body.style.margin = '0';
        document.body.appendChild(canvas);
    }
    return canvas;
}

function getGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    return gl;
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = Math.floor(canvas.clientWidth || window.innerWidth);
    const cssH = Math.floor(canvas.clientHeight || window.innerHeight);
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
}

/* ----------------------------- Shader sources ---------------------------- */

/**
 * Fullscreen triangle vertex shader:
 * - No attributes or VBOs; uses gl_VertexID to synthesize 3 positions.
 * - Emits UV in [0,1] as v_uv for fragment stage (handy later).
 */
const VERTEX_SRC = `#version 300 es
precision highp float;

const vec2 POS[3] = vec2[](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);

out vec2 v_uv;

void main() {
  vec2 p = POS[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
  // Map from clip-space triangle to [0,1] UV for convenience
  v_uv = p * 0.5 + 0.5;
}
`;

/**
 * Fragment shader:
 * - Paints a solid color (set here or via a uniform later).
 * - Declares an output vec4 and writes once.
 */
const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

// You can make this a uniform later; keep const for smoke test.
const vec3 kColor = vec3(0.08, 0.12, 0.95); // nice blue

void main() {
  fragColor = vec4(kColor, 1.0);
}
`;

/* ----------------------------- Draw once --------------------------------- */

export function main() {
    const canvas = ensureCanvas();
    const gl = getGL(canvas);

    // WebGL2 requires a VAO bound for draw calls; create an empty one once.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    gl.bindVertexArray(vao);

    // Handle initial and subsequent resizes.
    const onResize = () => {
        resizeCanvasToDisplaySize(canvas, gl);
        render(gl);
    };
    window.addEventListener('resize', onResize);

    // Compile/link the program using your engine helper.
    const sources: ShaderSources = { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC };
    let program: ShaderProgram | null = null;
    try {
        program = ShaderProgram.create(gl, sources);
    } catch (e) {
        console.error('Shader compile/link failed:', e);
        throw e;
    }

    // One-shot render.
    function render(gl: WebGL2RenderingContext) {
        if (!program) return;
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        program.use(gl);
        // No uniforms to bind yet; draw the triangle.
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    onResize(); // initial draw

    // Optional: return a tiny API to teardown or recolor later.
    return {
        dispose() {
            window.removeEventListener('resize', onResize);
            if (program) program.dispose(gl);
            gl.deleteVertexArray(vao);
        }
    };
}

// Auto-run if this file is loaded as a script.
if (typeof window !== 'undefined') {
    // defer to allow DOM to settle
    window.addEventListener('DOMContentLoaded', () => main());
}
