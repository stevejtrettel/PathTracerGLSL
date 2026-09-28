// Lookup microbenchmark: same four spectral values with/without the table fetch.
// Wall time includes draw submission and a readback barrier; this is not GPU timer-query time.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { spectral } from '../src/components/color/spectral/spectral.js';
import { spectralCoefficients } from '../src/components/color/spectral/lookup.js';
import { spectralData } from '../src/components/color/spectral/data.js';
function read(name: string): number[] {
    const bytes = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
}
const atlas = read('coefficients'), curves = read('curves');
const coeff = spectralCoefficients([.2, .5, .8], new Float32Array(atlas));
const prefix = `#version 300 es\nprecision highp float;\nprecision highp int;\n#define SPECTRUM_ZERO vec4(0.0)\nuniform highp sampler2D u_spectralCoefficients;\nuniform highp sampler2D u_spectralCurves;\n${spectral.typesGLSL}\n${spectral.supportGLSL}\nout vec4 result;\n`;
const coord = 'vec4 t = fract(vec4(gl_FragCoord.x / 256.0) + vec4(0.0,0.25,0.5,0.75));';
const sources = [
    prefix + `void main(){${coord} vec3 c=vec3(${coeff.join(',')});vec4 p=(c.x*t+c.y)*t+c.z;result=0.5+0.5*p/sqrt(1.0+p*p);}`,
    prefix + `void main(){${coord} result=spectral_bounded(vec3(0.2,0.5,0.8),Wavelengths(360.0+470.0*t));}`,
];
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const result = await page.evaluate(({ sources, atlas, curves }) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const gl = canvas.getContext('webgl2')!;
        gl.getExtension('EXT_color_buffer_float');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const compile = (type: number, source: string) => {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader)!);
            return shader;
        };
        const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
        const output = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, output);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 256, 256);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
        gl.viewport(0, 0, 256, 256);
        for (const [i, data] of [atlas, curves].entries()) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, i === 0 ? 2048 : 128, i === 0 ? 384 : 2, 0, gl.RGBA, gl.FLOAT, new Float32Array(data));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        const programs = sources.map(source => {
            const program = gl.createProgram()!;
            gl.attachShader(program, vertex);
            gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program)!);
            gl.useProgram(program);
            gl.uniform1i(gl.getUniformLocation(program, 'u_spectralCoefficients'), 0);
            gl.uniform1i(gl.getUniformLocation(program, 'u_spectralCurves'), 1);
            return program;
        });
        const pixels = programs.map(program => {
            gl.useProgram(program);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const values = new Float32Array(256 * 256 * 4);
            gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.FLOAT, values);
            return values;
        });
        const maxDifference = pixels[0].reduce((m, x, i) => Math.max(m, Math.abs(x - pixels[1][i])), 0);
        if (maxDifference > 2e-5)
            throw Error(`benchmark images differ: ${maxDifference}`);
        const timing = [[], []] as number[][], barrier = new Float32Array(4);
        for (let batch = 0; batch < 4; batch++)
            for (let index = 0; index < 2; index++) {
                gl.useProgram(programs[index]);
                const start = performance.now();
                for (let i = 0; i < 24; i++)
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, barrier);
                if (batch > 0)
                    timing[index].push((performance.now() - start) / 24);
            }
        return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), timerQueryAvailable: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), maxDifference, polynomialMs: timing[0], lookupMs: timing[1] };
    }, { sources, atlas, curves });
    console.log(JSON.stringify({ size: [256, 256], frames: 24, warmupFrames: 24, assetVersion: spectralData.version, ...result }, null, 2));
}
finally {
    await browser.close();
}
