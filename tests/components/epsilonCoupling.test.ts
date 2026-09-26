// The epsilon-coupling gate (fable-sdf-contract §4's derived-coupling rule — the old
// tracer's AT_THRESH lesson, made enforceable): any tolerance that must CONTAIN
// another is a RELATIONSHIP, not two independent numbers. The §4.2 classification
// probes step EPS_INTERFACE off the surface and must clear the marcher's worst
// accepted residual; the refinement bug proved what happens when a residual outruns
// the band (contour rings, wrong-side speckle). Until the constants are emitted from
// one derivation, this test IS the coupling: edit either file and the relationship
// re-checks here instead of silently breaking on the GPU.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { GRIN_GRAD_EPS } from '../../src/compiler/generate/features/intersection.js';
import { glslDefine } from '../helpers/glslDefine.js';

const SRC = join(__dirname, '../../src');
const read = (p: string): string => readFileSync(join(SRC, 'glsl/core', p), 'utf8');
const readAt = (p: string): string => readFileSync(join(SRC, p), 'utf8');

describe('march ↔ classification epsilon coupling', () => {
    const march = read('march.glsl');
    const math = read('math.glsl');
    const MARCH_EPSILON = glslDefine(march, 'MARCH_EPSILON');
    const MARCH_EPSILON_MAX = glslDefine(march, 'MARCH_EPSILON_MAX');
    const EPS_INTERFACE = glslDefine(math, 'EPS_INTERFACE');

    it('EPS_INTERFACE is the documented 10× MARCH_EPSILON', () => {
        expect(EPS_INTERFACE).toBeCloseTo(10 * MARCH_EPSILON, 12);
    });

    it('the classification probe clears the worst accepted residual (2× margin)', () => {
        // march_epsilon(t) caps at MARCH_EPSILON_MAX; a probe at EPS_INTERFACE must
        // clear an accepted point sitting a full acceptance radius off the surface,
        // with the factor-2 margin the march.glsl comment promises.
        expect(EPS_INTERFACE).toBeGreaterThanOrEqual(2 * MARCH_EPSILON_MAX);
    });

    it('the cap is coarser than the base epsilon (the t-growth has headroom)', () => {
        expect(MARCH_EPSILON_MAX).toBeGreaterThan(MARCH_EPSILON);
    });
});

// ── The provenance tiers (impl-plan-epsilon-discipline, Aug 2026) ─────────────────────
// Each surviving clearance is DERIVED; these pins are the derivations, enforceable.
describe('provenance-tier clearances', () => {
    const march = read('march.glsl');
    const math = read('math.glsl');
    const grin = readAt('components/transport/volume/grin/grin.glsl');
    const MARCH_EPSILON_MAX = glslDefine(march, 'MARCH_EPSILON_MAX');
    const MARCH_CLEARANCE = glslDefine(math, 'MARCH_CLEARANCE');

    it('MARCH_CLEARANCE = 2× the marcher acceptance cap (the marched tier derivation)', () => {
        // Smaller sits at a zero-margin knife edge against the marcher's first
        // acceptance test; grazing escapes then feed the 16× stall-commit (Aug 12 audit).
        expect(MARCH_CLEARANCE).toBeCloseTo(2 * MARCH_EPSILON_MAX, 12);
    });

    it('fp_uncertainty carries the transcribed Wächter–Binder constants', () => {
        expect(glslDefine(math, 'FP_UNCERTAINTY_REL')).toBeCloseTo(256 * 2 ** -23, 18);
        expect(glslDefine(math, 'FP_UNCERTAINTY_ABS')).toBeCloseTo(2 ** -16, 18);
    });

    it("grin.glsl's standalone GRIN_GRAD_EPS fallback matches the compiler-owned value", () => {
        // The compiler owns the number (emitted as a header define that the #ifndef
        // default yields to); the .glsl fallback exists only for standalone reading and
        // must not drift from it.
        expect(GRIN_GRAD_EPS).toBeCloseTo(glslDefine(grin, 'GRIN_GRAD_EPS'), 12);
    });

    it('the GRIN exit pull-back clears the walker residual and a marched wall, below the guard', () => {
        const DS_MAX = glslDefine(grin, 'GRIN_DS_MAX');
        const DTOL = glslDefine(grin, 'GRIN_DTOL');
        const ITERS = glslDefine(grin, 'GRIN_BISECT_ITERS');
        const STEP = glslDefine(grin, 'GRIN_STEP');
        const PULLBACK = glslDefine(grin, 'GRIN_EXIT_PULLBACK');
        const bisectResidual = (DS_MAX * (1 + DTOL / 2)) / 2 ** ITERS;
        expect(PULLBACK).toBeGreaterThanOrEqual(2 * bisectResidual);          // strictly inside `med`
        expect(PULLBACK).toBeGreaterThanOrEqual(2 * MARCH_EPSILON_MAX);       // clears a marched wall's band
        expect(PULLBACK).toBeLessThan(Math.min(STEP, DS_MAX));                // below the t_max handoff guard
    });
});

// ── The deletion gate: no bare EPSILON survives in any .glsl ──────────────────────────
// The emitted (TS-generated) halves are gated separately by glsl-compile.test.ts — an
// emitter still saying EPSILON fails to compile now that the define is gone.
describe('EPSILON is deleted', () => {
    it('no .glsl code references a bare EPSILON', () => {
        const offenders: string[] = [];
        for (const f of readdirSync(SRC, { recursive: true }) as string[]) {
            if (!f.endsWith('.glsl')) continue;
            const code = readFileSync(join(SRC, f), 'utf8')
                .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
            if (/\bEPSILON\b/.test(code)) offenders.push(f);
        }
        expect(offenders).toEqual([]);
    });
});
