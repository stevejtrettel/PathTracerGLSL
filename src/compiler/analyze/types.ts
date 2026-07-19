// compiler/analyze/types.ts
//
// The scene census (compiler-pass C4: SLIMMED to exactly its consumers — census fields
// exist to feed Validator/Planner decisions, not to be a second model of the scene; the
// audit found half the old record had zero readers, one of them a hardcoded field list
// that contradicted the open schema vocabulary. A future decision re-adds its field WITH
// its reader).

export type AmbientSpaceType = string;   // AMBIENT_SPACES registry key (D3: the open door)

export interface SceneFeatures {
    ambientSpace: AmbientSpaceType;

    geometry: {
        /** Mesh objects present — Validator-rejected until the BVH/mesh backend. */
        hasMeshes: boolean;
    };

    lighting: {
        /** Every AUTHORED light (registered kind or not — authoring INTENT, so the
         *  no-lights check never stacks on a kind rejection) + samplable emitters. */
        totalLightCount: number;
    };

    media: {
        /** Any material declares a medium block, or the scene names an ambientMedium. */
        hasMedia: boolean;
        /** Any medium has σ_s nonzero or {param}-driven — transport needs the scattering arms. */
        hasScatteringMedia: boolean;
        /** Any medium has ε possibly nonzero (impl-plan-medium-emission) — the emission
         *  machinery (lookup field, collection lines, walk radiance line) is needed. */
        hasEmissiveMedia: boolean;
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
