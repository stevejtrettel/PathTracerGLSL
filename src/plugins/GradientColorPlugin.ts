import type { ColorPlugin } from "./types";

/**
 * GradientColorPlugin
 * - Full fragment shader that colors by interpolated UV (v_uv).
 * - No uniforms yet; applyUniforms is a no-op.
 * - Assumes the vertex shader provides `out vec2 v_uv;`.
 */
export default class GradientColorPlugin implements ColorPlugin {
    getFragmentSource(): string {
        return `#version 300 es
      precision highp float;

      in vec2 v_uv;
      out vec4 outColor;

      void main() {
        // Simple UV gradient: red = x, green = y, blue = a soft function of both
        float blue = 0.25 + 0.5 * v_uv.x * (1.0 - v_uv.y);
        outColor = vec4(v_uv.x, v_uv.y, blue, 1.0);
      }
    `;
    }

    applyUniforms(): void {
        // No uniforms for this simple gradient.
    }
}
