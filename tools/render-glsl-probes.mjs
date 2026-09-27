// Run small GLSL programs in a float framebuffer, without an app or dev server.
export async function renderProbes(page, shaders, width = 1, sharedTextures = [], height = 1) {
    return await page.evaluate(({ shaders, width, height, sharedTextures }) => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 is required');
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
        gl.viewport(0, 0, width, height);

        function compile(type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
            return shader;
        }
        const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`);
        return shaders.map(({ name, source, values, uniforms = {}, textures = [] }) => {
            const fragment = compile(gl.FRAGMENT_SHADER, source);
            const program = gl.createProgram();
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            gl.useProgram(program);
            if (values) gl.uniform4fv(gl.getUniformLocation(program, 'values'), values);
            for (const [name, { type, value }] of Object.entries(uniforms)) {
                const location = gl.getUniformLocation(program, name);
                if (location === null) continue; // this probe does not read the binding
                if (type === 'int') gl.uniform1i(location, value);
                else if (type === 'float') gl.uniform1f(location, value);
                else gl[`uniform${type.slice(3)}fv`](location, value);
            }
            const inputs = [...sharedTextures, ...textures].map(({ uniform, width, height, data, filter = 'nearest' }, unit) => {
                const input = gl.createTexture();
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, input);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, new Float32Array(data));
                if (filter === 'linear' && !gl.getExtension('OES_texture_float_linear')) throw new Error('Probe requires float linear filtering');
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST);
                gl.uniform1i(gl.getUniformLocation(program, uniform), unit);
                return input;
            });
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const pixels = new Float32Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
            if (gl.getError() !== gl.NO_ERROR) throw new Error(`WebGL error: ${name}`);
            inputs.forEach(input => gl.deleteTexture(input));
            gl.deleteProgram(program);
            gl.deleteShader(fragment);
            return Array.from(pixels);
        });
    }, { shaders, width, height, sharedTextures });
}
