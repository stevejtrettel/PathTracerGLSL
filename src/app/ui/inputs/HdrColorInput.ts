/**
 * HdrColorInput — a RADIOMETRIC color editor (engine-app pass E2, owner-picked
 * interface): a chroma swatch × an intensity slider, whose PRODUCT is the parameter.
 *
 * Why: ColorPicker is an LDR widget — hex round-trips clamp to [0,1], so touching a
 * swatch bound to `emission: 40` silently dimmed the lamp 40×. Decomposition here is
 * max-channel: intensity = max(r,g,b); chroma = value/intensity (max channel 1 —
 * always in-gamut, safe for the hex swatch). Editing either side recomposes the
 * product; neither side can destroy magnitude.
 *
 * Ledgered follow-up (owner): a blackbody LAMP authoring surface — color-TEMPERATURE
 * slider + brightness, kelvin → chroma via the Planck locus as a CPU precompute.
 */
import { Input, type InputOptions } from '../core/Input.js';
import { ColorPicker } from './ColorPicker.js';
import { Slider } from './Slider.js';

export interface HdrColorInputOptions extends InputOptions<number[]> {
    /** Intensity slider ceiling. Default: max(4 × initial intensity, 1). */
    intensityMax?: number;
}

function decompose(v: number[]): { chroma: number[]; intensity: number } {
    const intensity = Math.max(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
    const chroma = intensity > 0 ? v.slice(0, 3).map((c) => c / intensity) : [1, 1, 1];
    return { chroma, intensity };
}

export class HdrColorInput extends Input<number[]> {
    private chroma: ColorPicker;
    private intensity: Slider;

    constructor(initialValue: number[], options: HdrColorInputOptions = {}) {
        super(initialValue, options, 'div', 'ui-hdr-color');
        const parts = decompose(initialValue);
        const max = options.intensityMax ?? Math.max(4 * parts.intensity, 1);

        this.chroma = new ColorPicker(parts.chroma, {
            label: options.label,
            onChange: () => this.recompose(),
        });
        this.intensity = new Slider(parts.intensity, {
            label: 'Intensity',
            min: 0,
            max,
            onChange: () => this.recompose(),
        });
        this.domElement.appendChild(this.chroma.domElement);
        this.domElement.appendChild(this.intensity.domElement);
    }

    private recompose(): void {
        const k = this.intensity.value;
        this.emitChange(this.chroma.value.slice(0, 3).map((c) => c * k));
    }

    protected updateDisplay(): void {
        const parts = decompose(this._value);
        this.chroma.setValue(parts.chroma);
        this.intensity.setValue(parts.intensity);
    }

    protected valuesEqual(a: number[], b: number[]): boolean {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
    }
}
