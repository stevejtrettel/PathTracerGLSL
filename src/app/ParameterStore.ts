// app/ParameterStore.ts
import type { ParameterChanges } from './types';

/**
 * ParameterStore - Central parameter storage and change notification
 *
 * Responsibilities:
 * - Store parameter values (numbers, vectors, arrays, etc.)
 * - Notify listeners when parameters change
 * - Batch updates to reduce notifications
 * - Serialize/restore for session management
 * - Handle renderer switching (resend all parameters)
 * - Lock/unlock for production renders
 */
class ParameterStore {
    private parameters = new Map<string, any>();
    private locked = false;
    private _onChange: ((changes: ParameterChanges) => void) | null = null;

    /**
     * Set change callback - immediately syncs all existing parameters
     */
    set onChange(callback: ((changes: ParameterChanges) => void) | null) {
        this._onChange = callback;

        if (callback && this.parameters.size > 0) {
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
     * Lock parameters (production mode)
     */
    lock(): void {
        this.locked = true;
        console.log('🔒 Parameters locked');
    }

    /**
     * Unlock parameters
     */
    unlock(): void {
        this.locked = false;
        console.log('🔓 Parameters unlocked');
    }

    /**
     * Check if parameters are locked
     */
    isLocked(): boolean {
        return this.locked;
    }

    /**
     * Set single parameter
     */
    set(path: string, value: any): void {
        if (this.locked) {
            console.warn(`⚠️ Ignoring parameter change during production: ${path}`);
            return;
        }

        const oldValue = this.parameters.get(path);

        if (this.valuesEqual(oldValue, value)) return;

        this.parameters.set(path, value);

        if (this._onChange) {
            this._onChange({
                changes: [{ path, oldValue, newValue: value }]
            });
        }
    }

    /**
     * Set multiple parameters in batch
     */
    batch(updates: Record<string, any>): void {
        if (this.locked) {
            console.warn(`⚠️ Ignoring batch parameter update during production`);
            return;
        }

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
     * Get parameter value
     */
    get(path: string): any {
        return this.parameters.get(path);
    }

    /**
     * Force re-send all parameters (for renderer switching)
     */
    resendAll(): void {
        if (!this._onChange || this.parameters.size === 0) return;

        this._onChange({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path,
                oldValue: value,
                newValue: value
            }))
        });
    }

    /**
     * Serialize all parameters for session saving
     */
    serialize(): Record<string, any> {
        const obj: Record<string, any> = {};

        for (const [key, value] of this.parameters.entries()) {
            if (value instanceof Float32Array || value instanceof Array) {
                obj[key] = Array.from(value);
            } else if (value && typeof value === 'object') {
                obj[key] = JSON.parse(JSON.stringify(value));
            } else {
                obj[key] = value;
            }
        }

        return obj;
    }

    /**
     * Restore parameters from session (without triggering individual changes)
     */
    restore(params: Record<string, any>): void {
        const oldOnChange = this._onChange;
        this._onChange = null;

        this.parameters.clear();

        for (const [key, value] of Object.entries(params)) {
            // Convert arrays to Float32Array for camera.frame
            if (key === 'camera.frame' && Array.isArray(value)) {
                this.parameters.set(key, new Float32Array(value));
            } else if (Array.isArray(value)) {
                this.parameters.set(key, [...value]);
            } else {
                this.parameters.set(key, value);
            }
        }

        this._onChange = oldOnChange;

        // Send all parameters in one batch
        if (this._onChange) {
            this._onChange({
                changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                    path,
                    oldValue: undefined,
                    newValue: value
                }))
            });
        }
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private valuesEqual(a: any, b: any): boolean {
        if (a === b) return true;

        // Handle arrays and typed arrays
        if ((Array.isArray(a) || ArrayBuffer.isView(a)) &&
            (Array.isArray(b) || ArrayBuffer.isView(b))) {
            const arrA = a as ArrayLike<number>;
            const arrB = b as ArrayLike<number>;
            if (arrA.length !== arrB.length) return false;
            for (let i = 0; i < arrA.length; i++) {
                if (arrA[i] !== arrB[i]) return false;
            }
            return true;
        }

        return false;
    }
}

export { ParameterStore };
