// Execute the shipped colour GLSL in a float framebuffer. No app or dev server is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8');
const spectrum = read('color/spectrum.glsl');
const rgbTypes = read('color/rgb/types.glsl');
const rgb = read('color/rgb/rgb.glsl');
const ideal = read('sensor/ideal/ideal.glsl');
// Distinct, exactly representable weights expose a projection that bypasses the sensor.
const weighted = 'Spectrum sensor_response(vec2 film, Direction ray_dir) { return Spectrum(2.0, 3.0, 4.0); }';
const width = 120; // Divisible by 2, 3 and 4: midpoint samples give equal channel counts.

function spectrumCase(n, values, helpers = spectrum) {
    const lanes = values.slice(0, n);
    return {
        name: `${n} channels, values ${lanes}`,
        source: `#define Spectrum vec${n}
#define SPECTRUM_N ${n}
${helpers}
void main() {
    Spectrum s = values.${'xyzw'.slice(0, n)};
    result = vec4(spectrum_average(s), spectrum_max(s), float(spectrum_is_black(s)),
                  float(spectrum_sample_channel(gl_FragCoord.x / ${width}.0)));
}`,
        values,
        expected: [lanes.reduce((a, b) => a + b) / n, Math.max(...lanes), Number(lanes.every(x => x <= 0))],
        channels: n,
    };
}

function filmCase(name, sensor, expected, projection = rgb) {
    return {
        name,
        source: `${rgbTypes}\n${spectrum}\n${sensor}\n${projection}
void main() {
    result = vec4(color_to_pixel(vec2(0.0), vec3(0.0, 0.0, 1.0),
                                values.xyz, wavelengths_sample()), 1.0);
}`,
        values: [-0.25, 1.5, 4, 1],
        expected,
    };
}

function mutate(source, from, to) {
    assert(source.includes(from), `Mutation target missing: ${from}`);
    return source.replace(from, to);
}

const cases = [
    ...[2, 3, 4].flatMap(n => [[1, 2, 3, 8], [-4, -3, -2, -1], [0, 0, 0, 0], [0, 0, 0, 1]]
        .map(values => spectrumCase(n, values))),
    filmCase('identity sensor, signed/HDR film', ideal, [-0.25, 1.5, 4, 1]),
    filmCase('nonidentity sensor', weighted, [-0.5, 4.5, 16, 1]),
];
// These shaders must compile and run, then fail numerical checks. A compile failure does
// not count as catching the defect. Mutations affect only these in-memory shader strings.
const mutations = [
    spectrumCase(4, [1, 2, 3, 8], mutate(spectrum, '1.0 / float(SPECTRUM_N)', '1.0 / 3.0')),
    spectrumCase(4, [1, 2, 3, 8], mutate(spectrum,
        'min(int(u * float(SPECTRUM_N)), SPECTRUM_N - 1)', 'min(int(u * 3.0), 2)')),
    filmCase('bypassed sensor', weighted, [-0.5, 4.5, 16, 1],
        mutate(rgb, 'sensor_response(film, ray_dir) * L', 'L')),
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const frames = await page.evaluate(({ shaders, width }) => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 is required');
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
        gl.viewport(0, 0, width, 1);

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
        return shaders.map(({ name, source, values }) => {
            const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
#define Direction vec3
uniform vec4 values;
out vec4 result;
${source}`);
            const program = gl.createProgram();
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            gl.useProgram(program);
            gl.uniform4fv(gl.getUniformLocation(program, 'values'), values);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const pixels = new Float32Array(width * 4);
            gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, pixels);
            if (gl.getError() !== gl.NO_ERROR) throw new Error(`WebGL error: ${name}`);
            gl.deleteProgram(program);
            gl.deleteShader(fragment);
            return Array.from(pixels);
        });
    }, { shaders: [...cases, ...mutations], width });

    function verify(test, pixels) {
        for (let x = 0; x < width; ++x) {
            for (let c = 0; c < test.expected.length; ++c) {
                const actual = pixels[4 * x + c];
                assert(Math.abs(actual - test.expected[c]) <= 1e-6,
                    `${test.name}, component ${c}: ${actual} != ${test.expected[c]}`);
            }
            if (test.channels) {
                const expectedChannel = Math.floor((x + 0.5) * test.channels / width);
                assert.equal(pixels[4 * x + 3], expectedChannel, `${test.name}, channel selection at ${x}`);
            }
        }
    }
    cases.forEach((test, i) => verify(test, frames[i]));
    mutations.forEach((test, i) => {
        assert.throws(() => verify(test, frames[cases.length + i]), { name: 'AssertionError' },
            `Numerical check accepted a broken shader: ${test.name}`);
    });
    console.log(`PASS: ${cases.length} colour GPU cases; all ${mutations.length} deliberate defects rejected`);
} finally {
    await browser.close();
}
