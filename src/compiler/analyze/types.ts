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
        /** Any material property is a GLSL expression (per-model facts are NOT features —
         *  the Validator checks model registration against MATERIAL_MODELS directly). */
        hasProcedural: boolean;
    };

    lighting: {
        /** Registered delta kinds (descriptor `delta: true` — point today). */
        deltaLightCount: number;
        /** Registered hittable kinds in scene.lights (each desugars to a region, §6.2). */
        areaLightCount: number;
        /** Authored kinds with no registry entry ('directional' reserved, typos) — the
         *  Validator rejects each with a per-light diagnostic. */
        unknownKindLightCount: number;
        /** Emissive analytic samplable OBJECTS that enter the registry via sampleAsLight. */
        samplableEmitterCount: number;
        /** Every AUTHORED light (registered or not — authoring intent, so the no-lights
         *  check never stacks on a kind rejection) + samplable emitters. */
        totalLightCount: number;
    };

    media: {
        /** Any material declares a medium block, or the scene names an ambientMedium. */
        hasMedia: boolean;
        /** Any medium has σ_s nonzero or {param}-driven — transport needs the scattering arms. */
        hasScatteringMedia: boolean;
        /** Any medium (incl. ambient) has an expression coefficient — the null-collision
         *  arms (delta/ratio tracking) are needed (fable-heterogeneous-media.md). */
        hasHeterogeneousMedia: boolean;
        /** Any material has model 'none' (§3.6) — transport needs the null-crossing branch. */
        hasNullInterfaces: boolean;
    };

    environment: {
        /**
         * The env participates in NEE/MIS as a light (env-as-light T3): `image` unless
         * sampleAsLight: false; `constant` only when sampleAsLight: true (D6 opt-in — the
         * default preserves every pre-T3 witness's estimator behavior). Satisfies the
         * NEE-needs-lights check and drives ENV_SAMPLABLE + the selection codegen.
         */
        samplable: boolean;
    };
}
