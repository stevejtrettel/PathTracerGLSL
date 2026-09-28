// Exercise the generated field clamp and serialized spectral lift before the tracker's null guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Compiler } from '../src/compiler/Compiler.js';
import { spectralMediumBound } from '../src/components/color/spectral/majorant.js';
import { spectralData } from '../src/components/color/spectral/data.js';
import { mediaStrategy, spectralSlab } from '../tests/witnesses/scenes/spectralMedia.js';
import { renderProbes } from '../tools/render-glsl-probes.mjs';
const read = (name: string) => {
    const b=readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`,import.meta.url));
    return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
};
const atlas=read('coefficients'), curves=read('curves');
assert(atlas.every(v=>Number.isFinite(v) && Math.abs(v)<2048));
const nodes=Array.from({length:64},(_,i)=>curves[4*(128+i)]);
assert.equal(nodes[0],0); assert.equal(nodes[63],1);
assert(nodes.slice(1).every((v,i)=>v-nodes[i]>=2**-24));
const assets = [
    { uniform:'u_spectralCoefficients', width:spectralData.atlasWidth,height:spectralData.atlasHeight,data:Array.from(atlas) },
    { uniform:'u_spectralCurves',width:spectralData.curveWidth,height:spectralData.curveHeight,data:Array.from(curves) },
];
const compiler=new Compiler(), width=1024;
const probes: Array<{name:string;source:string;textures:object[];uniforms:object}> = [];
const ceilings=[2**-60,0.11772707849740982,1,1024,2**18];
for (const ceiling of ceilings) {
    const scene=structuredClone(spectralSlab);
    scene.materials.ink.medium={
        sigma_a:{kind:'glsl',source:'texelFetch(u_testFields,ivec2(int(gl_FragCoord.x),0),0).rgb * u_tracking_gain',
            params:[{param:'tracking.gain',default:1,min:0,max:8}]},
        sigma_s:{kind:'glsl',source:'texelFetch(u_testFields,ivec2(int(gl_FragCoord.x),1),0).rgb * u_tracking_gain'},
        majorant:ceiling,
    };
    const base=mediaStrategy('bound');
    const compiled=compiler.compile(scene,{...base,estimator:{...base.estimator,volumeSampling:'delta-tracking'}});
    const source=[...compiled.shaders.values()].find(s=>s.fragment.includes('transport_trace'))!.fragment;
    const {majorant}=spectralMediumBound(ceiling);
    const main=source.lastIndexOf('void main()');
    const fragment=source.slice(0,main).replace('#version 300 es','#version 300 es\nuniform highp sampler2D u_testFields;')+`
void main() {
    float k=mod(floor(gl_FragCoord.x),471.0);
    Wavelengths wl=Wavelengths(vec4(360.0+k,830.0-k,360.0,830.0));
    MediumProperties m=scene_medium_properties(1,vec3(0.0),wl);
    fragColor=vec4(${majorant})-(m.sigma_a+m.sigma_s);
}`;
    const fields=new Float32Array(width*2*4);
    // Black/grey, saturated/complementary channels, table-cell boundaries and neighbors,
    // tiny coefficients, oversaturation, and the known RGB-ceiling rounding counterexample.
    for (let i=0;i<width;i++) {
        const scale=[0,2**-120,ceiling*0.1,ceiling,ceiling*20,2**55][i%6];
        const x=(i%64)/63, eps=[0,2**-23,-(2**-23)][i%3];
        const c=[1,Math.max(0,Math.min(1,x+eps)),(i%7)/6];
        const a=i%8===0 ? [scale,scale,scale] : c.map(v=>v*scale);
        const s=i%5===0 ? [0,0,0] : [a[2],a[0],a[1]];
        fields.set([...a,1],4*i); fields.set([...s,1],4*(width+i));
    }
    fields.set([0.6680627465248108,0,0,1],4); fields.set([0,0,0,1],4*(width+1));
    for (const gain of [0,1,8]) probes.push({name:`ceiling=${ceiling}, gain=${gain}`,source:fragment,
        textures:[{uniform:'u_testFields',width,height:2,data:Array.from(fields)}],
        uniforms:{u_tracking_gain:{type:'float',value:gain}}});
}
const example=probes.find(p=>p.name==='ceiling=1, gain=8')!;
const bound=spectralMediumBound(1).majorant;
const mutation={...example,name:'RGB ceiling used as spectral rate',source:example.source.replace(`fragColor=vec4(${bound})`, 'fragColor=vec4(1.0)')};
assert.notEqual(mutation.source,example.source);
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
    const frames=await renderProbes(await browser.newPage(),[...probes,mutation],width,assets);
    for (let i=0;i<probes.length;i++) assert(frames[i].every(v=>Number.isFinite(v) && v>=0),probes[i].name);
    assert(frames[probes.length].some(v=>v<0),'an RGB-only majorant must fail');
    console.log(`PASS: ${probes.length*width*4} lane margins nonnegative before null clamping; RGB-majorant mutation rejected; asset range premises checked`);
} finally { await browser.close(); }
