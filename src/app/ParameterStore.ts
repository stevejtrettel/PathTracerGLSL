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
        if (this.valuesEqual(oldValue, value)) return;

        this.parameters.set(path, value);

        if (this._onChange) {
            this._onChange({
                changes: [{ path, oldValue, newValue: value }]
            });
        }
    }

    /**
     * Set multiple parameters and notify once
     */
    batch(updates: Record<string, any>): void {
        const changes = [];

        for (const [path, value] of Object.entries(updates)) {
            const oldValue = this.parameters.get(path);

            if (!this.valuesEqual(oldValue, value)) {
                this.parameters.set(path, value);
                changes.push({ path, oldValue, newValue: value });
            }
        }

        if (changes.length > 0 && this._onChange) {
            this._onChange({ changes });
        }
    }

    /**
     * Force re-send all parameters (useful after recipe switch)
     */
    resendAll(): void {
        if (!this._onChange || this.parameters.size === 0) return;

        // Treat all parameters as "changed" to force GPU update
        this._onChange({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path,
                oldValue: value,  // Same as new, but forces update
                newValue: value
            }))
        });
    }


    /**
     * Get parameter value
     */
    get(path: string): any {
        return this.parameters.get(path);
    }

    /**
     * Helper to compare values including arrays
     */
    private valuesEqual(a: any, b: any): boolean {
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b) &&
            a.length === b.length &&
            a.every((v, i) => v === b[i])) return true;
        return false;
    }
}

export { ParameterStore };
