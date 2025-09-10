import type { ColorPlugin } from "./types";
import Uniforms from "./Uniforms";

/**
 * GradientColorPlugin (prefixed, optional animation)
 * - Colors by v_uv (x→R, y→G, simple function for B).
 * - Supports a tint (vec3) and optional time ripple (speed=0 disables).
 * - Uses local uniform names: "u_tint", "u_time" — Uniforms maps prefix.
 * - Assumes vertex shader provides `out vec2 v_uv;`.
 */
export default class GradientColorPlugin implements ColorPlugin {
    private prefix: string;                 // e.g., "u_grad_"
    private tint: [number, number, number]; // color multiplier
    private speed: number;                  // radians/sec; 0 = no animation
    private startMs = performance.now();

    constructor(opts?: {
        prefix?: string;
        tint?: [number, number, number];
        speed?: number;
    }) {
        this.prefix = opts?.prefix ?? "";
        this.tint   = opts?.tint   ?? [1, 1, 1];
        this.speed  = opts?.speed  ?? 0.0; // default: static gradient
    }

    getFragmentSource(): string {
        const uTint = `${this.prefix}u_tint`;
        const uTime = `${this.prefix}u_time`;

        // Note: v_uv must come from the vertex shader.
        return `#version 300 es
      precision highp float;

      in vec2 v_uv;
      uniform vec3  ${uTint};
      uniform float ${uTime};   // ok if 0.0 (static)

      out vec4 outColor;

      void main() {
        // Base UV gradient
        float r = v_uv.x;
        float g = v_uv.y;
        float b = 0.25 + 0.5 * v_uv.x * (1.0 - v_uv.y);

        // Optional gentle time ripple in blue channel
        float ripple = ${uTime} == 0.0 ? 0.0 : 0.1 * sin(6.28318 * (v_uv.x + 0.2 * ${uTime}));
        b = clamp(b + ripple, 0.0, 1.0);

        vec3 col = vec3(r, g, b) * ${uTint};
        outColor = vec4(col, 1.0);
      }
    `;
    }

    applyUniforms(u: Uniforms): void {
        const [tr, tg, tb] = this.tint;
        u.set3f("u_tint", tr, tg, tb);

        // If speed is 0, keep time at 0 for a static shader path.
        const elapsedSec = (performance.now() - this.startMs) * 0.001;
        const t = this.speed !== 0 ? elapsedSec * this.speed : 0.0;
        u.set1f("u_time", t);
    }

    setTint(t: [number, number, number]) { this.tint = t; }
    getTint(): [number, number, number]  { return this.tint; }

    setSpeed(omega: number) { this.speed = omega; }
    getSpeed(): number      { return this.speed; }
}
