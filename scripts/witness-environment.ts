// Execute the chart/CDF GLSL and integrate its density on an independent sphere grid.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ENV_CHARTS } from '../src/components/env/index.js';
import sampler from '../src/components/env/sampler_cdf.glsl?raw';
import rng from '../src/components/sampler/pcg4d/pcg4d.glsl?raw';
import { buildEnvImportanceTable } from '../src/components/env/importance.js';
import { renderProbes } from '../tools/render-glsl-probes.mjs';

const W = 4, H = 3, N = 16384, phiBins = 8, yBins = 8;
const rgba = (values: Float32Array) => Array.from(values).flatMap(v => [v, 0, 0, 0]);
const cases = Object.values(ENV_CHARTS).flatMap(chart => ['varied', 'hdr', 'empty', 'compensated', 'comp-empty'].map(kind => {
    const rgb = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
        const v = kind === 'empty' ? 0 : kind === 'comp-empty' ? 1
            : kind === 'hdr' ? (i === 0 ? 1e20 : 1e-20) : (i % 5 === 0 ? 10 : 0.1);
        rgb.fill(v, 3 * i, 3 * i + 3);
    }
    const compensation = kind.startsWith('comp');
    const table = buildEnvImportanceTable(rgb, W, H, { chart: chart.id, compensation, blur: false });
    const header = `#version 300 es
precision highp float;
precision highp int;
#define PI 3.141592653589793
#define TWO_PI 6.283185307179586
#define MAX_DIST 1000.0
#define Point vec3
struct Wavelengths { float unused; };
struct LightSample { vec3 wi; float distance; vec3 radiance; float pdf; uint flags; int light_id; };
uniform sampler2D u_envCdfCond, u_envCdfMarg;
const vec2 u_envSize = vec2(${W}.0,${H}.0);
const float u_envRotation = 0.73;
const vec2 u_envRotCS = vec2(cos(0.73),sin(0.73));
const bool ENV_COMPENSATED = ${compensation};
vec3 env_rotate_cs(vec3 d, vec2 cs) { return vec3(cs.x*d.x-cs.y*d.z,d.y,cs.y*d.x+cs.x*d.z); }
vec3 environment_radiance(vec3 d, Wavelengths wl) { return vec3(1.0); }
out vec4 fragColor;
${rng}
${chart.needs.map(b => b.source).join('\n')}
${chart.glsl}
${sampler}
`;
    const textures = [
        { uniform: 'u_envCdfCond', width: W, height: H, data: rgba(table.condCDF) },
        { uniform: 'u_envCdfMarg', width: 1, height: H, data: rgba(table.margCDF) },
    ];
    // 128 × 128 equal-solid-angle midpoint quadrature. No chart inverse is used
    // to construct these directions or the histogram bins below.
    const integral = `void main() {
        int i = int(gl_FragCoord.x) + 128 * int(gl_FragCoord.y);
        float y = 1.0 - 2.0 * (float(i / 128) + 0.5) / 128.0;
        float phi = TWO_PI * (float(i % 128) + 0.5) / 128.0;
        float r = sqrt(1.0-y*y);
        vec3 d = vec3(r*cos(phi),y,r*sin(phi));
        fragColor = vec4(d,environment_pdf(d));
    }`;
    const sample = `void main() {
        rng_init(uvec2(gl_FragCoord.xy),0u,173u);
        LightSample s = environment_sample(vec3(0.0), random2(), Wavelengths(0.0));
        fragColor = vec4(s.wi,s.pdf);
    }`;
    const endpoints = `void main() {
        vec2 xi = vec2((int(gl_FragCoord.x) % 2) == 0 ? 0.0 : 0.99999994,
                       (int(gl_FragCoord.x) % 4) < 2 ? 0.0 : 0.99999994);
        LightSample s = environment_sample(vec3(0.0),xi,Wavelengths(0.0));
        fragColor = vec4(s.wi,s.pdf);
    }`;
    return { name: `${chart.id}/${kind}`, empty: kind === 'comp-empty', compensation,
        probes: [integral, sample, endpoints].map(body => ({ name: `${chart.id}/${kind}`, source: header + body, textures })) };
}));
function bin(frame: number[], i: number) {
    const phi = (Math.atan2(frame[i+2], frame[i]) + 2 * Math.PI) % (2 * Math.PI);
    return Math.min(yBins-1, Math.floor((frame[i+1]+1)*0.5*yBins)) * phiBins
        + Math.min(phiBins-1, Math.floor(phi/(2*Math.PI)*phiBins));
}
function verify(c: typeof cases[number], frames: number[][]) {
    const mass = new Float64Array(phiBins*yBins), counts = new Float64Array(mass.length);
    let integral = 0;
    for (let i = 0; i < 4*N; i += 4) {
        const q = frames[0][i+3];
        const dm = q * 4*Math.PI/N;
        integral += dm; mass[bin(frames[0],i)] += dm;
        counts[bin(frames[1],i)]++;
        if (!c.compensation) assert(q >= 0.0625/(4*Math.PI) * 0.99999, `${c.name}: lost support`);
    }
    for (const frame of frames) assert(frame.every(Number.isFinite), `${c.name}: finite RNG endpoints`);
    assert(Math.abs(integral - (c.empty ? 0 : 1)) < 0.012, `${c.name}: PDF integral ${integral}`);
    if (c.empty) {
        for (let i=3; i<frames[1].length; i+=4) assert.equal(frames[1][i],0);
    } else {
        let chi2 = 0, cells = 0;
        for (let b=0; b<mass.length; b++) {
            const expected = N*mass[b];
            if (expected < 5) continue;
            chi2 += (counts[b]-expected)**2/expected; cells++;
        }
        assert(chi2/(cells-1) < 3, `${c.name}: histogram chi² ${chi2/(cells-1)}`);
    }
    return integral;
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const frames = await renderProbes(page, cases.flatMap(c=>c.probes), 128, [], 128);
    cases.forEach((c,i) => console.log(`PASS ${c.name}: sphere integral ${verify(c,frames.slice(3*i,3*i+3)).toFixed(6)}, histogram/support/endpoints`));
    const mutations = [
        ['missing sphere support', 'hdr', '? 0.0625 : 1.0', '? 0.0 : 1.0'],
        ['component-only PDF', 'varied', ' + a / (4.0 * PI)', ''],
        ['midpoint cell area', 'varied', '2.0 * sin(theta) * sin(0.5 * PI / float(sz.y))', 'sin(theta) * PI / float(sz.y)'],
        ['uniform UV placement', 'varied', 'env_chart_sample(ivec2(i, j), vec2(uFrac, vFrac), sz)', 'env_chart_dir((vec2(i,j) + vec2(uFrac,vFrac))/vec2(sz))'],
    ];
    for (const [name,kind,from,to] of mutations) {
        const c = cases.find(c=>c.name===`equirect/${kind}`)!;
        const probes = c.probes.map(p=>({ ...p, source: p.source.replace(from,to) }));
        assert.notEqual(probes[0].source,c.probes[0].source);
        const broken = await renderProbes(page,probes,128,[],128);
        assert.throws(()=>verify(c,broken),{ name: 'AssertionError' });
        console.log(`PASS: ${name} mutation rejected`);
    }
} finally { await browser.close(); }
