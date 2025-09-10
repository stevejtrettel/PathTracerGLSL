// src/main.ts
import FullscreenQuad from "./rendering/FullscreenQuad";
import ProgramCache from "./rendering/ProgramCache";
import ShaderProgram from "./rendering/ShaderProgram";

import fullscreenVert from "./glsl/fullscreen.vert";

// --- Color sandbox (kept for comparison/testing) ---
import UniformManager from "./systems/UniformManager";
import type { ColorPlugin } from "./plugins/types";
import SolidColorPlugin from "./plugins/solid-color/SolidColorPlugin";
import GradientColorPlugin from "./plugins/gradient-color/GradientColorPlugin";

// --- Real engine path ---
import Engine from "./core/Engine";
import ShaderAssembler from "./systems/ShaderAssembler";
import TestIntegratorPlugin from "./integration/TestIntegrator";
import SRGBDisplayPlugin from "./display/SRGBDisplay";

type Mode = "colorPlugin" | "engine";

interface UniformsConsumer {
    applyUniforms?(u: UniformManager): void;
}

class App {
    // DOM / GL
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;

    // Common render resources
    private quad: FullscreenQuad;
    private cache: ProgramCache;

    // Active GL state
    private program!: ShaderProgram;

    // ---- Color-plugin mode state ----
    private mode: Mode = "colorPlugin";
    private colorPlugin?: ColorPlugin;
    private colorUniforms?: UniformManager;

    // ---- Engine mode state ----
    private engine?: Engine;
    private assembler?: ShaderAssembler;
    private enginePlugins: { plugin: any; prefix: string }[] = [];
    private engineUniformViews: Map<string, UniformManager> = new Map();

    constructor() {
        // Canvas + GL2
        this.canvas = document.createElement("canvas");
        document.body.style.margin = "0";
        Object.assign(this.canvas.style, { width: "100vw", height: "100vh", display: "block" });
        document.body.appendChild(this.canvas);

        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        // Shared
        this.quad = new FullscreenQuad(this.gl);
        this.cache = new ProgramCache(this.gl);

        // --- Instantiate color plugins for the sandbox path ---
        const solid = new SolidColorPlugin([0.9, 0.2, 0.15], 1.0, "u_solid_");
        const grad  = new GradientColorPlugin({ prefix: "u_grad_", tint: [1, 1, 1], speed: 0.5 });

        // Start in color-plugin mode with solid
        this.setColorPlugin(solid, "u_solid_");

        // Hot-swap keys
        window.addEventListener("keydown", (e) => {
            if (e.key === "1") this.setColorPlugin(solid, "u_solid_");
            if (e.key === "2") this.setColorPlugin(grad,  "u_grad_");
            if (e.key === "3") this.setEnginePipeline(); // real engine mode
        });

        // Resize + RAF
        window.addEventListener("resize", () => this.resize());
        this.resize();
        requestAnimationFrame((t) => this.draw(t));
    }

    // ---------------- Color-plugin pipeline ----------------

    private setColorPlugin(plugin: ColorPlugin, prefix: string): void {
        this.mode = "colorPlugin";
        this.colorPlugin = plugin;

        const frag = plugin.getFragmentSource();
        const extraKey = `${plugin.constructor.name}:${prefix}`; // ProgramCache will append shader hashes
        this.program = this.cache.get(fullscreenVert, frag, extraKey);

        // Rebind uniform helper for this program/prefix
        this.colorUniforms = new UniformManager(this.gl, this.program, prefix);
    }

    // ---------------- Engine pipeline (real system) ----------------

    private setEnginePipeline(): void {
        this.mode = "engine";

        // Create engine + assembler, register active role providers
        const engine = new Engine();
        const assembler = new ShaderAssembler();

        const integrator = new TestIntegratorPlugin();
        const display    = new SRGBDisplayPlugin();

        engine.use(integrator).use(display);

        // Build assembled fragment from active plugins
        const { fragment, uniforms } = assembler.buildFragment(engine.list());

        // Compile (or reuse) the program
        const extraKey = `engine:${integrator.constructor.name}+${display.constructor.name}`;
        this.program = this.cache.get(fullscreenVert, fragment, extraKey);

        // Prepare per-namespace uniform "views" (prefixes come from assembler)
        this.engineUniformViews.clear();
        for (const [ns, info] of Object.entries(uniforms)) {
            this.engineUniformViews.set(ns, new UniformManager(this.gl, this.program, info.prefix));
        }

        // Keep references to plugins + their prefixes (useful once they declare uniforms)
        this.enginePlugins = [];
        for (const p of engine.list()) {
            const prefix = uniforms[p.namespace]?.prefix ?? "";
            this.enginePlugins.push({ plugin: p as UniformsConsumer, prefix });
        }

        // Save references for later (optional; handy as we grow)
        this.engine = engine;
        this.assembler = assembler;
    }

    // ---------------- Common drawing & resize ----------------

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

        if (this.mode === "colorPlugin") {
            // Let the color plugin push its uniforms
            if (this.colorPlugin && this.colorUniforms) {
                this.colorPlugin.applyUniforms(this.colorUniforms);
            }
        } else {
            // Engine mode: if any engine plugin exposes applyUniforms(u), call it with its prefixed view.
            for (const { plugin, prefix } of this.enginePlugins) {
                const u = this.engineUniformViews.get((plugin as any).namespace) ?? new UniformManager(this.gl, this.program, prefix);
                plugin.applyUniforms?.(u);
            }
        }

        this.quad.draw();

        requestAnimationFrame((t) => this.draw(t));
    }
}

new App();
