#version 300 es

// Fullscreen triangle trick - no vertex buffer needed
out vec2 vUv;

void main() {
    // Generate fullscreen triangle from vertex ID
    vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = pos;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
