import type { ParameterChanges } from './types.js';

/**
 * Minimal ParameterStore - just stores values and notifies changes
 */
class ParameterStore {
    private parameters = new Map<string, any>();
    private _onChange: ((changes: ParameterChanges) => void) | null = null;

    /**
     * When onChange is set, immediately sync all existing parameters
     */
    set onChange(callback: ((changes: ParameterChanges) => void) | null) {
        this._onChange = callback;

        if (callback && this.parameters.size > 0) {
            // Send all existing parameters immediately
            callback({
                changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                    path,
                    oldValue: undefined,
                    newValue: value
                }))
            });
        }
    }

    get onChange() {
        return this._onChange;
    }

    /**
     * Set parameter and notify if changed
     */
    set(path: string, value: any): void {
        const oldValue = this.parameters.get(path);

        // Skip if same
        if (oldValue === value) return;
        if (Array.isArray(oldValue) && Array.isArray(value) &&
            oldValue.length === value.length &&
            oldValue.every((v, i) => v === value[i])) return;

        this.parameters.set(path, value);

        if (this._onChange) {
            this._onChange({
                changes: [{ path, oldValue, newValue: value }]
            });
        }
    }

    /**
     * Get parameter value
     */
    get(path: string): any {
        return this.parameters.get(path);
    }
}

export { ParameterStore };
