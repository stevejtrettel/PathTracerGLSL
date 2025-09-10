import type { ColorPlugin } from "./types";
import Uniforms from "./Uniforms";

/**
 * SolidColorPlugin (animated)
 * - Outputs a constant color modulated over time.
 * - Owns a local-time uniform `u_time` and updates it each frame.
 * - No changes needed in main.ts — plugin is self-contained.
 */
export default class SolidColorPlugin implements ColorPlugin {
    private color: [number, number, number];
    private speed: number; // radians per second
    private startMs = performance.now();

    constructor(
        color: [number, number, number] = [1, 0, 0],
        speed = 1.0 // animation speed (ω); try 0.5 .. 3.0
    ) {
        this.color = color;
        this.speed = speed;
    }

    getFragmentSource(): string {
        return `#version 300 es
      precision highp float;

      // Local plugin uniforms
      uniform vec3  u_color;
      uniform float u_time;  // seconds since plugin started

      out vec4 outColor;

      void main() {
        // Brightness pulsing between ~60% and 100%
        float pulse = 0.8 + 0.2 * sin(u_time);
        vec3 col = u_color * pulse;
        outColor = vec4(col, 1.0);
      }
    `;
    }

    applyUniforms(u: Uniforms): void {
        const [r, g, b] = this.color;
        u.set3f("u_color", r, g, b);

        // Compute elapsed seconds and scale by speed (in radians/sec)
        const elapsedSec = (performance.now() - this.startMs) * 0.001;
        u.set1f("u_time", elapsedSec * this.speed);
    }

    setColor(c: [number, number, number]): void {
        this.color = c;
    }

    getColor(): [number, number, number] {
        return this.color;
    }

    setSpeed(omega: number): void {
        this.speed = omega;
    }

    getSpeed(): number {
        return this.speed;
    }
}
