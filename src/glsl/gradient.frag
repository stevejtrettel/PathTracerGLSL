#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

// Uniforms that will be provided by our application
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

void main() {
    // Convert UV to pixel coordinates
    vec2 pixel = vUv * u_resolution;

    // Create animated gradient
    float wave = sin(u_time * 2.0 + vUv.x * 10.0) * 0.5 + 0.5;

    // Mouse interaction - distance from mouse
    vec2 mouseUV = u_mouse / u_resolution;
    float mouseDist = length(vUv - mouseUV);
    float mouseEffect = 1.0 - smoothstep(0.0, 0.3, mouseDist);

    // Combine effects
    vec3 color = vec3(vUv, wave);
    color += mouseEffect * vec3(1.0, 1.0, 0.0); // Yellow near mouse

    fragColor = vec4(color, 1.0);
}
