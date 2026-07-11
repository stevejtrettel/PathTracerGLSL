// compiler/analyze/types.ts

export type AmbientSpaceType = 'euclidean' | 'hyperbolic' | 'spherical';

export interface SceneFeatures {
    ambientSpace: AmbientSpaceType;

    geometry: {
        hasSDFs: boolean;
        hasAnalytic: boolean;
        hasMeshes: boolean;
        sdfCount: number;
        analyticCount: number;
    };

    materials: {
        hasLambert: boolean;
        hasDisney: boolean;
        hasDielectric: boolean;
        hasEmissive: boolean;
        hasProcedural: boolean;
    };

    lighting: {
        pointLightCount: number;
        directionalLightCount: number;
        totalLightCount: number;
    };

    media: {
        /** Any material declares a medium block, or the scene names an ambientMedium. */
        hasMedia: boolean;
        /** Any medium has σ_s nonzero or {param}-driven — transport needs the scattering arms. */
        hasScatteringMedia: boolean;
        /** Any material has model 'none' (§3.6) — transport needs the null-crossing branch. */
        hasNullInterfaces: boolean;
    };
}
