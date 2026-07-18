// tests/compiler/valuesSplitPoint.test.ts
// Enforces the "one split point" invariant (docs: the constant/driven decision procedure):
// the const→literal / driven→u_ split for a SCENE_VALUE lives ONLY in generate/values.ts.
// A feature generator that emits a uniform NAME directly (via paramToUniform) has re-
// implemented emitValue's branch inline — the ior_of leak that this batch closed. Feature
// generators must route value emission through emitValue/mintValueUniform instead.
//
// (analyze/Validator.ts legitimately uses paramToUniform for collision + declared-param
// checks — that is NAME analysis, not value emission, so only generate/features/ is scanned.)

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FEATURES_DIR = join(__dirname, '../../src/compiler/generate/features');

describe('the one split point (values.ts)', () => {
    it('no feature generator emits a uniform name directly — value emission goes through values.ts', () => {
        const offenders: string[] = [];
        for (const entry of readdirSync(FEATURES_DIR)) {
            if (!entry.endsWith('.ts')) continue;
            const src = readFileSync(join(FEATURES_DIR, entry), 'utf8');
            // Strip line comments so a mention in prose doesn't trip the check.
            const code = src.replace(/\/\/[^\n]*/g, '');
            if (/\bparamToUniform\b/.test(code)) offenders.push(entry);
        }
        expect(
            offenders,
            `${offenders.join(', ')} call paramToUniform directly — route the constant/driven split `
            + `through emitValue/mintValueUniform (generate/values.ts) instead of emitting the uniform name inline`,
        ).toEqual([]);
    });
});
