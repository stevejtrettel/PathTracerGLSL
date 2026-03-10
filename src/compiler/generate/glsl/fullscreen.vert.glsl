// Fullscreen triangle vertex shader
// Uses gl_VertexID trick — no VAO needed, draw 3 vertices

void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
