// Dump generated shaders to files for human-in-the-loop review.
//
//   npm run dump:shaders                          # EVERY suite entry (witnesses ∪ demos)
//   npm run dump:shaders cornell                  # entries/strategies whose name contains "cornell"
//   npm run dump:shaders -- --scene my-scene.ts   # arbitrary module (A5): export
//                                                 #   scene: SceneDescription and
//                                                 #   strategy (or strategies: RenderStrategy[])
//
// Each shader is written to generated-shaders/<shaderId>.frag.glsl, annotated with BLOCK
// markers (via the compiler's ShaderProvenance util) so every line is traceable to its
// origin. The repo-based review workflow: regenerate after a codegen change and `git diff`
// the dumps. Runs through vite-node so the GLSL `?raw` imports resolve as in the app —
// which also means a --scene module may import any fixture or component freely.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Compiler } from '../src/compiler/Compiler.js';
import { annotateWithProvenance } from '../src/compiler/generate/ShaderProvenance.js';
import type { CompiledRenderer, SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { sceneSuite, isAsyncSceneEntry } from '../pages/registry.js';

const args = process.argv.slice(2);
const sceneFlagAt = args.indexOf('--scene');
const scenePath = sceneFlagAt >= 0 ? args[sceneFlagAt + 1] : undefined;
const filter = sceneFlagAt >= 0 ? undefined : args[0];

const CASES: Array<[string, SceneDescription, RenderStrategy]> = [];
if (scenePath !== undefined) {
    if (!scenePath) throw new Error('--scene needs a path to a module exporting { scene, strategy | strategies }');
    const mod = await import(pathToFileURL(resolve(scenePath)).href);
    const scene: SceneDescription | undefined = mod.scene ?? mod.default?.scene;
    const strategies: RenderStrategy[] = mod.strategies ?? mod.default?.strategies
        ?? (mod.strategy ?? mod.default?.strategy ? [mod.strategy ?? mod.default?.strategy] : []);
    if (!scene || strategies.length === 0) {
        throw new Error(`--scene module '${scenePath}' must export { scene, strategy } (or strategies: [...])`);
    }
    for (const strategy of strategies) CASES.push([`${scene.id}-${strategy.id}`, scene, strategy]);
} else {
    // The whole merged suite — the dump covers exactly what the gallery renders.
    for (const [key, entry] of Object.entries(sceneSuite)) {
        // Data-scene thunks fetch untracked .inst files at runtime — nothing to dump
        // node-side (their codegen is count-invariant with the fixture-covered path).
        if (isAsyncSceneEntry(entry)) continue;
        for (const strategy of entry.strategies) {
            CASES.push([`${key}-${strategy.id}`, entry.scene, strategy]);
        }
    }
}

const OUT_DIR = new URL('../generated-shaders/', import.meta.url).pathname;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const compiler = new Compiler();
const written: string[] = [];

for (const [name, scene, strategy] of CASES) {
    if (filter && !name.includes(filter)) continue;
    const r: CompiledRenderer = compiler.compile(scene, strategy);
    for (const [shaderId, prog] of r.shaders) {
        const sm = r.sourceMaps?.get(shaderId);
        const lineCount = prog.fragment.split('\n').length;
        const header =
            `// ══════════════════════════════════════════════════════════════════════\n` +
            `// GENERATED SHADER  ·  ${shaderId}  ·  scene/strategy: ${name}\n` +
            `// ${lineCount} lines · ${sm ? sm.blocks.length + ' blocks' : 'no source map'}\n` +
            `// (regenerate: npm run dump:shaders ${scenePath ? `-- --scene ${scenePath}` : filter ?? ''})\n` +
            `// ══════════════════════════════════════════════════════════════════════\n`;
        writeFileSync(`${OUT_DIR}${shaderId}.frag.glsl`, header + annotateWithProvenance(prog.fragment, sm) + '\n');
        writeFileSync(`${OUT_DIR}${shaderId}.vert.glsl`, prog.vertex + '\n');
        written.push(`${shaderId}.frag.glsl  (${lineCount} lines)`);
    }
}

console.log(`Wrote ${written.length} fragment shaders to generated-shaders/:`);
for (const w of written) console.log('  ' + w);
