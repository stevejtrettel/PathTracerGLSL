// Compiles pbrt-v4's noise.cpp with main.cpp and writes the golden values fixture.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const pbrt = join(here, '../../docs/claude-2026-11-review/photoreal/procedural-textures/ref/noise.cpp');
const binary = join(mkdtempSync(join(tmpdir(), 'perlin-golden-')), 'golden');
// -ffp-contract=off: no fused multiply-adds, so every operation rounds as written.
execFileSync('clang++', ['-std=c++17', '-O1', '-ffp-contract=off', `-I${here}`, pbrt, join(here, 'main.cpp'), '-o', binary], { stdio: 'inherit' });
writeFileSync(join(here, '../../tests/fixtures/perlin-pbrt-golden.json'), execFileSync(binary));
