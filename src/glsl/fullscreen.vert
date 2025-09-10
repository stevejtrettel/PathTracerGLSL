#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;

void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}


//#version 300 es
//
//// Fullscreen triangle trick - no vertex buffer needed
//out vec2 vUv;
//
//void main() {
//    // Generate fullscreen triangle from vertex ID
//    vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
//    vUv = pos;
//    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
//}
