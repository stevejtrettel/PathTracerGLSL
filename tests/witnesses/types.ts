// witnesses/types.ts — the witness system's check vocabulary + the suite entry shape
// (shared with the demo gallery, which reuses SceneSuiteEntry without checks).

import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

/**
 * Machine-readable pass criteria for `npm run witness` (tools/witness.mjs) — the
 * automated form of the `expected` prose. Regions are fractions of the framebuffer,
 * origin bottom-left (WebGL readPixels convention). All values are LINEAR HDR, read
 * from the accumulation buffer — never the tonemapped screen.
 */
export interface WitnessRegion { x: number; y: number; w: number; h: number }

/** The region that selects exactly the pixels [x0, x0 + nx) × [y0, y0 + ny) (origin bottom-left)
 *  of a W×H frame. The runner reads floor(x·W) … ceil((x + w)·W) (tools/witness.mjs
 *  regionBounds); the half-pixel offsets keep the rounding off the floor and the ceiling. */
export const pixelWindowRegion = (win: { x0: number; y0: number; nx: number; ny: number }, [W, H]: [number, number]): WitnessRegion => ({
    x: (win.x0 + 0.5) / W, y: (win.y0 + 0.5) / H, w: (win.nx - 1) / W, h: (win.ny - 1) / H,
});

/**
 * WHERE A `mean` CHECK'S EXPECTED VALUE CAME FROM — and therefore what a miss MEANS.
 *
 * Until Aug 2026 every expected value in this suite was a pen-and-paper number (`furnace = 0.4`
 * from E/(1−ρ)), so provenance never needed saying. The subsurface work introduced the first
 * expectations computed by a reference implementation, and those are not the same kind of claim.
 * Recording the difference in the check — rather than smuggling a reference's error into `tol` —
 * is what keeps a witness table honest about what it proves.
 *
 * The tiers are two, because there are only two kinds of statement:
 *
 *   'exact'       The value is exact mathematics. Whether it is evaluated in your head
 *                 (E/(1−ρ)) or iterated to fourteen digits (Chandrasekhar's H-function) does not
 *                 change its kind — √2 is exact whether or not a computer prints it. A miss is a
 *                 RENDERER BUG. This is the default, and every check written before this field
 *                 existed is one.
 *
 *   'cross-check' The value is a second, independent implementation of the same physics, with a
 *                 statistical error of its own (a CPU Monte-Carlo reference for a configuration
 *                 with no closed form). A miss means THE TWO DISAGREE — both are suspects. These
 *                 rows must state `refTol`, and the runner reports them apart, as DISAGREE
 *                 rather than FAIL, so a table of exact gates is never diluted by them.
 */
export interface WitnessSource {
    tier: 'exact' | 'cross-check';
    /** One line naming the derivation or the reference — printed in the report. */
    from: string;
    /**
     * The REFERENCE's own uncertainty, kept apart from `tol` (the render's noise budget) so a
     * defect can never hide inside one merged number. Required for 'cross-check'.
     */
    refTol?: number;
}

export type WitnessCheck =
    | {
          /** Mean over `region` (default: whole frame) equals `value` per channel. */
          kind: 'mean';
          /** The picture to read (default 'radiance'): any name the renderer keeps, e.g. an
           *  AOV listed in measurement.aovs. */
          picture?: string;
          value: number | [number, number, number];
          /** Absolute tolerance, scalar or per-channel — the RENDER's noise budget. When
           *  `source.tier` is 'cross-check', the reference's own error rides `source.refTol`
           *  and the runner adds them; never fold one into the other. */
          tol: number | [number, number, number];
          region?: WitnessRegion;
          /** Strategy index into `strategies` (default 0). */
          strategy?: number;
          /** Provenance of `value`. Absent ⇒ { tier: 'exact' } — see WitnessSource. */
          source?: WitnessSource;
          label?: string;
      }
    | {
          /**
           * Cross-strategy convergence (§11.2): every listed strategy renders the same
           * scene; asserts pairwise |Δ frame-mean|/mean < meanTol in LINEAR HDR (the
           * bias gate — converges fast at any budget) plus ONE structure gate:
           *
           * - Default: noise-normalized χ² (arms render with the variance occupant;
           *   per pixel-channel (a−b)²/(σ²ₐ+σ²ᵦ) with σ² = measured variance of the
           *   mean, averaged over the frame). Same integrand ⇒ χ²_red ≈ 1 at ANY spp;
           *   fireflies self-normalize (a spike inflates its own measured variance);
           *   bias grows ∝ n. `chi2` defaults to 2. VALID ONLY for arms with SHARED
           *   EVENT COVERAGE (nee≡mis, placement pairs, chart pairs) — a chance-hit pt
           *   arm's empirical variance cannot see rare events it never sampled.
           * - `rmse` (set it to opt out of χ²): per-pixel relative RMSE in display
           *   space l/(1+l) on plain renders, calibrated to the measured noise floor.
           *   For pt tripwires, identical-stream arms, and cross-BACKEND twins
           *   (marching vs closed-form differ deterministically at silhouettes).
           */
          kind: 'equality';
          strategies: number[];
          meanTol: number;
          chi2?: number;
          rmse?: number;
          label?: string;
      }
    | {
          /**
           * One picture (default 'radiance') of two strategies, rendered at the same pinned
           * salt, must be equal BIT FOR BIT. For pairs that must draw the same random numbers
           * and do the same arithmetic on the picture: the same strategy with and without
           * extra pictures, or estimators that only differ after the picture is fixed (the
           * first-hit AOVs under pt and pt-nee).
           */
          kind: 'identical';
          strategies: [number, number];
          picture?: string;
          label?: string;
      }
    | {
          /** Cross-SCENE twin (backend equivalence): same gates as 'equality'. */
          kind: 'twin';
          other: { scene: string; strategy?: number };
          strategy?: number;
          meanTol: number;
          chi2?: number;
          rmse?: number;
          label?: string;
      }
    | {
          /**
           * Equal-spp noise comparison (the research numbers): each listed strategy
           * re-renders with the variance statistic switched on (`variance: true`), and the
           * runner reports mean per-channel σ of the PIXEL MEAN (√(v/n)) over `region`,
           * relative to the region's mean radiance. Report-only unless
           * `assertFirstLowest` — then the FIRST listed strategy must measure lowest.
           */
          kind: 'noise';
          strategies: number[];
          region?: WitnessRegion;
          assertFirstLowest?: boolean;
          label?: string;
      }
    | {
          /**
           * Wall-clock ms per accumulation frame (impl-plan-placement-fold's perf arm —
           * the speed sibling of the numeric gates: every accel/bandwidth change ships
           * with a number). Runs ONLY under `npm run witness -- --perf`, which launches
           * the REAL GPU (never SwiftShader — timing a software rasterizer would
           * misjudge bandwidth work; the runner prints the GL renderer string so a
           * silent fallback can't masquerade). Methodology: `warmup` frames (compile +
           * upload + pipeline warm), then 3 batches of `frames` frames each timed with
           * a readback sync barrier; reports median ms/frame + spread. REPORT-ONLY
           * (always passes): milliseconds are machine state, never a sweep gate; the
           * numbers are read across adjacent rows (e.g. params vs frame tier).
           * `size` overrides the spec size (perf wants GPU-bound framebuffers, not the
           * SwiftShader budget).
           */
          kind: 'perf';
          /** Strategy index into `strategies` (default 0). */
          strategy?: number;
          size?: [number, number];
          /** Timed frames per batch (default 24). */
          frames?: number;
          /** Untimed warmup frames (default 8). */
          warmup?: number;
          label?: string;
      }
    | {
          /**
           * Tiling does not change the image (app/TiledRenderer.ts, app/tiling.ts): a tiled
           * render's saved HDR and PNG equal a one-piece render's at the same size, spp and
           * pinned salt. The runner renders both in one page, catches the four downloads, and
           * requires the HDR pixel bytes (after the header) and the PNG's decompressed image
           * data to be identical (the stamps differ; the encoder is deterministic). Uses the
           * spec's size and spp. `tileSize` (a multiple of 64, default 64) should leave partial
           * tiles at the right and top edges.
           */
          kind: 'tiled';
          /** Strategy index into `strategies` (default 0). */
          strategy?: number;
          tileSize?: number;
          label?: string;
      }
    | {
          /**
           * REPORT-ONLY statistics of the Seifert–Weber cell walk (components/quotient/
           * seifert-weber), counted on the GPU by the strategy's own program with counters added
           * at fixed points of the generated walk (tools/witness.mjs renderWalkCounter): the
           * segments that reached the crossing cap, the most faces one segment crossed, and the
           * largest constraint defect max(|⟨p,p⟩ + 1|, |⟨p,v⟩|, |⟨v,v⟩ − 1|) of a ray state after
           * a crossing, over the spec's size and spp. Always passes; `cap` is the program's
           * QUOTIENT_MAX_CROSSINGS, printed beside the count.
           */
          kind: 'walk-counter';
          /** Strategy index into `strategies` (default 0). */
          strategy?: number;
          cap: number;
          label?: string;
      };

export interface WitnessSpec {
    /** Framebuffer size for the headless render (SwiftShader budget). Default [160,120]. */
    size?: [number, number];
    /** Samples per strategy render. Default 64. */
    spp?: number;
    checks: WitnessCheck[];
}

/**
 * A DATA-SCENE entry (fable-instance-clouds §7): the scene is an async thunk — it
 * fetches multi-MB untracked `.inst` files at runtime, so it is built only when the
 * lab page resolves it on click-through. Display metadata lives at ENTRY level (cards
 * never await). Demo-registry only: the witness runner and the registry-iterating
 * vitest files handle sync entries; structural coverage of the data path comes from
 * the committed fixture (tests/authoring/instanceCloud.test.ts).
 */
export interface AsyncSceneSuiteEntry {
    scene: () => Promise<SceneDescription>;
    /** Gallery-card name (the sync entries' `scene.name`). */
    name: string;
    strategies: RenderStrategy[];
    exercises: string;
    expected?: string;
    initialParameters?: Record<string, unknown>;
}

export type AnySceneSuiteEntry = SceneSuiteEntry | AsyncSceneSuiteEntry;

/** Discriminates data-scene thunk entries from plain (witness-capable) entries. */
export function isAsyncSceneEntry(e: AnySceneSuiteEntry): e is AsyncSceneSuiteEntry {
    return typeof e.scene === 'function';
}

export interface SceneSuiteEntry {
    scene: SceneDescription;
    /** One renderer per strategy; the dev app binds them to keys 1-9 in order. */
    strategies: RenderStrategy[];
    /** What this scene is for — which feature(s) it exercises. */
    exercises: string;
    /**
     * The pass criterion, when the scene has one — a derived number (validation-scenes doc)
     * or a checkable invariant. Displayed on the suite gallery; prose for humans — the
     * machine-readable form is `witness`.
     */
    expected?: string;
    /**
     * Automated pass criteria for `npm run witness`. Witness-registry entries normally
     * have one; an entry without checks is a fixture partner (a twin's other half).
     */
    witness?: WitnessSpec;
    /** Parameter POINTS beyond the compiled defaults (e.g. the driven witness θ′).
     *  Camera pose is NOT set here — it is measurement data, authored on each
     *  strategy's `measurement.camera` (the registries' `posed(...)` wrap). */
    initialParameters?: Record<string, unknown>;
}
