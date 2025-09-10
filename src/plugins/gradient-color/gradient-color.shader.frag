#version 300 es
precision highp float;

in vec2 v_uv;

uniform vec3  u_tint;
uniform float u_time; // 0.0 disables animation

out vec4 outColor;

void main() {
    float r = v_uv.x;
    float g = v_uv.y;
    float b = 0.25 + 0.5 * v_uv.x * (1.0 - v_uv.y);

    // Optional ripple in blue channel
    float ripple = (u_time == 0.0) ? 0.0 : 0.1 * sin(6.28318 * (v_uv.x + 0.2 * u_time));
    b = clamp(b + ripple, 0.0, 1.0);

    vec3 col = vec3(r, g, b) * u_tint;
    outColor = vec4(col, 1.0);
}
