import type { ColorPlugin } from "./types";
import Uniforms from "./Uniforms";

/**
 * SolidColorPlugin (animated, prefixed)
 * - Generates a prefixed uniform name in GLSL (e.g., "u_solid_u_color").
 * - Still sets uniforms by local name ("u_color"); the Uniforms helper maps it.
 */
export default class SolidColorPlugin implements ColorPlugin {
    private color: [number, number, number];
    private speed: number; // radians/sec
    private startMs = performance.now();
    private prefix: string; // e.g., "u_solid_"

    constructor(
        color: [number, number, number] = [1, 0, 0],
        speed = 1.0,
        prefix = "" // pass a prefix to enable namespacing
    ) {
        this.color = color;
        this.speed = speed;
        this.prefix = prefix;
    }

    getFragmentSource(): string {
        // NOTE: We apply the same prefix here that Uniforms will use when setting.
        const uColor = `${this.prefix}u_color`;
        const uTime  = `${this.prefix}u_time`;

        return `#version 300 es
      precision highp float;

      uniform vec3  ${uColor};
      uniform float ${uTime};

      out vec4 outColor;

      void main() {
        float pulse = 0.8 + 0.2 * sin(${uTime});
        vec3 col = ${uColor} * pulse;
        outColor = vec4(col, 1.0);
      }
    `;
    }

    applyUniforms(u: Uniforms): void {
        const [r, g, b] = this.color;
        u.set3f("u_color", r, g, b); // local name
        const elapsedSec = (performance.now() - this.startMs) * 0.001;
        u.set1f("u_time", elapsedSec * this.speed); // local name
    }

    setColor(c: [number, number, number]): void { this.color = c; }
    getColor(): [number, number, number] { return this.color; }
    setSpeed(omega: number): void { this.speed = omega; }
    getSpeed(): number { return this.speed; }
}
