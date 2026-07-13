// Dump generated shaders to files for human-in-the-loop review.
//
//   npm run dump:shaders            # all built-in scene/strategy cases
//   npm run dump:shaders cornell    # only cases whose name contains "cornell"
//
// Each shader is written to generated-shaders/<shaderId>.frag.glsl, annotated with BLOCK
// markers (via the compiler's ShaderProvenance util) so every line is traceable to its
// origin. The repo-based review workflow: regenerate after a codegen change and `git diff`
// the dumps. Runs through vite-node so the GLSL `?raw` imports resolve as in the app.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Compiler } from '../src/compiler/Compiler.js';
import { annotateWithProvenance } from '../src/compiler/generate/ShaderProvenance.js';
import type { CompiledRenderer, SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from '../src/witnesses/scenes/minimalScene.js';
import { cornellBox, cornellStrategy } from '../src/witnesses/scenes/cornellBox.js';

const CASES: Array<[string, SceneDescription, RenderStrategy]> = [
    ['cornell-pathtracer', cornellBox, cornellStrategy],
    ['minimal-pathtracer', minimalScene, minimalStrategy],
    ['minimal-direct', minimalScene, directOnlyStrategy],
];

const OUT_DIR = new URL('../generated-shaders/', import.meta.url).pathname;

const filter = process.argv[2];
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
            `// (regenerate: npm run dump:shaders ${filter ?? ''})\n` +
            `// ══════════════════════════════════════════════════════════════════════\n`;
        writeFileSync(`${OUT_DIR}${shaderId}.frag.glsl`, header + annotateWithProvenance(prog.fragment, sm) + '\n');
        writeFileSync(`${OUT_DIR}${shaderId}.vert.glsl`, prog.vertex + '\n');
        written.push(`${shaderId}.frag.glsl  (${lineCount} lines)`);
    }
}

console.log(`Wrote ${written.length} fragment shaders to generated-shaders/:`);
for (const w of written) console.log('  ' + w);
