// compiler/analyze/types.ts

import type { MaterialModel, TransportDescription, CameraDescription, AccumulationDescription, DisplayDescription } from '../types.js';

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
        models: Set<MaterialModel>;
        hasEmissive: boolean;
        hasDielectrics: boolean;
        hasProcedural: boolean;
    };

    lighting: {
        pointLightCount: number;
        directionalLightCount: number;
        totalLightCount: number;
        needsMIS: boolean;
    };

    strategy: {
        transport: TransportDescription;
        camera: CameraDescription;
        accumulation: AccumulationDescription;
        display: DisplayDescription;
    };
}
