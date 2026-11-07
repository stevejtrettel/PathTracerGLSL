import type { Vec3, BlackbodyValue, ValueParam } from '../../../../compiler/types.js';
import type { SpectrumKind, EmitContext } from '../spectrumKind.js';
import { cie1931Curves } from '../../../sensor/cie1931/curves.js';
import { spectralData } from '../../spectral/data.js';
import { isValueParam } from '../../../param.js';
import { formatFloat, paramToUniform } from '../../../glsl-format.js';
import blackbodyGLSL from './blackbody.glsl?raw';

export const blackbodyTemperatureRange = [1000, 40000] as const;
// Exact SI h*c/k, expressed in nm K; wavelengths in this renderer are nanometres.
export const planckC2 = 6.62607015e-34 * 299792458 / 1.380649e-23 * 1e9;

/** Planck radiance relative to 550 nm. Its common amplitude cancels in normalization. */
export function planckShape(lambda: number, kelvin: number): number {
    return (550 / lambda) ** 5 * Math.expm1(planckC2 / (550 * kelvin))
        / Math.expm1(planckC2 / (lambda * kelvin));
}

/** Unit reference CIE Y, independent of the active camera sensor. Scale multiplies
 * this spectrum after normalization, so it controls reference brightness. `xyz` is the
 * normalized spectrum's CIE 1931 XYZ (Y = 1) and `rgb` its linear sRGB. */
export function blackbodyColor(kelvin: number): { xyz: Vec3; rgb: Vec3; normalization: number } {
    const xyz = [0, 0, 0];
    // Simpson quadrature in each 5 nm CMF interval. The response is piecewise linear;
    // this 0.5 nm rule is checked against an independent 0.25 nm reference.
    for (let interval = 0; interval < cie1931Curves.length - 1; interval++) {
        for (let sample = 0; sample <= 10; sample++) {
            const fraction = sample / 10;
            const lambda = 360 + 5 * (interval + fraction);
            const weight = 0.5 / 3 * (sample === 0 || sample === 10 ? 1 : sample % 2 ? 4 : 2);
            const value = weight * planckShape(lambda, kelvin) / spectralData.cieYIntegral;
            for (let channel = 0; channel < 3; channel++) {
                const response = cie1931Curves[interval][channel] * (1 - fraction)
                    + cie1931Curves[interval + 1][channel] * fraction;
                xyz[channel] += value * response;
            }
        }
    }
    const rgb = spectralData.xyzToRGB.map(row => row.reduce((sum, v, i) => sum + v * xyz[i], 0)) as Vec3;
    const normalization = 1 / xyz[1];
    return {
        xyz: xyz.map(v => v * normalization) as Vec3,
        rgb: rgb.map(v => v * normalization) as Vec3,
        normalization,
    };
}

export function blackbodyRGB(kelvin: number, scale = 1): Vec3 {
    return blackbodyColor(kelvin).rgb.map(v => v * scale) as Vec3;
}

export function isBlackbody(v: unknown): v is BlackbodyValue {
    return typeof v === 'object' && v !== null && 'blackbody' in v;
}

/** The `blackbody` entry if it is an object. The census runs before validation, so it must
 *  tolerate a malformed value; the compiler's check of `fields` reports it. */
function dials(v: BlackbodyValue): Partial<BlackbodyValue['blackbody']> | undefined {
    const b: unknown = v.blackbody;
    return typeof b === 'object' && b !== null && !Array.isArray(b) ? b as Partial<BlackbodyValue['blackbody']> : undefined;
}

/** A live temperature's uniform: (kelvin, normalization), computed on the CPU. It excludes
 *  scale, so emitters sharing a temperature slider share it and keep their own brightness. */
function temperatureUniform(kelvin: ValueParam<number>): string {
    return `${paramToUniform(kelvin.param)}_blackbody`;
}

/** Planck's spectrum at the carrier's wavelengths (blackbody.glsl), times the scale. */
function emitPlanck(v: BlackbodyValue, ctx: EmitContext): string {
    const { kelvin, scale = 1 } = v.blackbody;
    const intensity = ctx.bind(scale, formatFloat);
    if (isValueParam(kelvin)) {
        const name = temperatureUniform(kelvin);
        return `(${intensity} * blackbody_emission(${name}.x, ${name}.y, ${ctx.wl}))`;
    }
    return `(${intensity} * blackbody_emission(${formatFloat(kelvin)}, ${formatFloat(blackbodyColor(kelvin).normalization)}, ${ctx.wl}))`;
}

/** `{ blackbody: { kelvin, scale } }`: Planck's spectrum at `kelvin`, normalized to unit
 *  reference CIE Y and multiplied by `scale`. Emission only. */
export const blackbodyKind: SpectrumKind<BlackbodyValue> = {
    id: 'blackbody',
    label: 'blackbody',
    is: isBlackbody,
    roles: ['emission'],
    liveParams(v) {
        const { kelvin, scale } = dials(v) ?? {};
        return [...(isValueParam(kelvin) ? [kelvin.param] : []), ...(isValueParam(scale) ? [scale.param] : [])];
    },
    fields: {
        kelvin: { domain: { kind: 'closed-interval', min: blackbodyTemperatureRange[0], max: blackbodyTemperatureRange[1] }, slider: true },
        scale: { domain: { kind: 'nonnegative' }, slider: true, optional: true },
    },
    toRGB(v, _role, params) {
        const { kelvin, scale } = v.blackbody;
        return blackbodyRGB(
            isValueParam(kelvin) ? ((params[kelvin.param] as number) ?? kelvin.default!) : kelvin,
            scale === undefined ? 1 : isValueParam(scale) ? ((params[scale.param] as number) ?? scale.default!) : scale,
        );
    },
    constantNonzero(v) {
        const { kelvin, scale } = dials(v) ?? {};
        return typeof kelvin === 'number' && (scale === undefined || (typeof scale === 'number' && scale > 0));
    },
    mayBeNonzero(v) {
        const { scale } = dials(v) ?? {};
        return scale === undefined || isValueParam(scale) || (typeof scale === 'number' && scale > 0);
    },
    glsl: { origin: 'components/color/spectra/blackbody/blackbody.glsl', source: blackbodyGLSL },
    dispersive: () => false,
    emit: emitPlanck,
    mint(v, ctx) {
        const { kelvin, scale = 1 } = v.blackbody;
        if (isValueParam(kelvin)) {
            const name = temperatureUniform(kelvin);
            if (!ctx.seen.has(name)) {
                ctx.seen.add(name);
                const project = (temperature: number) => [temperature, blackbodyColor(temperature).normalization];
                ctx.uniforms.push({
                    name, type: 'vec2',
                    parameterPath: kelvin.param,
                    default: project(kelvin.default!),
                    compute: p => project((p[kelvin.param] as number) ?? kelvin.default!),
                });
                const seg = kelvin.param.split('.');
                ctx.parameters[kelvin.param] = {
                    type: 'float', default: kelvin.default, name: 'Kelvin', unit: 'K',
                    group: seg.length > 1 ? seg[0] : undefined, triggersReset: true,
                    // The default slider spans the domain's minimum to 12000 K (a UI choice
                    // inside the domain), widened to reach a higher default; an authored
                    // min/max overrides either end.
                    range: [kelvin.min ?? blackbodyTemperatureRange[0], kelvin.max ?? Math.max(12000, kelvin.default!)],
                };
            }
        }
        ctx.mint(scale, 'float', 'float', true);
    },
    packed: {
        code: 1,
        header(v) {
            const { kelvin, scale = 1 } = v.blackbody;
            if (isValueParam(kelvin) || isValueParam(scale)) throw new Error('light table requires constant blackbody dials');
            return [kelvin, scale * blackbodyColor(kelvin).normalization];
        },
        read: (header, wl) => `blackbody_emission(${header}.z, ${header}.w, ${wl})`,
    },
};
