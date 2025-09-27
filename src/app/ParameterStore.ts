import type { ParameterMetadata, ParameterChanges } from './types.js';

/**
 * Minimal ParameterStore for Phase 2
 * Single source of truth for renderer state with change notification
 */
class ParameterStore {
    private parameters = new Map<string, any>();
    private metadata = new Map<string, ParameterMetadata>();

    // Change notification callback
    onChange: ((changes: ParameterChanges) => void) | null = null;

    /**
     * Set parameter value and notify if changed
     */
    set(path: string, value: any): void {
        const oldValue = this.parameters.get(path);

        // Skip if unchanged
        if (this.shallowEqual(oldValue, value)) {
            return;
        }

        // Basic validation if metadata exists
        const meta = this.metadata.get(path);
        if (meta) {
            value = this.validateValue(value, meta);
        }

        // Store new value
        this.parameters.set(path, value);

        // Notify of change
        if (this.onChange) {
            this.onChange({
                changes: [{
                    path,
                    oldValue,
                    newValue: value
                }]
            });
        }
    }

    /**
     * Get parameter value
     */
    get(path: string): any {
        return this.parameters.get(path);
    }

    /**
     * Register parameter metadata and set default if needed
     */
    registerMetadata(path: string, metadata: ParameterMetadata): void {
        this.metadata.set(path, metadata);

        // Set default value if parameter doesn't exist yet
        if (!this.parameters.has(path) && metadata.default !== undefined) {
            this.parameters.set(path, metadata.default); // Set directly without triggering onChange
        }
    }

    /**
     * Basic validation against metadata
     */
    private validateValue(value: any, metadata: ParameterMetadata): any {
        switch (metadata.type) {
            case 'float':
                if (metadata.min !== undefined && value < metadata.min) {
                    return metadata.min;
                }
                if (metadata.max !== undefined && value > metadata.max) {
                    return metadata.max;
                }
                return value;

            case 'vec3':
                if (!Array.isArray(value) || value.length !== 3) {
                    console.warn(`Expected vec3 for ${metadata.type}, using default`);
                    return metadata.default;
                }
                return value;

            case 'int':
                return Math.round(value);

            case 'bool':
                return Boolean(value);

            default:
                return value;
        }
    }

    /**
     * Simple equality check
     */
    private shallowEqual(a: any, b: any): boolean {
        if (Array.isArray(a) && Array.isArray(b)) {
            return a.length === b.length && a.every((val, i) => val === b[i]);
        }
        return a === b;
    }
}

export { ParameterStore };
