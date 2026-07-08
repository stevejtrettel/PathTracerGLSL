/**
 * WidgetFactory - Creates UI inputs from ParameterMetadata
 *
 * This bridges the gap between renderer parameter metadata and
 * the UI component system. Given metadata describing a parameter,
 * it creates the appropriate input widget.
 */
import type { ParameterMetadata } from '../types.js';
import type { Input } from './core/Input.js';
import { Slider } from './inputs/Slider.js';
import { Checkbox } from './inputs/Checkbox.js';
import { NumberInput } from './inputs/NumberInput.js';
import { ColorPicker } from './inputs/ColorPicker.js';
import { VectorInput } from './inputs/VectorInput.js';
import { Dropdown } from './inputs/Dropdown.js';

export interface WidgetFactoryOptions {
    /** Current value of the parameter */
    value: unknown;
    /** Called when user changes the value */
    onChange: (value: unknown) => void;
}

/**
 * Create an input widget from parameter metadata
 *
 * @param meta - Parameter metadata from the compiled renderer
 * @param options - Current value and change handler
 * @returns An Input component appropriate for the parameter type
 *
 * @example
 * ```ts
 * const widget = WidgetFactory.create(
 *     { name: 'Intensity', type: 'float', range: [0, 10] },
 *     { value: 1.0, onChange: (v) => app.setParameter('light.intensity', v) }
 * );
 * panel.add(widget);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWidget(meta: ParameterMetadata, options: WidgetFactoryOptions): Input<any> {
    const { value, onChange } = options;
    const label = meta.name;

    switch (meta.type) {
        case 'float': {
            if (meta.range) {
                return new Slider(value as number, {
                    label,
                    min: meta.range[0],
                    max: meta.range[1],
                    step: meta.step,
                    onChange: onChange as (v: number) => void
                });
            }
            return new NumberInput(value as number, {
                label,
                step: meta.step ?? 0.01,
                onChange: onChange as (v: number) => void
            });
        }

        case 'int': {
            // Named options → labeled dropdown (options[value] = display label),
            // so discrete ints (e.g. a display-mode selector) show names not numbers.
            if (meta.options) {
                const values = meta.values
                    ?? (meta.range
                        ? Array.from({ length: meta.range[1] - meta.range[0] + 1 }, (_, i) => meta.range![0] + i)
                        : meta.options.map((_, i) => i));
                return new Dropdown(value as number, {
                    label,
                    options: values.map(v => ({ label: meta.options![v] ?? String(v), value: v })),
                    onChange: onChange as (v: number) => void
                });
            }
            // Dropdown for enumerated numeric values
            if (meta.values) {
                return new Dropdown(value as number, {
                    label,
                    options: meta.values,
                    onChange: onChange as (v: number) => void
                });
            }
            // Slider for bounded integers
            if (meta.range) {
                return new Slider(value as number, {
                    label,
                    min: meta.range[0],
                    max: meta.range[1],
                    step: 1,
                    precision: 0,
                    onChange: onChange as (v: number) => void
                });
            }
            // Number input for unbounded integers
            return new NumberInput(value as number, {
                label,
                step: 1,
                integer: true,
                onChange: onChange as (v: number) => void
            });
        }

        case 'bool': {
            return new Checkbox(value as boolean, {
                label,
                onChange: onChange as (v: boolean) => void
            });
        }

        case 'color': {
            return new ColorPicker(value as number[], {
                label,
                onChange: onChange as (v: number[]) => void
            });
        }

        case 'vec2': {
            return new VectorInput(value as number[], {
                label,
                components: 2,
                step: meta.step ?? 0.01,
                onChange: onChange as (v: number[]) => void
            });
        }

        case 'vec3': {
            return new VectorInput(value as number[], {
                label,
                components: 3,
                step: meta.step ?? 0.01,
                onChange: onChange as (v: number[]) => void
            });
        }

        case 'vec4': {
            return new VectorInput(value as number[], {
                label,
                components: 4,
                step: meta.step ?? 0.01,
                onChange: onChange as (v: number[]) => void
            });
        }

        default: {
            // Fallback to number input for unknown types
            console.warn(`Unknown parameter type: ${meta.type}, falling back to NumberInput`);
            return new NumberInput(value as number, {
                label,
                onChange: onChange as (v: number) => void
            });
        }
    }
}

/**
 * WidgetFactory namespace for static access
 */
export const WidgetFactory = {
    create: createWidget
};
