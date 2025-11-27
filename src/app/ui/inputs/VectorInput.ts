/**
 * VectorInput - Multi-component numeric input (vec2, vec3, vec4)
 *
 * Features:
 * - Component labels (X, Y, Z, W)
 * - Compact inline layout
 * - Configurable number of components
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface VectorInputOptions extends InputOptions<number[]> {
    /** Number of components (2, 3, or 4) */
    components?: 2 | 3 | 4;
    /** Step increment for each component */
    step?: number;
    /** Custom component labels */
    labels?: string[];
}

const DEFAULT_LABELS = ['X', 'Y', 'Z', 'W'];

export class VectorInput extends Input<number[]> {
    private inputs: HTMLInputElement[] = [];
    private componentCount: number;

    constructor(initialValue: number[], options: VectorInputOptions = {}) {
        super(initialValue, options, 'div', 'ui-vector-input');

        this.componentCount = options.components ?? initialValue.length;
        const step = options.step ?? 0.01;
        const labels = options.labels ?? DEFAULT_LABELS;

        // Label
        if (options.label) {
            const labelEl = document.createElement('div');
            labelEl.className = 'ui-vector-input-label';
            labelEl.textContent = options.label;
            this.domElement.appendChild(labelEl);
        }

        // Components container
        const container = document.createElement('div');
        container.className = 'ui-vector-input-container';

        for (let i = 0; i < this.componentCount; i++) {
            const componentDiv = document.createElement('div');
            componentDiv.className = 'ui-vector-input-component';

            // Component label (X, Y, Z, W)
            const componentLabel = document.createElement('span');
            componentLabel.className = 'ui-vector-input-component-label';
            componentLabel.textContent = labels[i];

            // Input field
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'ui-vector-input-field';
            input.step = String(step);
            input.value = String(initialValue[i] ?? 0);

            const index = i;
            input.addEventListener('input', () => {
                const newValue = [...this._value];
                newValue[index] = parseFloat(input.value);
                if (!isNaN(newValue[index])) {
                    this.emitChange(newValue);
                }
            });

            input.addEventListener('blur', () => {
                this.updateDisplay();
            });

            this.inputs.push(input);

            componentDiv.appendChild(componentLabel);
            componentDiv.appendChild(input);
            container.appendChild(componentDiv);
        }

        this.domElement.appendChild(container);
    }

    protected updateDisplay(): void {
        for (let i = 0; i < this.componentCount; i++) {
            this.inputs[i].value = String(this._value[i] ?? 0);
        }
    }

    protected valuesEqual(a: number[], b: number[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((v, i) => Math.abs(v - b[i]) < 0.0001);
    }
}
