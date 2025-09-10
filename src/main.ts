// src/main.ts
import ShaderProgram from "./rendering/ShaderProgram";
import FullscreenQuad from "./rendering/FullscreenQuad";
import ProgramCache from "./rendering/ProgramCache";

import Uniforms from "./plugins/Uniforms";
import type { ColorPlugin } from "./plugins/types";
import SolidColorPlugin from "./plugins/SolidColorPlugin";
import GradientColorPlugin from "./plugins/GradientColorPlugin";

class App {
    // DOM / GL
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;

    // Render resources
    private quad: FullscreenQuad;
    private cache: ProgramCache;
    private program!: ShaderProgram;  // set in setPlugin
    private uniforms!: Uniforms;      // set in setPlugin

    // Active plugin
    private plugin!: ColorPlugin;

    // Pre-created plugins we can toggle between
    private solid!: SolidColorPlugin;
    private grad!: GradientColorPlugin;

    constructor() {
        // Canvas + GL2
        this.canvas = document.createElement("canvas");
        document.body.style.margin = "0";
        Object.assign(this.canvas.style, { width: "100vw", height: "100vh", display: "block" });
        document.body.appendChild(this.canvas);

        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        // Geometry helper + cache
        this.quad = new FullscreenQuad(this.gl);
        this.cache = new ProgramCache(this.gl);

        // Create plugin instances with prefixes
        this.solid = new SolidColorPlugin([0.9, 0.2, 0.15], 1.0, "u_solid_");
        this.grad  = new GradientColorPlugin({ prefix: "u_grad_", tint: [1, 1, 1], speed: 0.5 });

        // Start with one
        this.setPlugin(this.solid, "u_solid_");

        // Hot-swap keys
        window.addEventListener("keydown", (e) => {
            if (e.key === "1") this.setPlugin(this.solid, "u_solid_");
            if (e.key === "2") this.setPlugin(this.grad,  "u_grad_");
        });

        // Resize + RAF
        window.addEventListener("resize", () => this.resize());
        this.resize();
        requestAnimationFrame((t) => this.draw(t));
    }

    /** Build (or reuse from cache) the program for a given plugin, then (re)bind Uniforms. */
    private setPlugin(plugin: ColorPlugin, prefix: string): void {
        this.plugin = plugin;

        const vert = `#version 300 es
      layout(location = 0) in vec2 a_pos;
      layout(location = 1) in vec2 a_uv;
      out vec2 v_uv;
      void main() { v_uv = a_uv; gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;

        const frag = this.plugin.getFragmentSource();

        // Stable cache key: plugin class + prefix (good enough for the lab)
        const key = `${plugin.constructor.name}:${prefix}`;

        // Get or create program from cache, then bind uniforms helper
        this.program = this.cache.get(vert, frag, key);
        this.uniforms = new Uniforms(this.gl, this.program, prefix);
    }

    private resize(): void {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        this.gl.viewport(0, 0, w, h);
    }

    private draw(_nowMs: number): void {
        const gl = this.gl;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.program.use();
        this.plugin.applyUniforms(this.uniforms);
        this.quad.draw();

        requestAnimationFrame((t) => this.draw(t));
    }
}

new App();
