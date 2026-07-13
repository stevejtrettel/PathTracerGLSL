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

export type WitnessCheck =
    | {
          /** Mean over `region` (default: whole frame) equals `value` per channel. */
          kind: 'mean';
          value: number | [number, number, number];
          /** Absolute tolerance, scalar or per-channel. */
          tol: number | [number, number, number];
          region?: WitnessRegion;
          /** Strategy index into `strategies` (default 0). */
          strategy?: number;
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
           * re-renders with accumulation forced to the 'variance' occupant, and the
           * runner reports mean per-channel σ of the PIXEL MEAN (√(v/n)) over `region`,
           * relative to the region's mean radiance. Report-only unless
           * `assertFirstLowest` — then the FIRST listed strategy must measure lowest.
           */
          kind: 'noise';
          strategies: number[];
          region?: WitnessRegion;
          assertFirstLowest?: boolean;
          label?: string;
      };

export interface WitnessSpec {
    /** Framebuffer size for the headless render (SwiftShader budget). Default [160,120]. */
    size?: [number, number];
    /** Samples per strategy render. Default 64. */
    spp?: number;
    checks: WitnessCheck[];
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
    /** Default camera pose (and any other live params) for viewing. */
    initialParameters?: Record<string, unknown>;
}
