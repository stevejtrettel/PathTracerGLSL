// compiler/generate/descriptors.ts
// Descriptor types for mix-many families (impl-plan-descriptor-reorg R1; shapes from
// fable-module-anatomy.md §2, adjusted to current reality — (uc,u) samplers, the
// region-table storage kind from the ior lesson).
//
// THE GUARDRAIL (module-anatomy §2, "the archive's grave"): a descriptor declares facts
// about ONE model — never composition, ordering, passes, or pipeline structure. Fields
// may be functions (a pdf arm is kind-specific math, a fact expressed as code); they may
// NOT reference other descriptors or the plan. All decisions stay in feature-planner code.

import type { MaterialModel } from '../types.js';
import type { PlannedLight, PlannedMaterial, PlannedMedium } from '../plan/types.js';

/**
 * A field of a scene-scoped properties struct (MaterialProperties / MediumProperties)
 * that a model READS. The struct is the union of declared fields of the models present
 * (§3.4); the resolver assigns only declared fields (R2). TSource is the resolved-data
 * key set the field is fed from (PlannedMaterial for surface models, PlannedMedium for
 * phase models — same machinery, two struct families).
 */
export interface PropertySchema<TSource extends string = Extract<keyof PlannedMaterial, string>> {
    /** Struct field name; shared across models by name+type (same name, different
     *  glslType is a Validator error — module-anatomy §3). */
    name: string;
    glslType: 'float' | 'Spectrum';
    /** radiometric constants format via formatSpectrum (§2.5); geometric via formatFloat. */
    semantic: 'radiometric' | 'geometric';
    /** Which resolved data field feeds it. */
    source: TSource;
    /** GLSL default expression for materials that don't set it. */
    default: string;
    /** 'field' → struct member resolved at the shading point; 'region-table' → a
     *  generated <name>_of(region) table (read for the FAR side of a boundary — a
     *  point-fetch cannot express that; the ior lesson). */
    storage: 'field' | 'region-table';
}

/** A surface material model: one GLSL file + these facts (contracts §3.2/§3.3). */
export interface MaterialModelDescriptor {
    id: MaterialModel;
    /** ?raw source providing <id>_eval / <id>_sample / <id>_pdf / <id>_emission
     *  in the (uc, u) sampler form. */
    glsl: string;
    /** Fields this model READS → scene-scoped struct + resolver (§3.4, R2). */
    properties: PropertySchema[];
    capabilities: {
        /** Has lobes NEE can sample (false = pure delta: eval ≡ 0, shadow rays wasted).
         *  Feeds material_has_nondelta_lobes directly. (Polarity flipped vs
         *  module-anatomy §2's `deltaLobes` sketch for clarity — same fact.) */
        nonDeltaLobes: boolean;
        /** Transmissive models: ior region-table exists, transport tracks eta_scale. */
        transmission: boolean;
        /** May emit — eligibility for the emission gate + light registry (§6.2);
         *  whether a given MATERIAL emits stays a per-value analysis. */
        emissive: boolean;
    };
}

/** A samplable light kind: one GLSL sampler file + these facts (contracts §6.1/§6.2). */
export interface LightKindDescriptor {
    kind: 'point' | 'quad' | 'sphere';
    /** ?raw source providing <kind>_light_sample. */
    glsl: string;
    /** Delta kinds: not hittable, LIGHT_DELTA, no region, no lighting_pdf arm. */
    delta: boolean;
    /** Emitted power for CDF selection (pbrt PowerLightSampler formulas). */
    power(l: PlannedLight): number;
    /** The lighting_sample dispatcher arm: a GLSL call expression sampling `l` at `p`. */
    emitSampleCall(l: PlannedLight, xiExpr: string): string;
    /** The lighting_pdf arm body for a hittable kind (absent for delta kinds):
     *  lines returning `selectExpr` × the kind's solid-angle pdf from the hit geometry.
     *  Must mirror emitSampleCall's density exactly (the byte-match invariant, §6.1). */
    emitPdfArm?(l: PlannedLight, selectExpr: string): string[];
}

/** A phase model: one GLSL file declaring into MediumProperties (§3.5) — the same
 *  schema machinery, second struct family. */
export interface PhaseModelDescriptor {
    id: string;
    /** ?raw source providing <id>_eval / <id>_sample / <id>_pdf (LOBE_MEDIUM). */
    glsl: string;
    properties: PropertySchema<Extract<keyof PlannedMedium, string>>[];
}
