// tests/witnesses/slabAlbedo.test.ts — the slab witness's expected values are DERIVED, and this
// is what keeps them derived.
//
// The fixture states its expectations as literals (`SLAB_PLANE_ALBEDO`) rather than importing the
// solver, because the witness registry is loaded IN THE BROWSER by tools/witness.mjs and has no
// business pulling a fixed-point iteration and a 2M-sample random walk along with it. That is the
// same reason `furnace = 0.4` is a literal.
//
// A literal, though, is only as good as the thing that checks it. This file re-derives every
// constant from tests/helpers/halfspace.ts and asserts the fixture agrees — so editing a number
// in the fixture without the physics moving underneath it is a test failure, and a future change
// to the authored colour, the radius or the anisotropy cannot leave a stale expectation behind.

import { describe, it, expect } from 'vitest';
import { planeAlbedo, mcHalfspaceAlbedo } from '../helpers/halfspace.js';
import { alphaFromColor } from '../../src/authoring/subsurface.js';
import {
    SLAB_TARGET,
    SLAB_PLANE_ALBEDO,
    SLAB_PLANE_ALBEDO_ANISO,
    SLAB_ANISO_REF_TOL,
    SLAB_VIEWS,
    SPARSE_RADIUS,
    slabAlbedoScene,
    slabAlbedoAnisoScene,
    slabAlbedoSparseScene,
} from './scenes/slabAlbedoWitness.js';
import type { Vec3 } from '../../src/compiler/types.js';

/** The medium the fixture actually authored, read back rather than reassumed. */
const mediumOf = (scene: typeof slabAlbedoScene) => {
    const m = scene.materials.authored.medium!;
    return { sigma_s: m.sigma_s as Vec3, sigma_a: m.sigma_a as Vec3, g: m.phase_g as number };
};

/** The slab's half-extents, narrowed rather than cast blind — the fixture's object 0 is a box. */
const slabHalfSize = (scene: typeof slabAlbedoScene): Vec3 => {
    const o = scene.objects[0];
    if (!('parameters' in o)) throw new Error('slab fixture: object 0 carries no parameters');
    return (o.parameters as { halfSize: Vec3 }).halfSize;
};

const albedosOf = (scene: typeof slabAlbedoScene): Vec3 => {
    const { sigma_s, sigma_a } = mediumOf(scene);
    return [0, 1, 2].map((c) => sigma_s[c] / (sigma_s[c] + sigma_a[c])) as Vec3;
};

describe('the fixture authors the medium it claims to', () => {
    it('has EQUAL σ_t across channels — the scalar-radius design choice', () => {
        // Design note 3: this is what makes the chromatic per-event weight reduce to exactly α_c,
        // which is in turn what makes the interior rule fire in the roulette arm at all.
        const { sigma_s, sigma_a } = mediumOf(slabAlbedoScene);
        const sigma_t = [0, 1, 2].map((c) => sigma_s[c] + sigma_a[c]);
        expect(sigma_t[0]).toBeCloseTo(sigma_t[1], 9);
        expect(sigma_t[1]).toBeCloseTo(sigma_t[2], 9);
    });

    it('reaches the single-scattering albedos the failure-reading table quotes', () => {
        expect(albedosOf(slabAlbedoScene).map((a) => +a.toFixed(6)))
            .toEqual([0.757527, 0.911709, 0.976001]);
        expect(albedosOf(slabAlbedoAnisoScene).map((a) => +a.toFixed(6)))
            .toEqual([0.886498, 0.962708, 0.990260]);
    });

    it('is optically thick enough to be semi-infinite', () => {
        // The expected values are halfspace solutions, so the slab has to BE one. σ_t = 20 over a
        // 4-unit depth is 80 mean free paths; the diffusion length at the brightest channel is
        // ~0.19 units, so nothing reaches the far side.
        const { sigma_s, sigma_a } = mediumOf(slabAlbedoScene);
        const depth = 2 * slabHalfSize(slabAlbedoScene)[1];
        for (let c = 0; c < 3; c++) {
            expect(depth * (sigma_s[c] + sigma_a[c]), `channel ${c}`).toBeGreaterThan(50);
        }
    });
});

describe('the camera arms measure the exit cosines they claim to', () => {
    it('each view direction has |d·n| = the declared µ', () => {
        // The whole point of the orthographic rebuild: every ray shares ONE µ, and the expected
        // value is A_p at exactly that µ. A pose typo here would silently gate the wrong number.
        for (const [name, view] of Object.entries(SLAB_VIEWS)) {
            const [x, y, z] = view.position;
            const len = Math.hypot(x, y, z);
            expect(y / len, `${name}: pose ${view.position}`).toBeCloseTo(view.mu, 4);
        }
    });

    it('keeps every ray origin above the surface and every footprint on the slab', () => {
        // Orthographic origins span the film plane (half-height `scale`), so the lowest one sits
        // at |P| ... the check that matters is that it stays above y = 0 and that the footprint,
        // stretched by 1/µ along the surface, stays inside the slab's ±6.
        const SCALE = 0.5;
        const halfSize = slabHalfSize(slabAlbedoScene);
        for (const [name, view] of Object.entries(SLAB_VIEWS)) {
            const [, y] = view.position;
            // The film's up-vector tilts by the same angle as the view; its y component is
            // sqrt(1 − µ²) at worst, so the lowest origin drops by at most SCALE·sqrt(1−µ²).
            const lowest = y - SCALE * Math.sqrt(1 - view.mu * view.mu);
            expect(lowest, `${name}: lowest ray origin`).toBeGreaterThan(0);
            expect(SCALE / view.mu, `${name}: surface footprint`).toBeLessThan(halfSize[2]);
        }
    });
});

describe('the expected values are the exact plane albedos', () => {
    const alphas = () => SLAB_TARGET.map((C) => alphaFromColor(C, 0));

    it('matches Chandrasekhar at every arm', () => {
        const cases: [string, Vec3, number][] = [
            ['normal', SLAB_PLANE_ALBEDO.normal, SLAB_VIEWS.normal.mu],
            ['oblique', SLAB_PLANE_ALBEDO.oblique, SLAB_VIEWS.oblique.mu],
            ['grazing', SLAB_PLANE_ALBEDO.grazing, SLAB_VIEWS.grazing.mu],
        ];
        for (const [name, stated, mu] of cases) {
            alphas().forEach((alpha, c) => {
                expect(stated[c], `${name} channel ${c}`).toBeCloseTo(planeAlbedo(alpha, mu), 5);
            });
        }
    });

    it('rises monotonically toward grazing — the fact the old design missed', () => {
        for (let c = 0; c < 3; c++) {
            expect(SLAB_PLANE_ALBEDO.oblique[c]).toBeGreaterThan(SLAB_PLANE_ALBEDO.normal[c]);
            expect(SLAB_PLANE_ALBEDO.grazing[c]).toBeGreaterThan(SLAB_PLANE_ALBEDO.oblique[c]);
        }
    });

    it('is NOT the authored colour, at any arm — and the gap is why this file exists', () => {
        for (let c = 0; c < 3; c++) {
            expect(SLAB_PLANE_ALBEDO.normal[c]).toBeLessThan(SLAB_TARGET[c] * 0.95);
        }
    });

    it('the bounce budget makes truncation negligible at the worst channel', () => {
        // Design note 4, as an assertion rather than a comment: with roulette off the throughput
        // decays as α^n, so the truncation loss is bounded by α^maxBounces.
        const worst = Math.max(...albedosOf(slabAlbedoScene));
        expect(worst ** 384).toBeLessThan(1e-4);
        const worstAniso = Math.max(...albedosOf(slabAlbedoAnisoScene));
        expect(worstAniso ** 1024).toBeLessThan(1e-4);
        // …and that the ANISO scene genuinely needs its bigger budget, so nobody "tidies" it away.
        expect(worstAniso ** 384).toBeGreaterThan(1e-3);
    });
});

describe('the anisotropic expectation is the independent walk’s answer', () => {
    it('reproduces the cross-check value within its stated reference tolerance', () => {
        // Fewer samples than the 2M that produced the literal, so this re-derivation has a larger
        // error of its own — the comparison band is the literal's stated refTol plus this run's 3σ.
        const alphas = SLAB_TARGET.map((C) => alphaFromColor(C, 0.6));
        alphas.forEach((alpha, c) => {
            const mc = mcHalfspaceAlbedo({ alpha, g: 0.6, mu: 1, samples: 300_000, seed: 0xa17c0 + c });
            expect(mc.truncated, `channel ${c}`).toBe(0);
            expect(Math.abs(mc.value - SLAB_PLANE_ALBEDO_ANISO[c]), `channel ${c}: re-derived ${mc.value.toFixed(5)}`)
                .toBeLessThan(SLAB_ANISO_REF_TOL + 3 * mc.stderr);
        });
    }, 60_000);

    it('differs materially from the isotropic twin — similarity is NOT a per-direction claim', () => {
        // Pinned so the "they must read the same" mistake cannot be reintroduced quietly.
        expect(SLAB_PLANE_ALBEDO_ANISO[0]).toBeLessThan(SLAB_PLANE_ALBEDO.normal[0] * 0.92);
    });
});

describe('the scale-invariance arm is the same medium at a tenth the density', () => {
    it('authors the identical single-scattering albedos — only σ_t moved', () => {
        // The whole experiment: ONE variable changed. If the α values differed, the two scenes
        // would not share an expected value and the comparison would mean nothing.
        // Per-channel, not toEqual: the two scenes divide by different σ_t, so the results agree
        // to floating-point rather than bit-for-bit. The claim is "the same α", not "the same bits".
        const dense = albedosOf(slabAlbedoScene);
        albedosOf(slabAlbedoSparseScene).forEach((a, c) => {
            expect(a, `channel ${c}`).toBeCloseTo(dense[c], 12);
        });
    });

    it('really is ten times sparser', () => {
        const dense = mediumOf(slabAlbedoScene);
        const sparse = mediumOf(slabAlbedoSparseScene);
        const sigmaT = (m: { sigma_s: Vec3; sigma_a: Vec3 }) => m.sigma_s[0] + m.sigma_a[0];
        expect(sigmaT(dense) / sigmaT(sparse)).toBeCloseTo(10, 6);
        expect(sigmaT(sparse)).toBeCloseTo(1 / SPARSE_RADIUS, 9);
    });

    it('stays semi-infinite despite the sparser medium — depth scaled with the free path', () => {
        // The trap this test exists for: making the medium 10× sparser without deepening the slab
        // would leave it 8 free paths thick, which is NOT a halfspace, and the arm would read low
        // for a reason that has nothing to do with what it is measuring.
        const { sigma_s, sigma_a } = mediumOf(slabAlbedoSparseScene);
        const depth = 2 * slabHalfSize(slabAlbedoSparseScene)[1];
        for (let c = 0; c < 3; c++) {
            expect(depth * (sigma_s[c] + sigma_a[c]), `channel ${c}`).toBeGreaterThan(50);
        }
    });
});

describe('every slab is semi-infinite SIDEWAYS too — the trap the Aug 12 sweep found', () => {
    // The sparse scene's first version scaled depth ×10 but kept width 12, shrinking the lateral
    // margin to ~9 free paths beyond the widest footprint — and BLUE (α = 0.976, ~42 scatters)
    // read +0.019 HIGH: its walks reached a side, exited into vacuum, and scored the environment
    // where a true halfspace would have absorbed them. Lateral extent is a FIRST-PASSAGE bound
    // (the walk need only touch a side once to escape), so it is held to the same free-path
    // standard as depth, measured beyond the worst-case camera footprint (0.5/µ at grazing).
    const SCALE = 0.5;
    const worstFootprint = SCALE / Math.min(...Object.values(SLAB_VIEWS).map((v) => v.mu));

    for (const [name, scene] of [
        ['dense', slabAlbedoScene],
        ['aniso', slabAlbedoAnisoScene],
        ['sparse', slabAlbedoSparseScene],
    ] as const) {
        it(`${name}: lateral margin beyond the footprint exceeds 50 free paths`, () => {
            const { sigma_s, sigma_a } = mediumOf(scene);
            const half = slabHalfSize(scene);
            const margin = Math.min(half[0], half[2]) - worstFootprint;
            for (let c = 0; c < 3; c++) {
                expect(margin * (sigma_s[c] + sigma_a[c]), `channel ${c}`).toBeGreaterThan(50);
            }
        });
    }
});
