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
        /** Explicit quad/sphere area lights in scene.lights (each desugars to a region, §6.2). */
        areaLightCount: number;
        /** Emissive analytic quad/sphere OBJECTS that enter the registry via sampleAsLight. */
        samplableEmitterCount: number;
        /** Every samplable source: point + directional + area + samplable emitters. */
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
