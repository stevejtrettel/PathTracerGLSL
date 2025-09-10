import ShaderProgram from "./rendering/ShaderProgram";
import FullscreenQuad from "./rendering/FullscreenQuad";
import SolidColorPlugin from "./plugins/SolidColorPlugin";
import GradientColorPlugin from "./plugins/GradientColorPlugin";
import Uniforms from "./plugins/Uniforms";

class SolidColorApp {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    private program: ShaderProgram;
    private quad: FullscreenQuad;
    private plugin: ColorPlugin;
    private uniforms: Uniforms;

    constructor() {
        // 1) Canvas + GL2
        this.canvas = document.createElement("canvas");
        document.body.style.margin = "0";
        Object.assign(this.canvas.style, { width: "100vw", height: "100vh", display: "block" });
        document.body.appendChild(this.canvas);

        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        // 2) Vertex shader
        const vert = `#version 300 es
      layout(location = 0) in vec2 a_pos;
      layout(location = 1) in vec2 a_uv;
      out vec2 v_uv;
      void main() {
        v_uv = a_uv;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

        // 3) Plugin + fragment shader
        this.plugin =new GradientColorPlugin();
            //new SolidColorPlugin([0.9, 0.2, 0.15]); // red-ish
        const frag = this.plugin.getFragmentSource();

        // 4) Program + quad + uniforms helper
        this.program = new ShaderProgram(this.gl, vert, frag);
        this.quad = new FullscreenQuad(this.gl);
        this.uniforms = new Uniforms(this.gl, this.program /*, prefix: "" for now */);

        // 5) Resize + draw
        window.addEventListener("resize", () => this.resize());
        this.resize();
        requestAnimationFrame((t) => this.draw(t));
    }

    private resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        this.gl.viewport(0, 0, w, h);
    }

    private draw(_nowMs: number) {
        const gl = this.gl;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.program.use();

        // Plugin sets its uniforms by local names through the helper
        this.plugin.applyUniforms(this.uniforms);

        this.quad.draw();

        requestAnimationFrame((t) => this.draw(t));
    }
}

new SolidColorApp();
