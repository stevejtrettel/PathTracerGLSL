// Generated index/collapse probes plus transport against quadrature and a scalar-wavelength estimator.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Compiler } from '../src/compiler/Compiler.js';
import { packSceneData } from '../src/app/sceneData.js';
import { spectralData } from '../src/components/color/spectral/data.js';
import { spectralCurves } from '../src/components/color/spectral/lookup.js';
import { dispersionSlab, dispersionStrategy } from '../tests/witnesses/scenes/spectralDispersion.js';
import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { N_BK7 } from '../src/authoring/opticalGlass.js';
import { renderProbes } from '../tools/render-glsl-probes.mjs';
const compiler = new Compiler();
const assets = ['coefficients', 'curves'].map((name, i) => {
    const bytes = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return { uniform: i === 0 ? 'u_spectralCoefficients' : 'u_spectralCurves',
        width: i === 0 ? spectralData.atlasWidth : spectralData.curveWidth,
        height: i === 0 ? spectralData.atlasHeight : spectralData.curveHeight,
        data: Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) };
});
async function program(scene = dispersionSlab, strategy = dispersionStrategy) {
    const compiled = compiler.compileScene(scene, [strategy]);
    const renderer = compiled.renderers[0];
    const source = [...renderer.shaders.values()].find(s => s.fragment.includes('transport_trace'))!.fragment;
    const data = await packSceneData(compiled.sceneData);
    return { source: source.slice(0, source.lastIndexOf('void main()')),
        uniforms: Object.fromEntries(renderer.uniforms.map(u => [u.uniform, { type: u.type, value: u.compute({}) }])),
        textures: Object.entries(data?.channels ?? {}).map(([channel, t]) => ({
            uniform: `u_data_${channel}`, width: t.width, height: t.height, data: Array.from(t.data),
        })) };
}
const wl = 'Wavelengths(vec4(400.0,500.0,600.0,700.0))';
const ray = `make_ray(vec3(0,0,2), vec3(0,0,-1), ${wl})`;
const fixed: Array<{ name: string; source: string; uniforms: object; textures: object[]; expected: number[] }> = [];
const base = await program();
const add = (name: string, body: string, expected: number[], p = base) => {
    const probe = { ...p, name, source: p.source + `void main() { ${body} }`, expected };
    fixed.push(probe); return probe;
};
for (const objectDispatch of ['unrolled', 'table'] as const) {
    const p = await program(dispersionSlab, { ...dispersionStrategy, estimator: { ...dispersionStrategy.estimator, objectDispatch } });
    add(`index ${objectDispatch}`, `fragColor=vec4(ior_of(0,vec3(0),${wl}));`, [1.5625,1.5625,1.5625,1.5625], p);
    add(`oblique Snell ${objectDispatch}`, `Ray ray=make_ray(vec3(0,0,2),vec3(0.4,0,-sqrt(0.84)),${wl});
        Hit hit; scene_intersect(ray,hit); MaterialProperties mp=scene_material_properties(0,hit.p,hit.uv,hit.element,hit.wl);
        InteractionSample bs=dielectric_sample(-ray.direction,hit,mp,0.999,vec2(0.5)); fragColor=vec4(bs.wi,bs.weight.x);`,
        [0.4/1.5625, 0, -Math.sqrt(1-(0.4/1.5625)**2), 1/1.5625**2], p);
}
add('interior Snell exit', `Ray ray=make_ray(vec3(0),vec3(0.4,0,sqrt(0.84)),${wl});
    Hit hit; scene_intersect(ray,hit); MaterialProperties mp=scene_material_properties(0,hit.p,hit.uv,hit.element,hit.wl);
    InteractionSample bs=dielectric_sample(-ray.direction,hit,mp,0.999,vec2(0.5)); fragColor=vec4(bs.wi,bs.weight.x);`,
    [0.4*1.5625,0,Math.sqrt(1-(0.4*1.5625)**2),1.5625**2]);
add('total internal reflection', `Ray ray=make_ray(vec3(0),vec3(0.8,0,0.6),${wl});
    Hit hit; scene_intersect(ray,hit); MaterialProperties mp=scene_material_properties(0,hit.p,hit.uv,hit.element,hit.wl);
    InteractionSample bs=dielectric_sample(-ray.direction,hit,mp,0.999,vec2(0.5)); fragColor=vec4(bs.wi,bs.weight.x);`,
    [0.8,0,-0.6,1]);
add('hero coordinate changes index', 'fragColor=vec4(ior_of(0,vec3(0),Wavelengths(vec4(700,400,500,600))));',
    Array(4).fill(1.5+0.01/0.7**2));
add('three Cauchy coefficients', 'fragColor=vec4(cauchy_index(vec3(1.5,0.01,0.001),500.0));', Array(4).fill(1.556));
const glowing=structuredClone(dispersionSlab);
glowing.materials.glow={model:'none',medium:{emission:0.2}};
glowing.objects.push({type:'box',parameters:{center:[0,0,1.25],halfSize:[100,100,0.25]},material:'glow'});
add('volume emission before glass', `rng_init(uvec2(0),0u,317u); fragColor=transport_trace(${ray}); fragColor.x=0.0;`,
    [0,...[500,600,700].map(lambda=>0.1*spectralCurves(lambda,new Float32Array(assets[1].data))[3])], await program(glowing));
const twice = add('one-time collapse', `PathState s=path_state_init(${ray}); s.throughput=vec4(0.1,0.2,0.3,0.4);
    collapse_wavelengths(s); collapse_wavelengths(s); fragColor=s.throughput;`, [0.4,0,0,0]);
add('preserve earlier radiance', `PathState s=path_state_init(${ray}); s.radiance=vec4(1,2,3,4);
    collapse_wavelengths(s); fragColor=s.radiance;`, [1,2,3,4]);
const mirror = structuredClone(dispersionSlab); mirror.materials.lamp = { model: 'mirror', albedo: 1 };
add('index-independent boundary', `PathState s=path_state_init(${ray});
    if(surface_uses_dispersion(1,0,-1)) collapse_wavelengths(s); fragColor=s.throughput;`, [1,1,1,1], await program(mirror));
const finalVertex = await program(dispersionSlab, { ...dispersionStrategy,
    measurement: { ...dispersionStrategy.measurement, maxBounces: 0 } });
add('emission-only budget vertex', `fragColor=transport_trace(${ray});`, [1,1,1,1],
    { ...finalVertex, source: finalVertex.source.replace('return s.radiance;', 'return s.throughput;') });
const mutations = [
    { ...twice, name: 'repeated factor', source: twice.source.replace('if (s.wavelengths_collapsed) return;', '') },
    { ...twice, name: 'missing compensation', source: twice.source.replace('vec4(float(SPECTRUM_N), 0.0, 0.0, 0.0)', 'vec4(1.0, 0.0, 0.0, 0.0)') },
];
const bk7Slab = structuredClone(dispersionSlab);
bk7Slab.materials.glass.ior = N_BK7;
for (const objectDispatch of ['unrolled', 'table'] as const) {
    const p = await program(bk7Slab, { ...dispersionStrategy,
        estimator: { ...dispersionStrategy.estimator, objectDispatch } });
    for (const [lambda, n] of [[404.6561, 1.53024], [587.5618, 1.51680], [706.5188, 1.51289]]) {
        const probe = add(`N-BK7 ${lambda} nm / ${objectDispatch}`,
            `fragColor=vec4(ior_of(0,vec3(0),Wavelengths(vec4(${lambda},500,600,700))));`, Array(4).fill(n), p);
        if (lambda === 404.6561 && objectDispatch === 'unrolled') mutations.push({
            ...probe, name: 'missing Sellmeier square root',
            source: probe.source.replace('sqrt(1.0 + terms.x + terms.y + terms.z)', '(1.0 + terms.x + terms.y + terms.z)'),
        });
    }
    const n = 1.53024;
    add(`N-BK7 Snell / ${objectDispatch}`,
        `Ray ray=make_ray(vec3(0,0,2),vec3(0.4,0,-sqrt(0.84)),Wavelengths(vec4(404.6561,500,600,700)));
        Hit hit; scene_intersect(ray,hit); MaterialProperties mp=scene_material_properties(0,hit.p,hit.uv,hit.element,hit.wl);
        InteractionSample bs=dielectric_sample(-ray.direction,hit,mp,0.999,vec2(0.5)); fragColor=vec4(bs.wi,bs.weight.x);`,
        [0.4/n, 0, -Math.sqrt(1-(0.4/n)**2), 1/n**2], p);
}
function verify(p: typeof fixed[number], values: number[]) {
    p.expected.forEach((v,c) => assert(Math.abs(values[c]-v) < 2e-5, `${p.name}: lane ${c}: ${values[c]} != ${v}`));
}
// Unit RGB emission reconstructs the shipped normalized D65. At normal incidence and
// maxBounces=2, only two transmissions reach the far-side emitter: (1-F(lambda))².
const curves = new Float32Array(assets[1].data);
function slabTarget(index: (lambda: number) => number): number[] {
    const xyz = [0,0,0];
    for (let i=0; i<=1880; i++) {
        const lambda=360+i*0.25, n=index(lambda), F=((n-1)/(n+1))**2;
        const cmf=spectralCurves(lambda,curves), w=0.25/3*(i===0||i===1880?1:i%2?4:2);
        for(let c=0;c<3;c++) xyz[c]+=w*(1-F)**2*cmf[3]*cmf[c]/spectralData.cieYIntegral;
    }
    return spectralData.xyzToRGB.map(row=>row.reduce((s,v,i)=>s+v*xyz[i],0));
}
const target=slabTarget(lambda => 1.5+0.01/(lambda*0.001)**2);
function integralProbe(name: string, p: Awaited<ReturnType<typeof program>>, scalar = false, origin = 'vec3(0,0,2)') {
    // Scalar reference: all four evaluation coordinates equal the hero. The four equal
    // lanes are averaged as usual; there is no packet collapse or factor-of-four operation.
    const source = scalar ? p.source.replace('s.wavelengths_collapsed = false;', 's.wavelengths_collapsed = true;') : p.source;
    return { ...p, name, source: source + `void main() {
        vec3 sum=vec3(0);
        for(uint j=0u;j<64u;j++) {
            rng_init(uvec2(gl_FragCoord.xy),j,317u);
            WavelengthSample camera_sample=wavelengths_sample();
            ${scalar ? 'camera_sample.wl.lambda=vec4(camera_sample.wl.lambda.x); camera_sample.pdf=vec4(camera_sample.pdf.x);' : ''}
            Ray ray=make_ray(${origin},vec3(0,0,-1),camera_sample.wl);
            sum+=color_to_pixel(vec2(0),ray.direction,transport_trace(ray),camera_sample);
        }
        fragColor=vec4(sum/64.0,1);
    }` };
}
function stats(pixels: number[]) {
    const n=pixels.length/4, mean=[0,0,0], se=[0,0,0];
    for(let i=0;i<n;i++) for(let c=0;c<3;c++) mean[c]+=pixels[4*i+c]/n;
    for(let i=0;i<n;i++) for(let c=0;c<3;c++) se[c]+=(pixels[4*i+c]-mean[c])**2/(n*(n-1));
    return {mean,se:se.map(Math.sqrt)};
}
function agrees(name:string, a:ReturnType<typeof stats>, expected:number[], otherSE=[0,0,0]) {
    a.mean.forEach((v,c)=>assert(Math.abs(v-expected[c]) < 5*Math.hypot(a.se[c],otherSE[c])+0.0002,
        `${name} channel ${c}: ${v} != ${expected[c]} (SE ${a.se[c]}, ${otherSE[c]})`));
    console.log(`PASS ${name}: ${a.mean.map(v=>v.toFixed(5)).join(', ')}; SE ${a.se.map(v=>v.toFixed(5)).join(', ')}`);
}
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
    const page=await browser.newPage();
    const frames=await renderProbes(page,[...fixed,...mutations],1,assets);
    fixed.forEach((p,i)=>verify(p,frames[i]));
    mutations.forEach((p,i)=>assert.throws(()=>verify(p,frames[fixed.length+i]),{name:'AssertionError'}));
    console.log(`PASS ${fixed.length} fixed probes; index/compensation mutations rejected`);
    if (!process.argv.includes('--fixed')) {
    const slab=stats((await renderProbes(page,[integralProbe('normal slab',base)],128,assets,128))[0]);
    agrees('normal slab vs independent quadrature',slab,target);
    console.log(`slab target: ${target.join(', ')}`);
    const bk7Program = await program(bk7Slab);
    const bk7Frame = stats((await renderProbes(page,[integralProbe('N-BK7 slab',bk7Program)],128,assets,128))[0]);
    // Independent evaluation of the datasheet equation, expressed as B/(1-C/lambda²).
    const bk7Target = slabTarget(lambda => Math.sqrt(1 + N_BK7.sellmeier.B.reduce(
        (sum, b, i) => sum + b / (1 - N_BK7.sellmeier.C[i] * (1000/lambda)**2), 0)));
    agrees('N-BK7 slab vs independent quadrature',bk7Frame,bk7Target);
    const cases = ['dielectric','rough_dielectric'].flatMap(model =>
        (['none','nee','mis'] as const).map(method => ({model,method,medium:'analytic'})));
    cases.push({model:'dielectric',method:'none',medium:'tracking'},
        {model:'rough_dielectric',method:'nee',medium:'tracking'},
        {model:'dielectric',method:'none',medium:'grin'});
    for(const {model,method,medium} of cases) {
        const scene:SceneDescription=structuredClone(dispersionSlab);
        scene.objects[0]={type:'sphere',parameters:{radius:0.7},material:'glass'};
        scene.objects.pop();
        scene.materials.glass.model=model; scene.materials.glass.roughness=0.4;
        scene.materials.fog={model:'none',medium:{sigma_a:[0.06,0.2,0.4],sigma_s:0.15}};
        if(medium==='tracking') scene.materials.fog.medium={sigma_a:{kind:'glsl',source:'vec3(0.06,0.2,0.4)'},sigma_s:0.15,majorant:1};
        if(medium==='grin') scene.materials.fog.medium={sigma_a:[0.06,0.2,0.4],ior:1};
        scene.objects.push({type:'sphere',parameters:{radius:1.5},material:'fog'});
        scene.environment={type:'constant',color:1,sampleAsLight:true};
        const strategy:RenderStrategy={...dispersionStrategy,measurement:{...dispersionStrategy.measurement,maxBounces:4},
            estimator:{...dispersionStrategy.estimator,directLighting:method,volumeSampling:medium==='tracking'?'delta-tracking':'analytic',russianRoulette:{startDepth:1,maxSurvival:0.95}}};
        const p=await program(scene,strategy);
        const pair=await renderProbes(page,[integralProbe('packet',p),integralProbe('scalar',p,true)],128,assets,128);
        const a=stats(pair[0]), b=stats(pair[1]); agrees(`${model}/${method}/${medium} through chromatic fog vs scalar`,a,b.mean,b.se);
    }
    const inside:SceneDescription={...dispersionSlab,
        materials:{glass:{model:'rough_dielectric',ior:{cauchy:[1.5,0.1]},roughness:0.5}},
        objects:[{type:'sphere',parameters:{radius:1},material:'glass'}],
        environment:{type:'constant',color:1,sampleAsLight:true}};
    const insideProgram=await program(inside,{...dispersionStrategy,
        measurement:{...dispersionStrategy.measurement,maxBounces:1},
        estimator:{...dispersionStrategy.estimator,directLighting:'nee'}});
    const collapse='if (surface_uses_dispersion(mat, hit.region_from, hit.region_to)) collapse_wavelengths(s);';
    const nee='light_sample_direct(s, hit, mat, wo, props);';
    const late={...insideProgram,source:insideProgram.source.replace(collapse,'').replace(nee,nee+' '+collapse)};
    assert.notEqual(late.source,insideProgram.source);
    const insideFrames=await renderProbes(page,[integralProbe('inside packet',insideProgram,false,'vec3(0)'),
        integralProbe('inside scalar',insideProgram,true,'vec3(0)')],128,assets,128);
    const a=stats(insideFrames[0]),b=stats(insideFrames[1]);
    agrees('camera inside rough glass vs scalar',a,b.mean,b.se);
    // Inspect the walk's radiance lanes directly: NEE at this first interface must
    // never score companion lanes, whatever the rough-glass estimator's variance.
    const laneProbe=(p:typeof insideProgram)=>({...p,name:'first-interface NEE lanes',source:p.source+`void main(){
        rng_init(uvec2(gl_FragCoord.xy),0u,317u);
        fragColor=transport_trace(make_ray(vec3(0),vec3(0,0,-1),${wl})); }`});
    const lanes=await renderProbes(page,[laneProbe(insideProgram),laneProbe(late)],64,assets);
    assert(lanes[0].some((v:number,i:number)=>i%4===0&&v>0),'NEE must contribute');
    assert(lanes[0].every((v:number,i:number)=>i%4===0||v===0),'secondary lanes survived early collapse');
    assert(lanes[1].some((v:number,i:number)=>i%4!==0&&v>0),'late-collapse mutation must score secondary lanes');
    console.log('PASS: collapse-after-NEE mutation rejected by surviving-lane check');
    }
} finally {await browser.close();}
