// Count fragment sampler uniforms per compiled program across the synchronous suite.
import { Compiler } from '/Users/stevetrettel/Code/PathTracerGLSL/src/compiler/Compiler.js';
import { sceneSuite, isAsyncSceneEntry } from '/Users/stevetrettel/Code/PathTracerGLSL/pages/registry.js';
const compiler = new Compiler();
const rows: Array<[number, string, string]> = [];
for (const [key, entry] of Object.entries(sceneSuite)) {
    if (isAsyncSceneEntry(entry)) continue;
    for (const strategy of entry.strategies) {
        let r;
        try { r = compiler.compile(entry.scene, strategy); } catch (e) { continue; }
        for (const [id, prog] of r.shaders) {
            const s = [...prog.fragment.matchAll(/uniform\s+(?:\w+p\s+)?(u?sampler\w+)\s+(\w+)/g)].map((m) => m[2]);
            rows.push([s.length, `${key}/${strategy.id}/${id}`, s.join(',')]);
        }
    }
}
rows.sort((a, b) => b[0] - a[0]);
const hist: Record<number, number> = {};
for (const r of rows) hist[r[0]] = (hist[r[0]] ?? 0) + 1;
console.log('programs', rows.length, 'histogram', JSON.stringify(hist));
for (const r of rows.slice(0, 12)) console.log(r[0], r[1], r[2]);
