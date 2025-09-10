#version 300 es
precision highp float;

uniform vec3  u_color;
uniform float u_time;

out vec4 outColor;

void main() {
    float pulse = 0.8 + 0.2 * sin(u_time);
    vec3 col = u_color * pulse;
    outColor = vec4(col, 1.0);
}
