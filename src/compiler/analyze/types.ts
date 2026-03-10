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
}
