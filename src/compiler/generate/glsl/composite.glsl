// Composite Pass
// Full fragment shader — copies texture to screen

uniform vec2 u_resolution;
uniform sampler2D u_rgb;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    fragColor = texture(u_rgb, uv);
}
