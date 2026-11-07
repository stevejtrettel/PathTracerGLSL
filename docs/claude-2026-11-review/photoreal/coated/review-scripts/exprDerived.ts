// Does a GLSL-expression value on a row that feeds a derived field (ggx roughness -> alpha) validate,
// and what does the generated alpha become?
import { Compiler } from '/Users/stevetrettel/Code/PathTracerGLSL/src/compiler/Compiler.ts';
import { minimalScene, minimalStrategy } from '/Users/stevetrettel/Code/PathTracerGLSL/tests/witnesses/scenes/minimalScene.ts';
const scene = structuredClone(minimalScene);
scene.materials.sphere = { model: 'ggx', f0: 0.9, roughness: { kind: 'glsl', source: '0.3 + 0.1*sin(p.x)' } } as any;
try {
  const out = new Compiler().compile(scene, minimalStrategy);
  for (const [id, sh] of out.shaders) {
    const lines = sh.fragment.split('\n').filter((l: string) => /alpha/.test(l) && /=/.test(l)).slice(0, 6);
    console.log(id, lines);
  }
} catch (e) { console.log('THREW:', (e as Error).message.slice(0, 400)); }
