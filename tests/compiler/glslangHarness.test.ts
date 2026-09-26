// The glslang harness must tell "the validator could not run on this machine" apart from "the
// validator crashed on this shader": both leave no exit status, but only the second is about the
// shader. A fake validator that kills itself stands in for a crash.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const original = process.env.GLSLANG_VALIDATOR;
afterEach(() => {
    if (original === undefined) delete process.env.GLSLANG_VALIDATOR; else process.env.GLSLANG_VALIDATOR = original;
    vi.resetModules();
});

async function helperWith(binary: string) {
    process.env.GLSLANG_VALIDATOR = binary;
    vi.resetModules();
    return import('../helpers/glslangCheck.js');
}

describe('glslang harness', () => {
    it('reports a validator killed by a signal as a crash on the shader, not a missing binary', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'glslang-fake-'));
        const fake = join(dir, 'crash.sh');
        writeFileSync(fake, '#!/bin/sh\nkill -SEGV $$\n');
        chmodSync(fake, 0o755);
        const { glslangCheck } = await helperWith(fake);
        expect(() => glslangCheck('void main() { /* crash */ }', 'frag', 'probe')).toThrow(/crashed.*SIGSEGV/);
    });

    it('reports a binary that cannot start as the machine, not the shader', async () => {
        const { glslangCheck } = await helperWith(join(tmpdir(), 'no-such-glslang-binary'));
        expect(() => glslangCheck('void main() { /* missing */ }', 'frag', 'probe')).toThrow(/could not be run/);
    });
});
