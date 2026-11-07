import { mkdirSync, writeFileSync } from 'node:fs';
import { Compiler } from '/Users/stevetrettel/Code/PathTracerGLSL/src/compiler/Compiler.js';
import { annotateWithProvenance } from '/Users/stevetrettel/Code/PathTracerGLSL/src/compiler/generate/ShaderProvenance.js';
import { sceneSuite, isAsyncSceneEntry } from '/Users/stevetrettel/Code/PathTracerGLSL/pages/registry.js';
const OUT = '/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/curved/bypass-inventory/shaders/';
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
if (want.length === 0) { for (const [k, e] of Object.entries(sceneSuite)) { if (isAsyncSceneEntry(e)) continue; console.log(k, (e as any).strategies.map((s: any) => s.id).join(',')); } process.exit(0); }
const c = new Compiler();
for (const [k, e] of Object.entries(sceneSuite)) {
  if (isAsyncSceneEntry(e) || !want.includes(k)) continue;
  for (const s of (e as any).strategies) {
    const r = c.compile((e as any).scene, s);
    for (const [id, p] of r.shaders) writeFileSync(OUT + id + '.frag.glsl', annotateWithProvenance(p.fragment, r.sourceMaps?.get(id)));
  }
}
