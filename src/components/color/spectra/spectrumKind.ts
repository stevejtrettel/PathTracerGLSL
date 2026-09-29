// The spectrum-kind contract (docs/claude-spectrum-spec.md). A spectrum is a function of
// wavelength; its kind is the way it was produced: an RGB color, a blackbody, a Cauchy or
// Sellmeier index formula. A kind answers every question the compiler asks about its values.
// The slot a value sits in supplies the role, which decides how the spectrum is read.
//
// Kinds import only types from the compiler (the components purity rule). The operations the
// compiler owns reach them through the two contexts below: binding a number as a literal, a
// uniform, an expression or a per-instance value; the color model's RGB lift; minting a slider.

import type { Vec3, ParameterMetadata } from '../../../compiler/types.js';
import type { PlannedUniform } from '../../../compiler/plan/types.js';
import type { SpectrumRole } from '../../descriptors.js';

/** Helium d line, in nm. An RGB render uses the index at this wavelength. */
export const indexReferenceNM = 587.5618;

export interface EmitContext {
    role: SpectrumRole;
    /** GLSL expression of the wavelength carrier. */
    wl: string;
    /** True when the program evaluates spectra at wavelengths; false in RGB programs. */
    spectral: boolean;
    /** A scalar strength multiplying the value (the constant sky's u_envIntensity). */
    factor?: string;
    /** The compiler's binding of a plain number or triple: a literal, a uniform, an expression
     *  or a per-instance value. */
    bind(value: unknown, format: (x: never) => string): string;
    /** The colour model's lift of an RGB expression in this context's role. */
    lift(rgb: string): string;
}

export interface MintContext {
    spectral: boolean;
    uniforms: PlannedUniform[];
    parameters: Record<string, ParameterMetadata>;
    /** Uniform names and parameter paths already minted; shared sliders are minted once. */
    seen: Set<string>;
    /** The compiler's slider for a plain value. */
    mint(value: unknown, glslType: 'vec3' | 'float', metaType: 'color' | 'float', hdr: boolean): void;
}

export interface SpectrumKind<V = unknown> {
    id: string;
    /** The kind's name in diagnostics. */
    label: string;
    is(value: unknown): value is V;
    /** The roles of the slots that may hold it. */
    roles: readonly SpectrumRole[];
    /** Parameter paths of its live sliders. */
    liveParams(value: V): string[];
    /** Domain checks on its own numbers, reported as messages; the slot's role is checked
     *  before this is called. */
    validate?(value: V, label: string, report: (message: string) => void): void;
    /** The RGB stand-in at the given slider values: a triple for a radiometric role, the
     *  index at indexReferenceNM for the index role. */
    toRGB(value: V, role: SpectrumRole, params: Record<string, unknown>): Vec3 | number;
    /** A constant, positive value: the light census's question. Implies mayBeNonzero. */
    constantNonzero(value: V): boolean;
    /** Whether the value can be positive at run time (a positive constant, or a live slider
     *  or expression that can become one). */
    mayBeNonzero(value: V): boolean;
    /** Whether, as an index, it varies with wavelength (and so forces the hero collapse). */
    dispersive(value: V): boolean;
    /** GLSL for the value at ctx.wl: a Spectrum for radiometric roles, a float for index. */
    emit(value: V, ctx: EmitContext): string;
    /** GLSL helpers the kind's `emit` calls when a program evaluates it spectrally or
     *  dispersively (ProgramDescription.spectrumKinds); linked once. */
    glsl?: { origin: string; source: string };
    /** Uniforms and sliders the kind derives from its live numbers. */
    mint?(value: V, ctx: MintContext): void;
    /** Light-table rows keep the kind whole in the row header: `code` tags the header's
     *  second float, `header` supplies its last two, and `read` evaluates them in GLSL. */
    packed?: {
        code: number;
        header(value: V): [number, number];
        read(header: string, wl: string): string;
    };
}
