// Probe: what does the compiler do today with a GLSL-expression roughness on ggx?
import { Compiler } from '/Users/stevetrettel/Code/PathTracerGLSL/src/compiler/Compiler.js';
import { veachMis } from '/Users/stevetrettel/Code/PathTracerGLSL/tests/witnesses/scenes/ggxScenes.js';
import { sceneSuite } from '/Users/stevetrettel/Code/PathTracerGLSL/pages/registry.js';
const strat = (sceneSuite as any)['veach-mis']?.strategies?.[0];
const scene = structuredClone(veachMis) as any;
scene.materials.plate1.roughness = { kind: 'glsl', source: '0.1 + 0.2 * uv.x' };
try {
    const r = new Compiler().compile(scene, strat);
    const frag = [...r.shaders.values()][0].fragment;
    const lines = frag.split('\n').filter((l: string) => /props\.(alpha|roughness)/.test(l));
    console.log('compiled; alpha/roughness lines:\n' + lines.join('\n'));
    console.log('diagnostics:', JSON.stringify((r as any).diagnostics ?? (r as any).warnings ?? null)?.slice(0, 800));
} catch (e) { console.log('THROWS:', String(e).slice(0, 800)); }
